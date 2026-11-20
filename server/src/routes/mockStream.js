import { Router } from 'express';
import { config } from '../config/env.js';
import { sessionStore } from '../services/sessionStore.js';

export const mockStreamRouter = Router();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

mockStreamRouter.get('/:sessionId', async (req, res) => {
  const session = await sessionStore.getSessionById(req.params.sessionId);
  if (!session) {
    return res.status(404).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Session Ended</title>
  <style>
    body { margin: 0; background: #0B0F17; color: #94A3B8; font-family: system-ui, -apple-system, sans-serif; display: grid; place-items: center; height: 100vh; }
    .box { text-align: center; padding: 24px 32px; background: #131926; border: 1px solid #1E293B; border-radius: 12px; }
    h1 { color: #F8FAFC; font-size: 16px; margin: 0 0 8px; }
    p { font-size: 13px; margin: 0; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Stream Disconnected</h1>
    <p>This container session is no longer active.</p>
  </div>
</body>
</html>`);
  }

  const safeTitle = escapeHtml(session.gameTitle);
  const safeUser = escapeHtml(session.userId);
  const safePort = escapeHtml(session.port);
  const safeUdp = escapeHtml(session.webrtcUdpRange);
  const safeSavePath = escapeHtml(session.savePath);
  const safeEncoder = escapeHtml(session.encoder);
  const safeRegion = escapeHtml(`${config.regionLabel} • ${config.region}`);

  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} — Selkies WebRTC Stream (Mock)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #070B12; color: #F8FAFC; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; user-select: none; }
    canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
    .overlay {
      position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
      pointer-events: none; padding: 32px;
    }
    .panel {
      background: rgba(11, 15, 23, 0.78);
      backdrop-filter: blur(12px);
      border: 1px solid #1E293B;
      border-radius: 14px;
      padding: 28px 34px;
      max-width: 520px;
      width: 100%;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
    }
    .eyebrow {
      display: inline-flex; align-items: center; gap: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
      color: #22D3EE; margin-bottom: 12px;
    }
    .dot { width: 7px; height: 7px; border-radius: 999px; background: #10B981; }
    h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 6px; color: #F8FAFC; }
    .sub { font-size: 13px; color: #94A3B8; margin-bottom: 22px; line-height: 1.5; }
    .meta {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
    }
    .cell {
      background: rgba(19, 25, 38, 0.85);
      border: 1px solid #1E293B;
      border-radius: 8px;
      padding: 10px 12px;
    }
    .label { color: #64748B; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
    .value { color: #E2E8F0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hint {
      margin-top: 18px; padding-top: 14px; border-top: 1px solid #1E293B;
      display: flex; align-items: center; justify-content: space-between;
      font-size: 12px; color: #64748B;
    }
    .keys { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #94A3B8; }
  </style>
</head>
<body>
  <canvas id="stream"></canvas>
  <div class="overlay">
    <div class="panel">
      <div class="eyebrow"><span class="dot"></span> MOCK_DOCKER WebRTC Stream Active</div>
      <h1>${safeTitle}</h1>
      <p class="sub">Simulated Selkies-GStreamer + Proton-GE viewport. Move your mouse or press WASD to verify interactive frame input.</p>
      <div class="meta">
        <div class="cell"><div class="label">Container Port</div><div class="value">:${safePort} (UDP ${safeUdp})</div></div>
        <div class="cell"><div class="label">Encoder</div><div class="value">${safeEncoder} • 60 FPS</div></div>
        <div class="cell"><div class="label">User Save Mount</div><div class="value">${safeSavePath}</div></div>
        <div class="cell"><div class="label">Host Region</div><div class="value">${safeRegion}</div></div>
      </div>
      <div class="hint">
        <span>User: <strong style="color:#E2E8F0">${safeUser}</strong></span>
        <span class="keys" id="inputState">Input: Idle</span>
      </div>
    </div>
  </div>
  <script>
    const canvas = document.getElementById('stream');
    const ctx = canvas.getContext('2d');
    const inputState = document.getElementById('inputState');

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    let mouse = { x: w / 2, y: h / 2 };
    const pressed = new Set();

    window.addEventListener('resize', () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    });

    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    });

    window.addEventListener('keydown', (e) => {
      pressed.add(e.key.toUpperCase());
      inputState.textContent = 'Keys: ' + Array.from(pressed).slice(0, 4).join(' + ');
    });

    window.addEventListener('keyup', (e) => {
      pressed.delete(e.key.toUpperCase());
      inputState.textContent = pressed.size ? 'Keys: ' + Array.from(pressed).slice(0, 4).join(' + ') : 'Input: Ready';
    });

    const nodes = Array.from({ length: 42 }, (_, i) => ({
      x: (i * 197) % w,
      y: (i * 131) % h,
      vx: ((i % 5) - 2) * 0.25 + 0.15,
      vy: (((i + 2) % 5) - 2) * 0.22 - 0.1,
      r: 1.5 + (i % 3) * 0.8,
    }));

    let frames = 0;
    let lastReport = performance.now();

    function draw(now) {
      ctx.fillStyle = '#070B12';
      ctx.fillRect(0, 0, w, h);

      // Subtle interactive cyan spotlight following cursor
      const grad = ctx.createRadialGradient(mouse.x, mouse.y, 12, mouse.x, mouse.y, 380);
      grad.addColorStop(0, 'rgba(6, 182, 212, 0.14)');
      grad.addColorStop(1, 'rgba(6, 182, 212, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Ambient drifting particles
      for (const n of nodes) {
        n.x = (n.x + n.vx + w) % w;
        n.y = (n.y + n.vy + h) % h;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 211, 238, 0.35)';
        ctx.fill();
      }

      frames += 1;
      if (now - lastReport >= 1000) {
        const fps = Math.min(60, Math.round((frames * 1000) / (now - lastReport)));
        const pingMs = 4 + Math.floor(Math.random() * 4);
        window.parent.postMessage({ type: 'STREAM_TELEMETRY', fps, pingMs }, '*');
        frames = 0;
        lastReport = now;
      }

      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
  </script>
</body>
</html>`);
});
