import type { CloudSession, Game, HealthStatus, StartSessionResponse } from '../types';

const configuredApiBase = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const API_BASE =
  configuredApiBase &&
  !(
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    configuredApiBase.includes('localhost')
  )
    ? configuredApiBase
    : '';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      data.message || `Request failed with status ${res.status}`,
      res.status,
      data.error || 'REQUEST_FAILED'
    );
  }
  return data as T;
}

export async function fetchHealth(): Promise<{ health: HealthStatus; latencyMs: number }> {
  const start = performance.now();
  const health = await request<HealthStatus>('/api/health');
  const latencyMs = Math.max(1, Math.round(performance.now() - start));
  return { health, latencyMs };
}

export async function fetchGames(): Promise<Game[]> {
  const data = await request<{ games: Game[] }>('/api/games');
  return data.games;
}

export async function fetchUserSession(userId: string): Promise<CloudSession | null> {
  if (!userId.trim()) return null;
  const data = await request<{ session: CloudSession | null }>(
    `/api/sessions/${encodeURIComponent(userId.trim())}`
  );
  return data.session;
}

export async function startSession(
  userId: string,
  gameId?: string | null
): Promise<StartSessionResponse> {
  return request<StartSessionResponse>('/api/sessions/start', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      gameId: gameId ?? 'desktop',
    }),
  });
}

export async function stopSession(
  userId: string,
  options?: { stopVm?: boolean }
): Promise<{
  stopped: boolean;
  releasedPort?: number;
  activeSessions?: number;
  vmStopped?: boolean;
}> {
  return request('/api/sessions/stop', {
    method: 'POST',
    body: JSON.stringify({ userId, stopVm: options?.stopVm }),
  });
}

export async function sendHeartbeat(userId: string): Promise<{ ok: boolean; lastHeartbeat: number }> {
  return request('/api/sessions/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export async function wakeVm(): Promise<{
  ok: boolean;
  vmStatus: string;
  externalIp?: string | null;
  backendReady?: boolean;
}> {
  return request('/api/vm/start', {
    method: 'POST',
    body: JSON.stringify({ wait: true }),
  });
}

export async function stopVm(): Promise<{
  ok: boolean;
  vmStatus: string;
}> {
  return request('/api/vm/stop', {
    method: 'POST',
  });
}
