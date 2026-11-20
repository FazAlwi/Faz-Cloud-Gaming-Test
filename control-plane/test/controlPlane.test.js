import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createControlPlaneApp } from '../src/index.js';

async function listenEphemeral(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

test('control-plane serves catalog & sleeping health when GPU VM is TERMINATED, then wakes & proxies start', async () => {
  // Fake GPU VM backend server
  const fakeGpuApp = express();
  fakeGpuApp.use(express.json());
  fakeGpuApp.get('/api/health', (_req, res) =>
    res.json({
      status: 'ok',
      region: 'asia-southeast1',
      regionLabel: 'Singapore',
      gpu: 'NVIDIA L4 (24GB)',
      activeSessions: 0,
      maxSlots: 2,
      availableSlots: 2,
      mockDocker: false,
      storeBackend: 'memory',
      uptimeSeconds: 12,
    })
  );
  fakeGpuApp.post('/api/sessions/start', (req, res) =>
    res.status(201).json({
      reused: false,
      session: {
        sessionId: 'sess_awake',
        userId: req.body.userId,
        gameId: req.body.gameId,
        gameTitle: 'Desktop / Steam Mode',
        port: 8081,
        streamUrl: 'https://136.110.5.102:8081',
        mock: false,
      },
    })
  );

  const gpuServer = await listenEphemeral(fakeGpuApp);

  let vmStatus = 'TERMINATED';
  let startCalls = 0;

  const mockVmController = {
    vmControlEnabled: true,
    async getVmStatus() {
      return {
        configured: true,
        vmName: 'faz-gpu-vm',
        zone: 'asia-southeast1-a',
        vmStatus,
        externalIp: vmStatus === 'RUNNING' ? '127.0.0.1' : null,
        backendUrl: vmStatus === 'RUNNING' ? gpuServer.baseUrl : null,
      };
    },
    async startVm() {
      startCalls += 1;
      vmStatus = 'RUNNING';
      return this.getVmStatus();
    },
    async stopVm() {
      vmStatus = 'STOPPING';
      return this.getVmStatus();
    },
    async probeBackendHealth(url) {
      const res = await fetch(`${url}/api/health`);
      return res.ok ? res.json() : null;
    },
    async ensureVmReady() {
      if (vmStatus !== 'RUNNING') {
        await this.startVm();
      }
      const state = await this.getVmStatus();
      const health = await this.probeBackendHealth(state.backendUrl);
      return { ...state, health, ready: true };
    },
  };

  const cpApp = createControlPlaneApp({ vmController: mockVmController });
  const cpServer = await listenEphemeral(cpApp);

  try {
    // 1. While VM is sleeping: /api/health returns sleeping, /api/games returns bundled catalog
    const sleepingHealth = await (await fetch(`${cpServer.baseUrl}/api/health`)).json();
    assert.equal(sleepingHealth.status, 'sleeping');
    assert.equal(sleepingHealth.vmStatus, 'TERMINATED');
    assert.equal(sleepingHealth.vmControlEnabled, true);

    const gamesBody = await (await fetch(`${cpServer.baseUrl}/api/games`)).json();
    assert.ok(Array.isArray(gamesBody.games) && gamesBody.games.length > 0);

    const sessionWhileAsleep = await (
      await fetch(`${cpServer.baseUrl}/api/sessions/player-1`)
    ).json();
    assert.equal(sessionWhileAsleep.session, null);

    // 2. Starting a session auto-wakes the VM and proxies POST /api/sessions/start
    const startRes = await fetch(`${cpServer.baseUrl}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'player-1', gameId: 'desktop' }),
    });
    assert.equal(startRes.status, 201);
    const startBody = await startRes.json();
    assert.equal(startCalls, 1);
    assert.equal(startBody.session.sessionId, 'sess_awake');

    // 3. Health now proxies live RUNNING status from GPU VM
    const awakeHealth = await (await fetch(`${cpServer.baseUrl}/api/health`)).json();
    assert.equal(awakeHealth.status, 'ok');
    assert.equal(awakeHealth.vmStatus, 'RUNNING');
  } finally {
    await new Promise((r) => cpServer.server.close(r));
    await new Promise((r) => gpuServer.server.close(r));
  }
});
