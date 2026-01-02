// redis.js
require('dotenv').config();
const { Redis } = require('@upstash/redis');
const { createClient } = require('redis');

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
const redisUrl = process.env.REDIS_URL?.trim();

let redis = null;
let isRedisEnabled = false;

try {
  if (upstashUrl && upstashToken) {
    // ✅ Use Upstash REST API (best for serverless)
    redis = new Redis({
      url: upstashUrl,
      token: upstashToken,
    });
    isRedisEnabled = true;
    console.log('✅ Connected to Upstash Redis');
  } else if (redisUrl) {
    // 🔄 Use local Redis if available
    redis = createClient({ url: redisUrl });
    redis.on('error', (err) => console.error('Redis error:', err));
    isRedisEnabled = true;
    console.log('✅ Connected to local Redis');
  } else {
    console.warn('⚠️ No Redis configuration found');
  }
} catch (err) {
  console.warn('⚠️ Redis initialization failed:', err.message);
}

// Only call connect for local Redis (Upstash REST doesn't need it)
async function ensureRedis() {
  if (!redis) return;
  if (redis.connect && !redis.isOpen) {
    try {
      await redis.connect();
      console.log('Redis connected');
    } catch (err) {
      console.warn('⚠️ Redis connection failed:', err.message);
    }
  }
}

module.exports = { redis, ensureRedis, isRedisEnabled };
