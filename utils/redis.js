const { createClient } = require('redis');

const client = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'  // IPv4
});

client.on('error', (err) => {
  console.error('Redis error:', err);
});

async function ensureConnected() {
  if (!client.isOpen) {
    await client.connect();
    console.log('Redis connected');
  }
}

module.exports = { redis: client, ensureRedis: ensureConnected };
