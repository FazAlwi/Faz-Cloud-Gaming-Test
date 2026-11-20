import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Docker from 'dockerode';
import { config } from '../config/env.js';

class DockerOrchestrator {
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
   * Launches either a mock container (MOCK_DOCKER=true) or a real GPU-accelerated
   * Selkies-GStreamer + Proton-GE Docker container (MOCK_DOCKER=false).
   */
  async launchSessionContainer({ userId, game, activeSessions }) {
    const hostPort = this.allocatePort(activeSessions);
    if (!hostPort) {
      const err = new Error('No free host ports available in configured range.');
      err.code = 'NO_FREE_PORTS';
      throw err;
    }

    const sessionId = `sess_${crypto.randomBytes(6).toString('hex')}`;
    const containerName = `cloud-game-${userId}`;
    const udpRange = this.computeWebRtcUdpRange(hostPort);
    const savePath = path.posix.join(config.savesBaseDir, userId);
    const gamesPath = config.gamesBaseDir;
    const now = Date.now();

    if (config.mockDocker) {
      const streamUrl = `${config.streamProtocol}://${config.publicHost}:${config.port}/mock-stream/${sessionId}`;
      return {
        sessionId,
        userId,
        gameId: game.id,
        gameTitle: game.title,
        containerId: `mock-${sessionId}`,
        containerName,
        port: hostPort,
        webrtcUdpRange: udpRange.label,
        streamUrl,
        encoder: config.selkiesEncoder,
        savePath,
        gamesPath,
        mock: true,
        createdAt: now,
        lastHeartbeat: now,
      };
    }

    // Real Docker Engine orchestration on GCP NVIDIA L4 host
    fs.mkdirSync(savePath, { recursive: true });

    // Remove any stale container with the same name before launching
    await this.removeExistingContainerByName(containerName);

    const exposedPorts = {
      '8080/tcp': {},
    };
    const portBindings = {
      '8080/tcp': [{ HostPort: String(hostPort) }],
    };

    // Explicitly bind the per-container WebRTC UDP media port range 1:1
    for (let udpPort = udpRange.start; udpPort <= udpRange.end; udpPort += 1) {
      const key = `${udpPort}/udp`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostPort: String(udpPort) }];
    }

    const container = await this.docker.createContainer({
      name: containerName,
      Image: config.selkiesImage,
      ExposedPorts: exposedPorts,
      Env: [
        'NVIDIA_DRIVER_CAPABILITIES=all',
        'NVIDIA_VISIBLE_DEVICES=all',
        `SELKIES_ENCODER=${config.selkiesEncoder}`,
        `SELKIES_VIDEO_BITRATE=${config.selkiesVideoBitrate}`,
        `SELKIES_FRAMERATE=${config.selkiesFramerate}`,
        'SELKIES_ENABLE_RESIZE=true',
        `SELKIES_WEBRTC_PORT_RANGE=${udpRange.label}`,
        `WEBRTC_MIN_PORT=${udpRange.start}`,
        `WEBRTC_MAX_PORT=${udpRange.end}`,
        `PROTON_VERSION=${config.protonVersion}`,
        `GAME_ID=${game.id}`,
        `STEAM_APP_ID=${game.steamAppId || ''}`,
        'GAMES_DIR=/opt/games',
        'SAVES_DIR=/home/user/.local/share/saves',
      ],
      Labels: {
        'managed-by': 'faz-cloud-gaming',
        'cloud-gaming.user': userId,
        'cloud-gaming.session': sessionId,
        'cloud-gaming.port': String(hostPort),
        'cloud-gaming.udp-range': udpRange.label,
      },
      HostConfig: {
        // Equivalent to `--gpus all`
        DeviceRequests: [
          {
            Driver: 'nvidia',
            Count: -1,
            Capabilities: [['gpu']],
          },
        ],
        // Expose /dev/dri so NVENC, Vulkan, and Proton-GE initialize cleanly on NVIDIA L4
        Devices: [
          {
            PathOnHost: '/dev/dri',
            PathInContainer: '/dev/dri',
            CgroupPermissions: 'rwm',
          },
        ],
        // Per-user persistent save volume + shared read-only game library mount
        Binds: [
          `${savePath}:/home/user/.local/share/saves:rw`,
          `${gamesPath}:/opt/games:ro`,
        ],
        PortBindings: portBindings,
        // 2 GB shared memory required for GStreamer / Chromium / Proton stability
        ShmSize: 2 * 1024 * 1024 * 1024,
        AutoRemove: false,
      },
    });

    await container.start();

    const streamUrl = `${config.streamProtocol}://${config.publicHost}:${hostPort}`;
    return {
      sessionId,
      userId,
      gameId: game.id,
      gameTitle: game.title,
      containerId: container.id,
      containerName,
      port: hostPort,
      webrtcUdpRange: udpRange.label,
      streamUrl,
      encoder: config.selkiesEncoder,
      savePath,
      gamesPath,
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
  }
}

export const dockerOrchestrator = new DockerOrchestrator();
