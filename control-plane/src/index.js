import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createGcpVmController } from './gcpVm.js';
import { DESKTOP_MODE, GAMES } from './games.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(__dirname, '../..', 'client', 'dist');

function parseIntOrDefault(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

export function createControlPlaneApp(overrides = {}) {
  const cfg = {
    gcpProject: overrides.gcpProject ?? (process.env.GCP_PROJECT || '').trim(),
    gcpZone: overrides.gcpZone ?? (process.env.GCP_ZONE || '').trim(),
    gpuVmName: overrides.gpuVmName ?? (process.env.GPU_VM_NAME || '').trim(),
    gpuVmHost: overrides.gpuVmHost ?? (process.env.GPU_VM_HOST || '').trim(),
    gpuVmUrl: overrides.gpuVmUrl ?? (process.env.GPU_VM_URL || '').trim(),
    gpuVmPort: overrides.gpuVmPort ?? parseIntOrDefault(process.env.GPU_VM_PORT, 4000),
    region: overrides.region ?? (process.env.REGION || 'asia-southeast1'),
    regionLabel: overrides.regionLabel ?? (process.env.REGION_LABEL || 'Singapore'),
    gpuModel: overrides.gpuModel ?? (process.env.GPU_MODEL || 'NVIDIA L4 (24GB)'),
    maxSlots: overrides.maxSlots ?? parseIntOrDefault(process.env.MAX_SLOTS, 2),
    autoStopOnSessionEnd:
      overrides.autoStopOnSessionEnd ?? parseBool(process.env.AUTO_STOP_ON_SESSION_END, true),
    autoStopVmIdleMs:
      overrides.autoStopVmIdleMs ?? parseIntOrDefault(process.env.AUTO_STOP_VM_IDLE_MS, 600_000),
  };

  const vmController =
    overrides.vmController ??
    createGcpVmController({
      project: cfg.gcpProject,
      zone: cfg.gcpZone,
      vmName: cfg.gpuVmName,
      staticHost: cfg.gpuVmHost,
      staticUrl: cfg.gpuVmUrl,
      vmPort: cfg.gpuVmPort,
    });

  let lastSessionActivityAt = Date.now();

  const app = express();
  app.use(express.json());

  async function proxyJsonToGpuVm(backendUrl, reqPath, { method = 'GET', body, timeoutMs = 30_000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${backendUrl}${reqPath}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { message: text };
      }
      return { status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  // Dedicated VM control endpoints
  app.get('/api/vm/status', async (_req, res) => {
    try {
      const state = await vmController.getVmStatus();
      const health =
        state.vmStatus === 'RUNNING' && state.backendUrl
          ? await vmController.probeBackendHealth(state.backendUrl, 2500)
          : null;
      return res.json({
        configured: state.configured,
        vmName: state.vmName,
        zone: state.zone,
        vmStatus: state.vmStatus,
        externalIp: state.externalIp,
        backendReady: Boolean(health),
      });
    } catch (err) {
      return res.status(502).json({
        error: 'VM_STATUS_ERROR',
        message: err.message || 'Unable to query GPU VM status.',
      });
    }
  });

  app.post('/api/vm/start', async (req, res) => {
    try {
      const waitForReady = req.body?.wait !== false;
      if (waitForReady) {
        const result = await vmController.ensureVmReady();
        return res.json({
          ok: true,
          vmStatus: result.vmStatus,
          externalIp: result.externalIp,
          backendReady: true,
          health: result.health,
        });
      }
      const started = await vmController.startVm();
      return res.status(202).json({
        ok: true,
        vmStatus: started.vmStatus,
        externalIp: started.externalIp,
        backendReady: false,
      });
    } catch (err) {
      const status = err.code === 'VM_WAKE_TIMEOUT' ? 504 : 502;
      return res.status(status).json({
        error: err.code || 'VM_START_FAILED',
        message: err.message || 'Failed to wake GPU VM.',
      });
    }
  });

  app.post('/api/vm/stop', async (_req, res) => {
    try {
      const result = await vmController.stopVm();
      return res.json({
        ok: true,
        vmStatus: result.vmStatus,
      });
    } catch (err) {
      return res.status(502).json({
        error: 'VM_STOP_FAILED',
        message: err.message || 'Failed to stop GPU VM.',
      });
    }
  });

  // Portal health endpoint — stays 200 OK even when the GPU VM is asleep so the UI renders cleanly
  app.get('/api/health', async (_req, res) => {
    try {
      const state = await vmController.getVmStatus();
      if (state.vmStatus === 'RUNNING' && state.backendUrl) {
        const backendHealth = await vmController.probeBackendHealth(state.backendUrl, 2500);
        if (backendHealth) {
          return res.json({
            ...backendHealth,
            vmStatus: 'RUNNING',
            vmControlEnabled: vmController.vmControlEnabled,
          });
        }
      }

      const derivedStatus =
        state.vmStatus === 'TERMINATED' || state.vmStatus === 'STOPPED' || state.vmStatus === 'SUSPENDED'
          ? 'sleeping'
          : state.vmStatus === 'STOPPING'
            ? 'stopping'
            : state.vmStatus === 'PROVISIONING' || state.vmStatus === 'STAGING' || state.vmStatus === 'RUNNING'
              ? 'starting'
              : 'unconfigured';

      return res.json({
        status: derivedStatus,
        region: cfg.region,
        regionLabel: cfg.regionLabel,
        gpu: cfg.gpuModel,
        activeSessions: 0,
        maxSlots: cfg.maxSlots,
        availableSlots: cfg.maxSlots,
        mockDocker: false,
        storeBackend: 'memory',
        uptimeSeconds: Math.floor(process.uptime()),
        vmStatus: state.vmStatus,
        vmControlEnabled: vmController.vmControlEnabled,
      });
    } catch (err) {
      return res.json({
        status: 'degraded',
        region: cfg.region,
        regionLabel: cfg.regionLabel,
        gpu: cfg.gpuModel,
        activeSessions: 0,
        maxSlots: cfg.maxSlots,
        availableSlots: cfg.maxSlots,
        mockDocker: false,
        storeBackend: 'memory',
        uptimeSeconds: Math.floor(process.uptime()),
        vmStatus: 'UNKNOWN',
        vmControlEnabled: vmController.vmControlEnabled,
        error: err.message,
      });
    }
  });

  // Game catalog — proxies live catalog from GPU VM when online, falls back to bundled catalog when sleeping
  app.get('/api/games', async (_req, res) => {
    try {
      const state = await vmController.getVmStatus();
      if (state.vmStatus === 'RUNNING' && state.backendUrl) {
        const proxied = await proxyJsonToGpuVm(state.backendUrl, '/api/games', { timeoutMs: 2500 });
        if (proxied.status === 200 && Array.isArray(proxied.data?.games)) {
          return res.json(proxied.data);
        }
      }
    } catch {
      // Fall back to bundled catalog while GPU VM is asleep or booting
    }
    return res.json({ games: GAMES, desktopMode: DESKTOP_MODE });
  });

  // Session status — returns null cleanly when GPU VM is asleep
  app.get('/api/sessions/:userId', async (req, res) => {
    try {
      const state = await vmController.getVmStatus();
      if (state.vmStatus !== 'RUNNING' || !state.backendUrl) {
        return res.json({ session: null });
      }
      const proxied = await proxyJsonToGpuVm(
        state.backendUrl,
        `/api/sessions/${encodeURIComponent(req.params.userId)}`,
        { timeoutMs: 3000 }
      );
      return res.status(proxied.status).json(proxied.data);
    } catch {
      return res.json({ session: null });
    }
  });

  // Start session — auto-wakes GPU VM if asleep, then proxies start request
  app.post('/api/sessions/start', async (req, res) => {
    lastSessionActivityAt = Date.now();
    try {
      const readyState = await vmController.ensureVmReady();
      const proxied = await proxyJsonToGpuVm(readyState.backendUrl, '/api/sessions/start', {
        method: 'POST',
        body: req.body,
        timeoutMs: 60_000,
      });
      if (proxied.status === 201 || proxied.status === 200) {
        lastSessionActivityAt = Date.now();
      }
      return res.status(proxied.status).json(proxied.data);
    } catch (err) {
      const status = err.code === 'VM_WAKE_TIMEOUT' ? 504 : 502;
      return res.status(status).json({
        error: err.code || 'GPU_VM_UNAVAILABLE',
        message: err.message || 'GPU server is currently unavailable.',
      });
    }
  });

  app.post('/api/sessions/stop', async (req, res) => {
    try {
      const state = await vmController.getVmStatus();
      if (state.vmStatus !== 'RUNNING' || !state.backendUrl) {
        return res.json({ stopped: false, message: 'GPU VM is already asleep.' });
      }
      const proxied = await proxyJsonToGpuVm(state.backendUrl, '/api/sessions/stop', {
        method: 'POST',
        body: req.body,
        timeoutMs: 15_000,
      });

      let vmStopped = false;
      let vmStatus = state.vmStatus;
      const remainingSessions = proxied.data?.activeSessions;
      const shouldStopVm =
        cfg.autoStopOnSessionEnd &&
        vmController.vmControlEnabled &&
        (remainingSessions === 0 || req.body?.stopVm === true);

      if (shouldStopVm) {
        try {
          console.log(
            `[ControlPlane] Session stopped with 0 remaining active sessions — auto-stopping GPU VM to save compute costs.`
          );
          const stopResult = await vmController.stopVm();
          vmStopped = true;
          vmStatus = stopResult?.vmStatus || 'STOPPING';
        } catch (stopErr) {
          console.warn(`[ControlPlane] Auto-stopping GPU VM on session end failed: ${stopErr.message}`);
        }
      }

      return res.status(proxied.status).json({
        ...proxied.data,
        vmStopped,
        vmStatus,
      });
    } catch (err) {
      return res.status(502).json({
        error: 'GPU_VM_UNREACHABLE',
        message: err.message || 'Failed to stop session on GPU VM.',
      });
    }
  });

  app.post('/api/sessions/heartbeat', async (req, res) => {
    lastSessionActivityAt = Date.now();
    try {
      const state = await vmController.getVmStatus();
      if (state.vmStatus !== 'RUNNING' || !state.backendUrl) {
        return res.status(404).json({
          error: 'SESSION_NOT_FOUND',
          message: 'GPU VM is not running.',
        });
      }
      const proxied = await proxyJsonToGpuVm(state.backendUrl, '/api/sessions/heartbeat', {
        method: 'POST',
        body: req.body,
        timeoutMs: 5000,
      });
      return res.status(proxied.status).json(proxied.data);
    } catch (err) {
      return res.status(502).json({
        error: 'GPU_VM_UNREACHABLE',
        message: err.message || 'Failed to reach GPU VM for heartbeat.',
      });
    }
  });

  // Background idle VM stopper — safely shuts down VM when 0 sessions run for >= autoStopVmIdleMs
  let idleSweepTimer = null;
  if (cfg.autoStopVmIdleMs > 0 && vmController.vmControlEnabled) {
    idleSweepTimer = setInterval(async () => {
      try {
        const idleForMs = Date.now() - lastSessionActivityAt;
        if (idleForMs < cfg.autoStopVmIdleMs) return;

        const state = await vmController.getVmStatus();
        if (state.vmStatus !== 'RUNNING' || !state.backendUrl) return;

        const health = await vmController.probeBackendHealth(state.backendUrl, 2500);
        if (health && health.activeSessions > 0) {
          lastSessionActivityAt = Date.now();
          return;
        }

        console.log(
          `[ControlPlane] GPU VM idle with 0 active sessions for >= ${Math.round(cfg.autoStopVmIdleMs / 1000)}s — auto-stopping VM.`
        );
        await vmController.stopVm();
        lastSessionActivityAt = Date.now();
      } catch (err) {
        console.warn(`[ControlPlane] Idle VM sweep check encountered error: ${err.message}`);
      }
    }, Math.min(cfg.autoStopVmIdleMs, 60_000));

    if (typeof idleSweepTimer.unref === 'function') {
      idleSweepTimer.unref();
    }
  }

  // Serve built React frontend (/client/dist)
  if (fs.existsSync(path.join(clientDistDir, 'index.html'))) {
    app.use(express.static(clientDistDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Endpoint not found.' });
  });

  return app;
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const port = parseIntOrDefault(process.env.PORT, 8080);
  const app = createControlPlaneApp();
  app.listen(port, '0.0.0.0', () => {
    console.log(
      `[ControlPlane] Listening on http://0.0.0.0:${port} (GCP_ZONE=${process.env.GCP_ZONE || 'unset'}, GPU_VM_NAME=${process.env.GPU_VM_NAME || 'unset'}, GPU_VM_HOST=${process.env.GPU_VM_HOST || 'unset'})`
    );
  });
}
