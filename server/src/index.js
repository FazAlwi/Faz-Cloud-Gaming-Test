import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { gamesRouter } from './routes/games.js';
import { sessionsRouter } from './routes/sessions.js';
import { mockStreamRouter } from './routes/mockStream.js';
import { sessionStore } from './services/sessionStore.js';
import { startSessionReaper, stopSessionReaper } from './services/sessionReaper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(__dirname, '../..', 'client', 'dist');

export function createApp() {
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

  // Serve built React frontend (/client/dist) directly when present
  if (fs.existsSync(path.join(clientDistDir, 'index.html'))) {
    app.use(express.static(clientDistDir));
    app.get(/^(?!\/api\/|\/mock-stream\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Endpoint not found.' });
  });

  return app;
}

async function resolveAutoPublicHost() {
  if (config.publicHost !== 'auto') return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: controller.signal }
    );
    if (res.ok) {
      const ip = (await res.text()).trim();
      if (ip) {
        config.publicHost = ip;
        console.log(`[Server] Auto-detected GCP external IP: ${ip}`);
      }
    }
  } catch (err) {
    console.warn(`[Server] Failed to auto-detect GCP external IP (${err.message}); keeping PUBLIC_HOST="${config.publicHost}".`);
  } finally {
    clearTimeout(timer);
  }
}

export async function bootstrap(port = config.port) {
  await resolveAutoPublicHost();
  await sessionStore.init();
  startSessionReaper();

  const app = createApp();
  const server = app.listen(port, () => {
    const address = server.address();
    const listeningPort = typeof address === 'object' && address ? address.port : port;
    console.log(
      `[Server] Cloud Gaming API listening on http://localhost:${listeningPort} (MOCK_DOCKER=${config.mockDocker}, MAX_SLOTS=${config.maxSlots}, PUBLIC_HOST=${config.publicHost}, store=${sessionStore.getBackendName()})`
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

  return { app, server };
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  bootstrap().catch((err) => {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
  });
}
