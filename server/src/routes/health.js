import { Router } from 'express';
import { config } from '../config/env.js';
import { sessionStore } from '../services/sessionStore.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const activeSessions = await sessionStore.countSessions();
  const availableSlots = Math.max(0, config.maxSlots - activeSessions);

  res.json({
    status: 'ok',
    region: config.region,
    regionLabel: config.regionLabel,
    gpu: config.gpuModel,
    activeSessions,
    maxSlots: config.maxSlots,
    availableSlots,
    mockDocker: config.mockDocker,
    storeBackend: sessionStore.getBackendName(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});
