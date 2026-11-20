import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Docker from 'dockerode';
import { config } from '../config/env.js';
import { sanitizeUserId } from '../utils/sanitize.js';

export const MANAGED_AUTOSTART_MARKER = '# managed-by: faz-cloud-gaming';
export const CUSTOM_INIT_CONTAINER_PATH = '/custom-cont-init.d/99-faz-autolaunch.sh';
export const STEAM_COMMON_CONTAINER_PATH = '/config/.local/share/Steam/steamapps/common';

export class DockerOrchestrator {
  constructor() {
    this.docker = null;
    if (!config.mockDocker) {
      this.docker = new Docker({ socketPath: config.dockerSocketPath });
    }
  }

  /**
   * Allocates the lowest available host port in [portRangeStart, portRangeEnd].
   */
  allocatePort(activeSessions) {
    const usedPorts = new Set(activeSessions.map((s) => s.port));
    for (let port = config.portRangeStart; port <= config.portRangeEnd; port += 1) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }
    return null;
  }

  /**
   * Computes a dedicated non-overlapping WebRTC UDP media port range for a given slot port.
   * Example (default): slot 0 (8081) -> 49152-49171, slot 1 (8082) -> 49172-49191.
   */
  computeWebRtcUdpRange(hostPort) {
    const slotIndex = Math.max(0, hostPort - config.portRangeStart);
    const start = config.webrtcUdpPortStart + slotIndex * config.webrtcUdpPortsPerSlot;
    const end = start + config.webrtcUdpPortsPerSlot - 1;
    return { start, end, label: `${start}-${end}` };
  }

  /**
   * Validates and normalizes a numeric Steam App ID to prevent shell injection.
   */
  sanitizeSteamAppId(steamAppId) {
    const raw = String(steamAppId ?? '').trim();
    return /^\d+$/.test(raw) ? raw : '';
  }

  /**
   * Resolves the LinuxServer Steam container port:
   * - 3001 (default): built-in HTTPS (required for browser WebCodecs & Gaming Mode relative mouse capture)
   * - 3000: HTTP when placed behind an external HTTPS reverse proxy
   */
  getContainerPort(overridePort = config.selkiesContainerPort) {
    return overridePort === 3000 ? 3000 : 3001;
  }

  /**
   * Resolves stream protocol for real containers: defaults to https when exposing 3001 directly,
   * unless STREAM_PROTOCOL was explicitly overridden.
   */
  getRealStreamProtocol(containerPort) {
    if (config.streamProtocolExplicit) {
      return config.streamProtocol;
    }
    return containerPort === 3001 ? 'https' : config.streamProtocol;
  }

  /**
   * Generates an executable /custom-cont-init.d/ script that configures Steam Big Picture
   * auto-launch for a specific Steam App ID on both X11 (Openbox) and Wayland (Labwc).
   */
  buildAutoLaunchScript(steamAppId) {
    const safeAppId = this.sanitizeSteamAppId(steamAppId);
    if (!safeAppId) {
      throw new Error(`Invalid Steam App ID: "${steamAppId}"`);
    }

    return [
      '#!/usr/bin/with-contenv bash',
      'set -euo pipefail',
      '',
      `AUTOSTART_CONTENT=$(cat <<'EOF'`,
      MANAGED_AUTOSTART_MARKER,
      'if [ -x /usr/bin/wrapped-steam ]; then',
      `  /usr/bin/wrapped-steam -bigpicture "steam://rungameid/${safeAppId}"`,
      'else',
      `  steam -bigpicture "steam://rungameid/${safeAppId}"`,
      'fi',
      'EOF',
      ')',
      '',
      '# Override both image defaults and persisted user autostart files (Openbox X11 + Labwc Wayland)',
      'for target in \\',
      '  /defaults/autostart \\',
      '  /defaults/autostart_wayland \\',
      '  /config/.config/openbox/autostart \\',
      '  /config/.config/labwc/autostart; do',
      '  mkdir -p "$(dirname "$target")"',
      '  printf \'%s\\n\' "$AUTOSTART_CONTENT" > "$target"',
      '  chmod 755 "$target"',
      'done',
      '',
      'chown -R abc:abc /config/.config/openbox /config/.config/labwc 2>/dev/null || true',
      '',
    ].join('\n');
  }

  /**
   * Removes previously injected Faz-managed autostart files from a persisted /config save dir
   * so switching to Desktop/Steam mode restores standard /defaults/autostart behavior without
   * clobbering custom user-authored autostart scripts.
   */
  clearManagedAutostartFiles(savePath) {
    const candidates = [
      path.join(savePath, '.config', 'openbox', 'autostart'),
      path.join(savePath, '.config', 'labwc', 'autostart'),
    ];

    for (const filePath of candidates) {
      try {
        if (!fs.existsSync(filePath)) continue;
        const contents = fs.readFileSync(filePath, 'utf8');
        if (contents.includes(MANAGED_AUTOSTART_MARKER)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.warn(`[DockerOrchestrator] Failed to reset managed autostart ${filePath}: ${err.message}`);
      }
    }
  }

  /**
   * Prepares or cleans up the per-user /custom-cont-init.d/ auto-launch script on the host.
   */
  prepareAutoLaunchInitScript({ safeUserId, savePath, game }) {
    const safeSteamAppId =
      game && game.id !== 'desktop' ? this.sanitizeSteamAppId(game.steamAppId) : '';
    const initDir = path.join(config.savesBaseDir, '.faz-init', safeUserId);
    const initScriptHostPath = path.join(initDir, '99-faz-autolaunch.sh');

    if (safeSteamAppId) {
      fs.mkdirSync(initDir, { recursive: true });
      fs.writeFileSync(initScriptHostPath, this.buildAutoLaunchScript(safeSteamAppId), {
        mode: 0o755,
      });
      fs.chmodSync(initScriptHostPath, 0o755);
      return {
        autoLaunchSteamAppId: safeSteamAppId,
        initScriptHostPath,
      };
    }

    // Desktop / Steam mode fallback: clean any Faz-managed autostart & stale staged script
    this.clearManagedAutostartFiles(savePath);
    try {
      if (fs.existsSync(initScriptHostPath)) {
        fs.unlinkSync(initScriptHostPath);
      }
    } catch (err) {
      console.warn(`[DockerOrchestrator] Failed to remove stale init script ${initScriptHostPath}: ${err.message}`);
    }

    return {
      autoLaunchSteamAppId: null,
      initScriptHostPath: null,
    };
  }

  /**
   * Builds the dockerode createContainer specification for lscr.io/linuxserver/steam:latest.
   * Extracted as a pure helper so container parameters can be verified in unit tests.
   */
  buildContainerConfig({
    userId,
    sessionId,
    game,
    hostPort,
    udpRange,
    containerPort = config.selkiesContainerPort,
    savesBaseDir = config.savesBaseDir,
    gamesBaseDir = config.gamesBaseDir,
    selkiesImage = config.selkiesImage,
    initScriptHostPath = null,
    mountSharedGames = Boolean(gamesBaseDir),
    includeDri = true,
    includeNvidiaModeset = false,
  }) {
    const safeUserId = sanitizeUserId(userId);
    if (!safeUserId) {
      throw new Error(`Invalid userId for container creation: "${userId}"`);
    }

    const resolvedContainerPort = this.getContainerPort(containerPort);
    const tcpPortKey = `${resolvedContainerPort}/tcp`;
    const containerName = `cloud-game-${safeUserId}`;
    const savePath = path.posix.join(savesBaseDir, safeUserId);
    const safeSteamAppId =
      game && game.id !== 'desktop' ? this.sanitizeSteamAppId(game.steamAppId) : '';
    const shouldMountSharedGames = Boolean(mountSharedGames && gamesBaseDir);

    const exposedPorts = {
      [tcpPortKey]: {},
    };
    const portBindings = {
      [tcpPortKey]: [{ HostPort: String(hostPort) }],
    };

    // Explicitly bind the per-container WebRTC UDP media port range 1:1
    for (let udpPort = udpRange.start; udpPort <= udpRange.end; udpPort += 1) {
      const key = `${udpPort}/udp`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostPort: String(udpPort) }];
    }

    const devices = [];

    if (includeDri) {
      devices.push({
        PathOnHost: '/dev/dri',
        PathInContainer: '/dev/dri',
        CgroupPermissions: 'rwm',
      });
    }

    if (includeNvidiaModeset) {
      devices.push({
        PathOnHost: '/dev/nvidia-modeset',
        PathInContainer: '/dev/nvidia-modeset',
        CgroupPermissions: 'rwm',
      });
    }

    // Per-user persistent /config volume (Steam login token, Proton prefixes, saves)
    const binds = [`${savePath}:/config:rw`];

    // Optional shared read-only game library so pre-installed games aren't re-downloaded per player
    if (shouldMountSharedGames) {
      binds.push(`${gamesBaseDir}:${STEAM_COMMON_CONTAINER_PATH}:ro`);
    }

    // Optional Steam Big Picture auto-launch init script (omitted in desktop mode)
    if (initScriptHostPath && safeSteamAppId) {
      binds.push(`${initScriptHostPath}:${CUSTOM_INIT_CONTAINER_PATH}:ro`);
    }

    const resolvedAutoGpu = config.autoGpu || (includeDri ? 'nvidia' : 'true');

    return {
      name: containerName,
      Image: selkiesImage,
      ExposedPorts: exposedPorts,
      Env: [
        `PUID=${config.puid}`,
        `PGID=${config.pgid}`,
        `TZ=${config.tz}`,
        `PIXELFLUX_WAYLAND=${config.pixelfluxWayland ? 'true' : 'false'}`,
        'NVIDIA_DRIVER_CAPABILITIES=all',
        'NVIDIA_VISIBLE_DEVICES=all',
        `AUTO_GPU=${resolvedAutoGpu}`,
        'SELKIES_VIDEO_STREAMING_MODE=true',
        `SELKIES_ENCODER=${config.selkiesEncoder}`,
        `SELKIES_VIDEO_BITRATE=${config.selkiesVideoBitrate}`,
        `SELKIES_FRAMERATE=${config.selkiesFramerate}`,
        'SELKIES_ENABLE_RESIZE=true',
        `SELKIES_WEBRTC_PORT_RANGE=${udpRange.label}`,
        `WEBRTC_MIN_PORT=${udpRange.start}`,
        `WEBRTC_MAX_PORT=${udpRange.end}`,
        `PROTON_VERSION=${config.protonVersion}`,
        `GAME_ID=${game.id}`,
        `STEAM_APP_ID=${safeSteamAppId}`,
        'SAVES_DIR=/config',
        `GAMES_DIR=${shouldMountSharedGames ? STEAM_COMMON_CONTAINER_PATH : ''}`,
      ],
      Labels: {
        'managed-by': 'faz-cloud-gaming',
        'cloud-gaming.user': safeUserId,
        'cloud-gaming.session': sessionId,
        'cloud-gaming.port': String(hostPort),
        'cloud-gaming.container-port': String(resolvedContainerPort),
        'cloud-gaming.udp-range': udpRange.label,
        'cloud-gaming.game-id': game.id,
      },
      HostConfig: {
        // Required on Ubuntu 24.04 so Steam's bubblewrap sandbox runs natively instead of proot-bwrap
        SecurityOpt: ['seccomp=unconfined', 'apparmor=unconfined'],
        // Equivalent to `--gpus all`
        DeviceRequests: [
          {
            Driver: 'nvidia',
            Count: -1,
            Capabilities: [['gpu']],
          },
        ],
        // Expose /dev/dri so NVENC, Vulkan, and Proton initialize cleanly on NVIDIA L4
        Devices: devices,
        Binds: binds,
        PortBindings: portBindings,
        // 2 GB shared memory required for Selkies / Steam / Chromium / Proton stability
        ShmSize: 2 * 1024 * 1024 * 1024,
        AutoRemove: false,
      },
    };
  }

  /**
   * Launches either a mock container (MOCK_DOCKER=true) or a real GPU-accelerated
   * LinuxServer Steam (Selkies + Proton) Docker container (MOCK_DOCKER=false).
   */
  async launchSessionContainer({ userId, game, activeSessions }) {
    const safeUserId = sanitizeUserId(userId);
    if (!safeUserId) {
      const err = new Error('Invalid userId for container launch.');
      err.code = 'INVALID_USER_ID';
      throw err;
    }

    const hostPort = this.allocatePort(activeSessions);
    if (!hostPort) {
      const err = new Error('No free host ports available in configured range.');
      err.code = 'NO_FREE_PORTS';
      throw err;
    }

    const sessionId = `sess_${crypto.randomBytes(6).toString('hex')}`;
    const containerName = `cloud-game-${safeUserId}`;
    const containerPort = this.getContainerPort();
    const udpRange = this.computeWebRtcUdpRange(hostPort);
    const savePath = path.posix.join(config.savesBaseDir, safeUserId);
    const gamesPath = config.gamesBaseDir;
    const autoLaunchSteamAppId =
      game && game.id !== 'desktop' ? this.sanitizeSteamAppId(game.steamAppId) || null : null;
    const now = Date.now();

    if (config.mockDocker) {
      const streamUrl = `${config.streamProtocol}://${config.publicHost}:${config.port}/mock-stream/${sessionId}`;
      return {
        sessionId,
        userId: safeUserId,
        gameId: game.id,
        gameTitle: game.title,
        containerId: `mock-${sessionId}`,
        containerName,
        port: hostPort,
        containerPort,
        webrtcUdpRange: udpRange.label,
        streamUrl,
        encoder: config.selkiesEncoder,
        savePath,
        gamesPath,
        autoLaunchSteamAppId,
        mock: true,
        createdAt: now,
        lastHeartbeat: now,
      };
    }

    // Real Docker Engine orchestration on GCP NVIDIA L4 host
    fs.mkdirSync(savePath, { recursive: true });

    let mountSharedGames = false;
    if (gamesPath) {
      if (fs.existsSync(gamesPath)) {
        // Ensure nested mountpoint exists inside the user save dir before Docker bind-mounts RO
        fs.mkdirSync(path.join(savePath, '.local', 'share', 'Steam', 'steamapps', 'common'), {
          recursive: true,
        });
        mountSharedGames = true;
      } else {
        console.warn(
          `[DockerOrchestrator] Shared games directory "${gamesPath}" does not exist on host — skipping read-only mount.`
        );
      }
    }

    const { initScriptHostPath } = this.prepareAutoLaunchInitScript({
      safeUserId,
      savePath,
      game,
    });

    // Remove any stale container with the same name before launching
    await this.removeExistingContainerByName(containerName);

    const containerConfig = this.buildContainerConfig({
      userId: safeUserId,
      sessionId,
      game,
      hostPort,
      udpRange,
      containerPort,
      initScriptHostPath,
      mountSharedGames,
      includeDri: fs.existsSync('/dev/dri'),
      includeNvidiaModeset: fs.existsSync('/dev/nvidia-modeset'),
    });

    const container = await this.docker.createContainer(containerConfig);
    await container.start();

    const realProtocol = this.getRealStreamProtocol(containerPort);
    const streamUrl = `${realProtocol}://${config.publicHost}:${hostPort}`;
    return {
      sessionId,
      userId: safeUserId,
      gameId: game.id,
      gameTitle: game.title,
      containerId: container.id,
      containerName,
      port: hostPort,
      containerPort,
      webrtcUdpRange: udpRange.label,
      streamUrl,
      encoder: config.selkiesEncoder,
      savePath,
      gamesPath: mountSharedGames ? gamesPath : '',
      autoLaunchSteamAppId,
      mock: false,
      createdAt: now,
      lastHeartbeat: now,
    };
  }

  async removeExistingContainerByName(containerName) {
    if (!this.docker) return;
    try {
      const existing = this.docker.getContainer(containerName);
      try {
        await existing.stop({ t: 3 });
      } catch {
        // Container may already be stopped
      }
      await existing.remove({ force: true });
    } catch (err) {
      if (err.statusCode !== 404) {
        console.warn(`[DockerOrchestrator] Cleanup warning for ${containerName}: ${err.message}`);
      }
    }
  }

  async stopSessionContainer(session) {
    if (!session) return;

    if (config.mockDocker || session.mock) {
      console.log(
        `[DockerOrchestrator] (MOCK) Stopped container ${session.containerName} (port ${session.port}, UDP ${session.webrtcUdpRange})`
      );
      return;
    }

    if (!this.docker) return;

    const container = this.docker.getContainer(session.containerId);
    try {
      await container.stop({ t: 5 });
    } catch (err) {
      // 304 = already stopped, 404 = already removed
      if (err.statusCode !== 304 && err.statusCode !== 404) {
        console.warn(`[DockerOrchestrator] Error stopping ${session.containerId}: ${err.message}`);
      }
    }

    try {
      await container.remove({ force: true });
    } catch (err) {
      if (err.statusCode !== 404) {
        console.warn(`[DockerOrchestrator] Error removing ${session.containerId}: ${err.message}`);
      }
    }

    // Best-effort cleanup of staged auto-launch init script
    const safeUserId = sanitizeUserId(session.userId);
    if (safeUserId) {
      const initScriptHostPath = path.join(
        config.savesBaseDir,
        '.faz-init',
        safeUserId,
        '99-faz-autolaunch.sh'
      );
      try {
        if (fs.existsSync(initScriptHostPath)) {
          fs.unlinkSync(initScriptHostPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export const dockerOrchestrator = new DockerOrchestrator();
