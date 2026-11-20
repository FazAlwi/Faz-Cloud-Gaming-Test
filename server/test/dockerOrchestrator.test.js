import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { config } from '../src/config/env.js';
import { DESKTOP_MODE, GAMES } from '../src/data/games.js';
import {
  CUSTOM_INIT_CONTAINER_PATH,
  DockerOrchestrator,
  MANAGED_AUTOSTART_MARKER,
  STEAM_COMMON_CONTAINER_PATH,
} from '../src/services/dockerOrchestrator.js';

test('defaults SELKIES_IMAGE to lscr.io/linuxserver/steam:latest and container port to 3001', () => {
  assert.equal(config.selkiesImage, 'lscr.io/linuxserver/steam:latest');
  assert.equal(config.selkiesContainerPort, 3001);
});

test('maps 3001/tcp (default HTTPS) or 3000/tcp (behind HTTPS proxy) to dynamically allocated host port (8081-8090)', () => {
  const orchestrator = new DockerOrchestrator();
  const game = GAMES[0];
  const hostPort1 = orchestrator.allocatePort([]);
  const hostPort2 = orchestrator.allocatePort([{ port: hostPort1 }]);

  assert.equal(hostPort1, 8081);
  assert.equal(hostPort2, 8082);

  const httpsConfig = orchestrator.buildContainerConfig({
    userId: 'Player One!',
    sessionId: 'sess_test1',
    game,
    hostPort: hostPort1,
    udpRange: orchestrator.computeWebRtcUdpRange(hostPort1),
    containerPort: 3001,
  });

  assert.equal(httpsConfig.Image, 'lscr.io/linuxserver/steam:latest');
  assert.deepEqual(httpsConfig.ExposedPorts['3001/tcp'], {});
  assert.deepEqual(httpsConfig.HostConfig.PortBindings['3001/tcp'], [{ HostPort: '8081' }]);
  assert.equal(httpsConfig.ExposedPorts['3000/tcp'], undefined);
  assert.equal(httpsConfig.ExposedPorts['8080/tcp'], undefined);

  const proxyHttpConfig = orchestrator.buildContainerConfig({
    userId: 'Player Two',
    sessionId: 'sess_test2',
    game,
    hostPort: hostPort2,
    udpRange: orchestrator.computeWebRtcUdpRange(hostPort2),
    containerPort: 3000,
  });

  assert.deepEqual(proxyHttpConfig.ExposedPorts['3000/tcp'], {});
  assert.deepEqual(proxyHttpConfig.HostConfig.PortBindings['3000/tcp'], [{ HostPort: '8082' }]);
  assert.equal(proxyHttpConfig.ExposedPorts['3001/tcp'], undefined);
});

test('passes NVIDIA zero-copy NVENC env vars, /dev/dri device, GPU DeviceRequests, and unconfined Steam sandbox SecurityOpt', () => {
  const orchestrator = new DockerOrchestrator();
  const game = GAMES[0];
  const containerConfig = orchestrator.buildContainerConfig({
    userId: 'alice',
    sessionId: 'sess_gpu',
    game,
    hostPort: 8081,
    udpRange: orchestrator.computeWebRtcUdpRange(8081),
  });

  assert.ok(
    containerConfig.Env.includes(
      'NVIDIA_DRIVER_CAPABILITIES=all,graphics,utility,compute,video,display'
    )
  );
  assert.ok(containerConfig.Env.includes('NVIDIA_VISIBLE_DEVICES=all'));
  assert.ok(containerConfig.Env.includes('AUTO_GPU=nvidia'));
  assert.ok(containerConfig.Env.includes('__NV_PRIME_RENDER_OFFLOAD=1'));
  assert.ok(containerConfig.Env.includes('__GLX_VENDOR_LIBRARY_NAME=nvidia'));
  assert.ok(containerConfig.Env.includes('__VK_LAYER_NV_optimus=NVIDIA_only'));
  assert.ok(
    containerConfig.Env.includes(
      'VK_DRIVER_FILES=/usr/share/vulkan/icd.d/nvidia_icd.json:/etc/vulkan/icd.d/nvidia_icd.json'
    )
  );
  assert.ok(containerConfig.Env.includes('PROTON_ENABLE_NVAPI=1'));
  assert.ok(containerConfig.Env.includes('PROTON_HIDE_NVIDIA_GPU=0'));
  assert.ok(containerConfig.Env.includes('DXVK_ENABLE_NVAPI=1'));
  assert.ok(containerConfig.Env.includes('SELKIES_VIDEO_STREAMING_MODE=true'));
  assert.ok(
    containerConfig.Env.some((entry) => entry.startsWith('SELKIES_ENCODER=')),
    'SELKIES_ENCODER env should be set'
  );

  assert.deepEqual(containerConfig.HostConfig.SecurityOpt, [
    'seccomp=unconfined',
    'apparmor=unconfined',
  ]);

  assert.deepEqual(containerConfig.HostConfig.DeviceRequests, [
    {
      Driver: 'nvidia',
      Count: -1,
      Capabilities: [
        ['gpu'],
        ['nvidia'],
        ['compute'],
        ['graphics'],
        ['utility'],
        ['video'],
        ['display'],
      ],
    },
  ]);

  assert.ok(
    containerConfig.HostConfig.Devices.some(
      (d) => d.PathOnHost === '/dev/dri' && d.PathInContainer === '/dev/dri'
    ),
    '/dev/dri device should be mounted when present on host'
  );

  // NVIDIA driver 595.80+ / 620.x hosts expose /dev/nvidia-modeset without requiring /dev/dri
  const nvidiaModesetOnlyConfig = orchestrator.buildContainerConfig({
    userId: 'alice',
    sessionId: 'sess_gpu_620',
    game,
    hostPort: 8081,
    udpRange: orchestrator.computeWebRtcUdpRange(8081),
    includeDri: false,
    includeNvidiaModeset: true,
  });

  assert.equal(
    nvidiaModesetOnlyConfig.HostConfig.Devices.some((d) => d.PathOnHost === '/dev/dri'),
    false,
    '/dev/dri should be omitted when absent on host'
  );
  assert.ok(
    nvidiaModesetOnlyConfig.HostConfig.Devices.some(
      (d) => d.PathOnHost === '/dev/nvidia-modeset' && d.PathInContainer === '/dev/nvidia-modeset'
    ),
    '/dev/nvidia-modeset should be mounted when present on host'
  );
  assert.ok(nvidiaModesetOnlyConfig.Env.includes('PIXELFLUX_WAYLAND=false'));
  assert.ok(nvidiaModesetOnlyConfig.Env.includes('AUTO_GPU=true'));

  const uinputConfig = orchestrator.buildContainerConfig({
    userId: 'alice',
    sessionId: 'sess_uinput',
    game,
    hostPort: 8081,
    udpRange: orchestrator.computeWebRtcUdpRange(8081),
    includeUinput: true,
  });

  assert.ok(
    uinputConfig.HostConfig.Devices.some(
      (d) => d.PathOnHost === '/dev/uinput' && d.PathInContainer === '/dev/uinput'
    ),
    '/dev/uinput should be mounted when present on host'
  );
});

test('mounts /srv/saves/${safeUserId} to /config:rw and optional shared read-only game library', () => {
  const orchestrator = new DockerOrchestrator();
  const game = GAMES[0];

  const withSharedGames = orchestrator.buildContainerConfig({
    userId: '../Evil_User!!',
    sessionId: 'sess_mounts1',
    game,
    hostPort: 8081,
    udpRange: orchestrator.computeWebRtcUdpRange(8081),
    savesBaseDir: '/srv/saves',
    gamesBaseDir: '/srv/games',
    mountSharedGames: true,
  });

  assert.equal(withSharedGames.name, 'cloud-game-evil_user');
  assert.ok(withSharedGames.HostConfig.Binds.includes('/srv/saves/evil_user:/config:rw'));
  assert.ok(
    withSharedGames.HostConfig.Binds.includes(`/srv/games:${STEAM_COMMON_CONTAINER_PATH}:ro`)
  );

  const withoutSharedGames = orchestrator.buildContainerConfig({
    userId: 'bob',
    sessionId: 'sess_mounts2',
    game,
    hostPort: 8082,
    udpRange: orchestrator.computeWebRtcUdpRange(8082),
    savesBaseDir: '/srv/saves',
    gamesBaseDir: '',
    mountSharedGames: false,
  });

  assert.ok(withoutSharedGames.HostConfig.Binds.includes('/srv/saves/bob:/config:rw'));
  assert.ok(
    !withoutSharedGames.HostConfig.Binds.some((b) => b.includes(STEAM_COMMON_CONTAINER_PATH)),
    'shared game library mount should be omitted when disabled'
  );
});

test('injects /custom-cont-init.d/ auto-launch script for Steam games and falls back cleanly for desktop mode', () => {
  const orchestrator = new DockerOrchestrator();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faz-cloud-test-'));
  const originalSavesDir = config.savesBaseDir;
  config.savesBaseDir = tmpRoot;

  try {
    const safeUserId = 'gamer1';
    const savePath = path.join(tmpRoot, safeUserId);
    fs.mkdirSync(savePath, { recursive: true });

    const game = GAMES[0]; // Cyber Drift 2089 (steamAppId: 1091500)
    const preparedGame = orchestrator.prepareAutoLaunchInitScript({
      safeUserId,
      savePath,
      game,
    });

    assert.equal(preparedGame.autoLaunchSteamAppId, game.steamAppId);
    assert.ok(preparedGame.initScriptHostPath && fs.existsSync(preparedGame.initScriptHostPath));

    const scriptContent = fs.readFileSync(preparedGame.initScriptHostPath, 'utf8');
    assert.ok(scriptContent.includes('export __NV_PRIME_RENDER_OFFLOAD=1'));
    assert.ok(scriptContent.includes('export VK_DRIVER_FILES='));
    assert.ok(scriptContent.includes(`-bigpicture "steam://rungameid/${game.steamAppId}"`));
    assert.ok(scriptContent.includes(`steam -bigpicture "steam://rungameid/${game.steamAppId}"`));
    assert.ok(scriptContent.includes('/defaults/autostart'));
    assert.ok(scriptContent.includes('/config/.config/openbox/autostart'));
    assert.ok(scriptContent.includes('/config/.config/labwc/autostart'));

    const mode = fs.statSync(preparedGame.initScriptHostPath).mode & 0o777;
    assert.equal(mode, 0o755, 'init script must be executable for LinuxServer init-custom-files');

    const gameContainerConfig = orchestrator.buildContainerConfig({
      userId: safeUserId,
      sessionId: 'sess_game',
      game,
      hostPort: 8081,
      udpRange: orchestrator.computeWebRtcUdpRange(8081),
      savesBaseDir: tmpRoot,
      initScriptHostPath: preparedGame.initScriptHostPath,
      mountSharedGames: false,
    });

    assert.ok(
      gameContainerConfig.HostConfig.Binds.includes(
        `${preparedGame.initScriptHostPath}:${CUSTOM_INIT_CONTAINER_PATH}:ro`
      )
    );

    // Simulate a persisted Faz-managed autostart left behind by the previous game session
    const openboxAutostart = path.join(savePath, '.config', 'openbox', 'autostart');
    fs.mkdirSync(path.dirname(openboxAutostart), { recursive: true });
    fs.writeFileSync(
      openboxAutostart,
      `${MANAGED_AUTOSTART_MARKER}\n/usr/bin/wrapped-steam -bigpicture "steam://rungameid/${game.steamAppId}"\n`
    );

    // Switching to desktop mode must omit /custom-cont-init.d/ mount and clear managed autostart
    const preparedDesktop = orchestrator.prepareAutoLaunchInitScript({
      safeUserId,
      savePath,
      game: DESKTOP_MODE,
    });

    assert.equal(preparedDesktop.autoLaunchSteamAppId, null);
    assert.equal(preparedDesktop.initScriptHostPath, null);
    assert.equal(fs.existsSync(openboxAutostart), false);
    assert.equal(fs.existsSync(preparedGame.initScriptHostPath), false);

    const desktopContainerConfig = orchestrator.buildContainerConfig({
      userId: safeUserId,
      sessionId: 'sess_desktop',
      game: DESKTOP_MODE,
      hostPort: 8081,
      udpRange: orchestrator.computeWebRtcUdpRange(8081),
      savesBaseDir: tmpRoot,
      initScriptHostPath: preparedDesktop.initScriptHostPath,
      mountSharedGames: false,
    });

    assert.ok(
      !desktopContainerConfig.HostConfig.Binds.some((b) => b.includes('/custom-cont-init.d/')),
      'desktop mode must not mount auto-launch init script'
    );
  } finally {
    config.savesBaseDir = originalSavesDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
