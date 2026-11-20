import Redis from 'ioredis';
import { config } from '../config/env.js';

const SESSION_KEY_PREFIX = 'cloudgaming:session:';

class SessionStore {
  constructor() {
    this.memoryStore = new Map();
    this.redis = null;
    this.useRedis = false;
  }

  async init() {
    if (!config.redisUrl) {
      console.log('[SessionStore] REDIS_URL not set — using in-memory Map fallback.');
      return;
    }

    const client = new Redis(config.redisUrl, {
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });

    client.on('error', (err) => {
      if (this.useRedis) {
        console.warn(`[SessionStore] Redis runtime error (${err.message}) — falling back to in-memory Map.`);
        this.useRedis = false;
      }
    });

    try {
      await client.connect();
      await client.ping();
      this.redis = client;
      this.useRedis = true;
      console.log(`[SessionStore] Connected to Redis (${config.redisUrl}).`);
    } catch (err) {
      console.warn(
        `[SessionStore] Redis unavailable (${err.message}) — automatically using in-memory Map fallback.`
      );
      try {
        client.disconnect();
      } catch {
        // Ignore cleanup errors on failed probe
      }
      this.redis = null;
      this.useRedis = false;
    }
  }

  getBackendName() {
    return this.useRedis ? 'redis' : 'memory';
  }

  async getSession(userId) {
    if (this.useRedis && this.redis) {
      try {
        const raw = await this.redis.get(`${SESSION_KEY_PREFIX}${userId}`);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.warn(`[SessionStore] Redis get failed (${err.message}) — falling back to memory.`);
        this.useRedis = false;
      }
    }
    return this.memoryStore.get(userId) || null;
  }

  async getSessionById(sessionId) {
    const sessions = await this.listSessions();
    return sessions.find((s) => s.sessionId === sessionId) || null;
  }

  async setSession(userId, session) {
    this.memoryStore.set(userId, session);
    if (this.useRedis && this.redis) {
      try {
        await this.redis.set(`${SESSION_KEY_PREFIX}${userId}`, JSON.stringify(session));
      } catch (err) {
        console.warn(`[SessionStore] Redis set failed (${err.message}) — falling back to memory.`);
        this.useRedis = false;
      }
    }
  }

  async deleteSession(userId) {
    this.memoryStore.delete(userId);
    if (this.useRedis && this.redis) {
      try {
        await this.redis.del(`${SESSION_KEY_PREFIX}${userId}`);
      } catch (err) {
        console.warn(`[SessionStore] Redis del failed (${err.message}) — falling back to memory.`);
        this.useRedis = false;
      }
    }
  }

  async listSessions() {
    if (this.useRedis && this.redis) {
      try {
        const keys = await this.redis.keys(`${SESSION_KEY_PREFIX}*`);
        if (keys.length === 0) return [];
        const values = await this.redis.mget(keys);
        return values.filter(Boolean).map((v) => JSON.parse(v));
      } catch (err) {
        console.warn(`[SessionStore] Redis list failed (${err.message}) — falling back to memory.`);
        this.useRedis = false;
      }
    }
    return Array.from(this.memoryStore.values());
  }

  async countSessions() {
    const sessions = await this.listSessions();
    return sessions.length;
  }

  async close() {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
    }
  }
}

export const sessionStore = new SessionStore();
