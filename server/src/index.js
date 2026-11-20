import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { gamesRouter } from './routes/games.js';
import { sessionsRouter } from './routes/sessions.js';
import { mockStreamRouter } from './routes/mockStream.js';
import { sessionStore } from './services/sessionStore.js';
import { startSessionReaper, stopSessionReaper } from './services/sessionReaper.js';

const app = express();

app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  })
);
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/games', gamesRouter);
app.use('/api/sessions', sessionsRouter);

if (config.mockDocker) {
  app.use('/mock-stream', mockStreamRouter);
}

app.use((_req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Endpoint not found.' });
});

async function bootstrap() {
  await sessionStore.init();
  startSessionReaper();

  const server = app.listen(config.port, () => {
    console.log(
      `[Server] Cloud Gaming API listening on http://localhost:${config.port} (MOCK_DOCKER=${config.mockDocker}, MAX_SLOTS=${config.maxSlots}, store=${sessionStore.getBackendName()})`
    );
  });

  const shutdown = async () => {
    console.log('\n[Server] Shutting down...');
    stopSessionReaper();
    server.close(async () => {
      await sessionStore.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
