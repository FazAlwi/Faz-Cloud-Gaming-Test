import { execFile } from 'node:child_process';
import { config } from '../config/env.js';
import { sessionStore } from './sessionStore.js';
import { dockerOrchestrator } from './dockerOrchestrator.js';

let reaperTimer = null;
let lastActiveAt = Date.now();
let vmShutdownInitiated = false;

async function triggerIdleVmShutdown() {
  if (vmShutdownInitiated) return;
  vmShutdownInitiated = true;
  console.log(
    `[SessionReaper] 0 active sessions for >= ${Math.round(config.autoStopVmIdleMs / 1000)}s — shutting down idle GPU VM to save costs.`
  );

  execFile('sudo', ['-n', 'poweroff'], (err) => {
    if (err) {
      console.warn(`[SessionReaper] sudo -n poweroff failed (${err.message}).`);
      vmShutdownInitiated = false;
    }
  });
}

export async function reapIdleSessions() {
  const now = Date.now();
  const sessions = await sessionStore.listSessions();

  if (sessions.length > 0) {
    lastActiveAt = now;
  }

  for (const session of sessions) {
    const idleDurationMs = now - session.lastHeartbeat;
    if (idleDurationMs > config.idleTimeoutMs) {
      console.log(
        `[SessionReaper] Terminating idle session ${session.sessionId} for user "${session.userId}" (idle ${Math.round(idleDurationMs / 1000)}s > ${Math.round(config.idleTimeoutMs / 1000)}s).`
      );
      try {
        await dockerOrchestrator.stopSessionContainer(session);
      } catch (err) {
        console.error(`[SessionReaper] Failed to stop container for ${session.userId}: ${err.message}`);
      } finally {
        await sessionStore.deleteSession(session.userId);
      }
    }
  }

  if (config.autoStopVmIdleMs > 0 && !config.mockDocker) {
    const remaining = await sessionStore.countSessions();
    if (remaining === 0 && now - lastActiveAt >= config.autoStopVmIdleMs) {
      await triggerIdleVmShutdown();
    }
  }
}

export function startSessionReaper() {
  if (reaperTimer) return;
  lastActiveAt = Date.now();
  vmShutdownInitiated = false;
  reaperTimer = setInterval(() => {
    reapIdleSessions().catch((err) => {
      console.error(`[SessionReaper] Sweep error: ${err.message}`);
    });
  }, config.reaperIntervalMs);

  // Allow Node to exit cleanly even if interval is active
  if (typeof reaperTimer.unref === 'function') {
    reaperTimer.unref();
  }

  console.log(
    `[SessionReaper] Started (sweep every ${config.reaperIntervalMs / 1000}s, session TTL ${config.idleTimeoutMs / 1000}s, auto-stop VM ${config.autoStopVmIdleMs > 0 ? `${config.autoStopVmIdleMs / 1000}s` : 'disabled'}).`
  );
}

export function stopSessionReaper() {
  if (reaperTimer) {
    clearInterval(reaperTimer);
    reaperTimer = null;
  }
}
