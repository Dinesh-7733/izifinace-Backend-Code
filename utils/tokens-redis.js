const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { redis } = require('./redis');

// sign short-lived access token
function signAccess(payload) {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_TTL || '30m',
  });
}

// sign refresh token (contains jti + type)
function signRefresh({ sub, jti }) {
  return jwt.sign({ sub, jti, type: 'refresh' }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_TTL || '50d',
  });
}

// create a session (store in Redis) and return refresh token
async function issueSession(userId, ctx = {}) {
  const jti = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const refreshToken = signRefresh({ sub: userId, jti });

  // compute TTL from JWT exp so Redis expires the key at the same time
  const decoded = jwt.decode(refreshToken);
  const ttlSec = Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));

  const key = `rt:${jti}`;
await redis.hSet(key, {
  userId: String(userId),
  ua: String(ctx.ua || ''),
  ip: String(ctx.ip || ''),
  createdAt: String(Date.now()),
});

  await redis.expire(key, ttlSec);

  return { refreshToken, jti };
}

// rotate a refresh token (single use)
async function rotateRefresh(oldRefreshToken, ctx = {}) {
  let decoded;
  try {
    decoded = jwt.verify(oldRefreshToken, process.env.JWT_REFRESH_SECRET);
  } catch (e) {
    const err = new Error('invalid');
    err.code = 'JWT_VERIFY';
    throw err;
  }

  if (decoded.type !== 'refresh' || !decoded.jti || !decoded.sub) {
    const err = new Error('invalid');
    err.code = 'BAD_PAYLOAD';
    throw err;
  }

  const key = `rt:${decoded.jti}`;
  const exists = await redis.exists(key);
  if (!exists) {
    // missing => expired, revoked, or already used
    const err = new Error('invalid');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // revoke old (single-use)
  await redis.del(key);

  // mint new
  const { refreshToken, jti } = await issueSession(decoded.sub, ctx);

  return { userId: decoded.sub, refreshToken };
}

// optional: revoke a given refresh token (logout)
async function revokeRefresh(refreshToken) {
  try {
    const { jti } = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    if (!jti) return false;
    await redis.del(`rt:${jti}`);
    return true;
  } catch {
    return false;
  }
}

module.exports = { signAccess, issueSession, rotateRefresh, revokeRefresh };
