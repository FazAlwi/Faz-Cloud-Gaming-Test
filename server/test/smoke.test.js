import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Force clean MOCK_DOCKER=true & MAX_SLOTS=2 defaults before importing app modules
process.env.MOCK_DOCKER = 'true';
process.env.MAX_SLOTS = '2';
process.env.REDIS_URL = '';

const { createApp } = await import('../src/index.js');
const { sessionStore } = await import('../src/services/sessionStore.js');

const clientDistIndex = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
  'client',
  'dist',
  'index.html'
);

async function startTestServer() {
  await sessionStore.init();
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopTestServer(server) {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  // Clean up any leftover sessions in memoryStore
  const remaining = await sessionStore.listSessions();
  for (const s of remaining) {
    await sessionStore.deleteSession(s.userId);
  }
}

test('MOCK_DOCKER=true smoke suite: health, start, capacity 503, heartbeat, and stop', async () => {
  const { server, baseUrl } = await startTestServer();

  try {
    // 0. GET / serves built frontend if client/dist/index.html exists
    if (fs.existsSync(clientDistIndex)) {
      const rootRes = await fetch(`${baseUrl}/`);
      assert.equal(rootRes.status, 200);
      const rootHtml = await rootRes.text();
      assert.ok(rootHtml.toLowerCase().includes('<!doctype html>'));
    }

    // 1. GET /api/health
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.status, 'ok');
    assert.equal(health.mockDocker, true);
    assert.equal(health.maxSlots, 2);
    assert.equal(health.activeSessions, 0);
    assert.equal(health.availableSlots, 2);

    // 2. POST /api/sessions/start (game session -> slot 1, port 8081)
    const start1Res = await fetch(`${baseUrl}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'alice', gameId: 'cyber-drift-2089' }),
    });
    assert.equal(start1Res.status, 201);
    const start1 = await start1Res.json();
    assert.equal(start1.reused, false);
    assert.equal(start1.session.userId, 'alice');
    assert.equal(start1.session.port, 8081);
    assert.equal(start1.session.containerPort, 3001);
    assert.equal(start1.session.autoLaunchSteamAppId, '1091500');
    assert.equal(start1.session.mock, true);

    // Reusing existing session for alice returns 200 reused: true
    const reuseRes = await fetch(`${baseUrl}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'alice', gameId: 'cyber-drift-2089' }),
    });
    assert.equal(reuseRes.status, 200);
    const reused = await reuseRes.json();
    assert.equal(reused.reused, true);
    assert.equal(reused.session.sessionId, start1.session.sessionId);

    // 3. POST /api/sessions/start (desktop mode -> slot 2, port 8082)
    const start2Res = await fetch(`${baseUrl}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'bob', gameId: 'desktop' }),
    });
    assert.equal(start2Res.status, 201);
    const start2 = await start2Res.json();
    assert.equal(start2.reused, false);
    assert.equal(start2.session.port, 8082);
    assert.equal(start2.session.autoLaunchSteamAppId, null);

    // 4. Slot capacity 503 when MAX_SLOTS (2) is full
    const fullRes = await fetch(`${baseUrl}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'charlie', gameId: 'hollow-bastion' }),
    });
    assert.equal(fullRes.status, 503);
    const fullBody = await fullRes.json();
    assert.equal(fullBody.error, 'ALL_SLOTS_FULL');
    assert.equal(fullBody.activeSessions, 2);
    assert.equal(fullBody.maxSlots, 2);

    // 5. POST /api/sessions/heartbeat
    const hbRes = await fetch(`${baseUrl}/api/sessions/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'alice' }),
    });
    assert.equal(hbRes.status, 200);
    const hbBody = await hbRes.json();
    assert.equal(hbBody.ok, true);
    assert.equal(hbBody.userId, 'alice');
    assert.ok(hbBody.expiresAt > hbBody.lastHeartbeat);

    // 6. POST /api/sessions/stop frees the slot and port
    const stopRes = await fetch(`${baseUrl}/api/sessions/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'alice' }),
    });
    assert.equal(stopRes.status, 200);
    const stopBody = await stopRes.json();
    assert.equal(stopBody.stopped, true);
    assert.equal(stopBody.releasedPort, 8081);
    assert.equal(stopBody.activeSessions, 1);

    // Verify slot is freed via /api/health and charlie can now start on port 8081
    const healthAfterStop = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(healthAfterStop.activeSessions, 1);
    assert.equal(healthAfterStop.availableSlots, 1);

    const start3Res = await fetch(`${baseUrl}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'charlie', gameId: 'hollow-bastion' }),
    });
    assert.equal(start3Res.status, 201);
    const start3 = await start3Res.json();
    assert.equal(start3.session.port, 8081);
    assert.equal(start3.session.autoLaunchSteamAppId, '367520');
  } finally {
    await stopTestServer(server);
  }
});
