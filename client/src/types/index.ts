export interface Game {
  id: string;
  title: string;
  genre: string;
  vramGb: number;
  coverUrl: string | null;
  steamAppId: string;
  description: string;
}

export interface HealthStatus {
  status: string;
  region: string;
  regionLabel: string;
  gpu: string;
  activeSessions: number;
  maxSlots: number;
  availableSlots: number;
  mockDocker: boolean;
  storeBackend: 'redis' | 'memory';
  uptimeSeconds: number;
  vmStatus?: string;
  vmControlEnabled?: boolean;
  pinProtected?: boolean;
}

export interface CloudSession {
  sessionId: string;
  userId: string;
  gameId: string;
  gameTitle: string;
  containerId: string;
  containerName: string;
  port: number;
  containerPort?: number;
  webrtcUdpRange: string;
  streamUrl: string;
  encoder: string;
  savePath: string;
  gamesPath: string;
  autoLaunchSteamAppId?: string | null;
  mock: boolean;
  createdAt: number;
  lastHeartbeat: number;
}

export interface StartSessionResponse {
  reused: boolean;
  session: CloudSession;
}
