import Redis from 'ioredis';

// ── REDIS ─────────────────────────────────────────────────────────────────────
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy: (times) => {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
  reconnectOnError: () => true,
  enableReadyCheck: false,
  enableOfflineQueue: false
});

redis.on('error', (err) => {
  // Silently handle Redis errors - it's optional
  if (err.message && !err.message.includes('ECONNREFUSED')) {
    console.warn('Redis warning:', err.message);
  }
});

redis.on('connect', () => console.log('✅ Redis connected'));

// Try to connect but don't fail if unavailable
redis.connect().catch(() => {
  console.warn('⚠️ Redis not available - running without cache');
});

