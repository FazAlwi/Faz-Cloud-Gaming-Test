import { Router } from 'express';
import { config } from '../config/env.js';
import { resolveGame } from '../data/games.js';
import { dockerOrchestrator } from '../services/dockerOrchestrator.js';
import { sessionStore } from '../services/sessionStore.js';
import { sanitizeUserId } from '../utils/sanitize.js';

export const sessionsRouter = Router();

// Serialize session start operations to prevent race conditions on the last GPU slot
let startMutex = Promise.resolve();

function withStartLock(fn) {
  const next = startMutex.then(fn, fn);
  startMutex = next.catch(() => {});
  return next;
}

sessionsRouter.get('/:userId', async (req, res) => {
  const userId = sanitizeUserId(req.params.userId);
  if (!userId) {
    return res.status(400).json({
      error: 'INVALID_USER_ID',
      message: 'User ID must be at least 2 alphanumeric characters.',
    });
  }

  const session = await sessionStore.getSession(userId);
  return res.json({ session });
});

sessionsRouter.post('/start', async (req, res) => {
  const rawUserId = req.body?.userId;
  const rawGameId = req.body?.gameId;

  const userId = sanitizeUserId(rawUserId);
  if (!userId) {
    return res.status(400).json({
      error: 'INVALID_USER_ID',
      message: 'Please provide a valid nickname (at least 2 letters or numbers).',
    });
  }

  const game = resolveGame(rawGameId);
  if (!game) {
    return res.status(400).json({
      error: 'UNKNOWN_GAME',
      message: `Game "${rawGameId}" was not found in the catalog.`,
    });
  }

  try {
    const result = await withStartLock(async () => {
      // 1. Return existing active session if this user already has one
      const existing = await sessionStore.getSession(userId);
      if (existing) {
        existing.lastHeartbeat = Date.now();
        await sessionStore.setSession(userId, existing);
        return { status: 200, body: { reused: true, session: existing } };
      }

      // 2. Enforce MAX_SLOTS GPU container capacity
      const activeSessions = await sessionStore.listSessions();
      if (activeSessions.length >= config.maxSlots) {
        return {
          status: 503,
          body: {
            error: 'ALL_SLOTS_FULL',
            message: `All ${config.maxSlots} GPU container slots are currently in use. Please try again once a slot opens.`,
            activeSessions: activeSessions.length,
            maxSlots: config.maxSlots,
          },
        };
      }

      // 3. Allocate host port + UDP range and launch Selkies container (or mock)
      const session = await dockerOrchestrator.launchSessionContainer({
        userId,
        game,
        activeSessions,
      });

      await sessionStore.setSession(userId, session);
      console.log(
        `[Sessions] Started ${session.mock ? 'MOCK ' : ''}session ${session.sessionId} for "${userId}" -> ${game.title} on port ${session.port} (UDP ${session.webrtcUdpRange})`
      );

      return { status: 201, body: { reused: false, session } };
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error(`[Sessions] Start failed for "${userId}":`, err);
    const status = err.code === 'NO_FREE_PORTS' ? 503 : 500;
    return res.status(status).json({
      error: err.code || 'SESSION_START_FAILED',
      message: err.message || 'Failed to launch cloud gaming container.',
    });
  }
});

sessionsRouter.post('/stop', async (req, res) => {
  const userId = sanitizeUserId(req.body?.userId);
  if (!userId) {
    return res.status(400).json({
      error: 'INVALID_USER_ID',
      message: 'Please provide a valid userId.',
    });
  }

  const session = await sessionStore.getSession(userId);
  if (!session) {
    return res.json({
      stopped: false,
      userId,
      message: 'No active session found for this user.',
    });
  }

  try {
    await dockerOrchestrator.stopSessionContainer(session);
  } finally {
    await sessionStore.deleteSession(userId);
  }

  console.log(`[Sessions] Stopped session ${session.sessionId} for "${userId}" (released port ${session.port}).`);

  return res.json({
    stopped: true,
    userId,
    releasedPort: session.port,
  });
});

sessionsRouter.post('/heartbeat', async (req, res) => {
  const userId = sanitizeUserId(req.body?.userId);
  if (!userId) {
    return res.status(400).json({
      error: 'INVALID_USER_ID',
      message: 'Please provide a valid userId.',
    });
  }

  const session = await sessionStore.getSession(userId);
  if (!session) {
    return res.status(404).json({
      error: 'SESSION_NOT_FOUND',
      message: 'No active session found for this user.',
    });
  }

  const now = Date.now();
  session.lastHeartbeat = now;
  await sessionStore.setSession(userId, session);

  return res.json({
    ok: true,
    userId,
    lastHeartbeat: now,
    expiresAt: now + config.idleTimeoutMs,
  });
});
