import { config } from '../config/env.js';
import { sessionStore } from './sessionStore.js';
import { dockerOrchestrator } from './dockerOrchestrator.js';

let reaperTimer = null;

export async function reapIdleSessions() {
  const now = Date.now();
  const sessions = await sessionStore.listSessions();

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
}

export function startSessionReaper() {
  if (reaperTimer) return;
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
    `[SessionReaper] Started (sweep every ${config.reaperIntervalMs / 1000}s, idle timeout ${config.idleTimeoutMs / 1000}s).`
  );
}

export function stopSessionReaper() {
  if (reaperTimer) {
    clearInterval(reaperTimer);
    reaperTimer = null;
  }
}
