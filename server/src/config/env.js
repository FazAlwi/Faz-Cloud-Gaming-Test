import 'dotenv/config';

function parseBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function parseIntOrDefault(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseContainerPort(value, fallback = 3001) {
  const parsed = parseIntOrDefault(value, fallback);
  return parsed === 3000 || parsed === 3001 ? parsed : fallback;
}

const rawStreamProtocol = (process.env.STREAM_PROTOCOL || '').trim();
const rawGamesBaseDir = process.env.GAMES_BASE_DIR;

export const config = {
  port: parseIntOrDefault(process.env.PORT, 4000),
  publicHost: process.env.PUBLIC_HOST || 'localhost',
  streamProtocol: rawStreamProtocol || 'http',
  streamProtocolExplicit: rawStreamProtocol.length > 0,
  corsOrigin: process.env.CORS_ORIGIN || '*',

  region: process.env.REGION || 'asia-southeast1',
  regionLabel: process.env.REGION_LABEL || 'Singapore',
  gpuModel: process.env.GPU_MODEL || 'NVIDIA L4 (24GB)',

  maxSlots: parseIntOrDefault(process.env.MAX_SLOTS, 2),
  portRangeStart: parseIntOrDefault(process.env.PORT_RANGE_START, 8081),
  portRangeEnd: parseIntOrDefault(process.env.PORT_RANGE_END, 8090),

  webrtcUdpPortStart: parseIntOrDefault(process.env.WEBRTC_UDP_PORT_START, 49152),
  webrtcUdpPortsPerSlot: parseIntOrDefault(process.env.WEBRTC_UDP_PORTS_PER_SLOT, 20),

  mockDocker: parseBool(process.env.MOCK_DOCKER, true),
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
  selkiesImage: process.env.SELKIES_IMAGE || 'lscr.io/linuxserver/steam:latest',
  selkiesContainerPort: parseContainerPort(process.env.SELKIES_CONTAINER_PORT, 3001),
  selkiesEncoder: process.env.SELKIES_ENCODER || 'nvh264enc',
  selkiesVideoBitrate: parseIntOrDefault(process.env.SELKIES_VIDEO_BITRATE, 12000),
  selkiesFramerate: parseIntOrDefault(process.env.SELKIES_FRAMERATE, 60),
  pixelfluxWayland: parseBool(process.env.PIXELFLUX_WAYLAND, false),
  autoGpu: (process.env.AUTO_GPU || '').trim(),
  protonVersion: process.env.PROTON_VERSION || 'GE-Proton9',
  puid: parseIntOrDefault(process.env.PUID, 1000),
  pgid: parseIntOrDefault(process.env.PGID, 1000),
  tz: process.env.TZ || 'Etc/UTC',

  savesBaseDir: process.env.SAVES_BASE_DIR || '/srv/saves',
  gamesBaseDir: rawGamesBaseDir !== undefined ? rawGamesBaseDir.trim() : '/srv/games',

  redisUrl: process.env.REDIS_URL || '',

  reaperIntervalMs: parseIntOrDefault(process.env.REAPER_INTERVAL_MS, 60_000),
  idleTimeoutMs: parseIntOrDefault(process.env.IDLE_TIMEOUT_MS, 600_000),
  autoStopVmIdleMs: parseIntOrDefault(process.env.AUTO_STOP_VM_IDLE_MS, 600_000),
};
