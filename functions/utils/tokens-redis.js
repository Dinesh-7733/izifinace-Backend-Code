const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { redis, isRedisEnabled } = require("./redis");
const { defineSecret } = require("firebase-functions/params");

// --- Secure Firebase Secrets ---
const JWT_ACCESS_SECRET = defineSecret("JWT_ACCESS_SECRET");
const JWT_REFRESH_SECRET = defineSecret("JWT_REFRESH_SECRET");
const JWT_ACCESS_TTL = defineSecret("JWT_ACCESS_TTL");
const JWT_REFRESH_TTL = defineSecret("JWT_REFRESH_TTL");

// --- Ensure Redis is configured ---
function assertRedisConfigured() {
  if (!isRedisEnabled || !redis) {
    const err = new Error("Redis is not configured");
    err.code = "REDIS_DISABLED";
    throw err;
  }
}

// --- Sign short-lived Access Token ---
function signAccess(payload) {
  return jwt.sign(payload, JWT_ACCESS_SECRET.value(), {
    expiresIn: JWT_ACCESS_TTL.value()?.trim() || "30d",
  });
}

// --- Sign Refresh Token (contains jti + type) ---
function signRefresh({ sub, jti }) {
  return jwt.sign(
    { sub, jti, type: "refresh" },
    JWT_REFRESH_SECRET.value(),
    {
      expiresIn: JWT_REFRESH_TTL.value()?.trim() || "50d",
    }
  );
}

// --- Create a session (store in Redis) and return refresh token ---
async function issueSession(userId, ctx = {}) {
  const jti = crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");

  const refreshToken = signRefresh({ sub: userId, jti });

  // Compute TTL from JWT exp so Redis expires the key correctly
  const decoded = jwt.decode(refreshToken);
  const ttlSec = Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));

  const key = `rt:${jti}`;
  assertRedisConfigured();

  // ✅ FIXED: Upstash Redis uses lowercase hset()
  await redis.hset(key, {
    userId: String(userId),
    ua: String(ctx.ua || ""),
    ip: String(ctx.ip || ""),
    createdAt: String(Date.now()),
  });

  // ✅ expire() works fine with Upstash
  await redis.expire(key, ttlSec);

  return { refreshToken, jti };
}

// --- Rotate a refresh token (single-use) ---
async function rotateRefresh(oldRefreshToken, ctx = {}) {
  let decoded;
  try {
    decoded = jwt.verify(oldRefreshToken, JWT_REFRESH_SECRET.value());
  } catch (e) {
    const err = new Error("invalid");
    err.code = "JWT_VERIFY";
    throw err;
  }

  if (decoded.type !== "refresh" || !decoded.jti || !decoded.sub) {
    const err = new Error("invalid");
    err.code = "BAD_PAYLOAD";
    throw err;
  }

  const key = `rt:${decoded.jti}`;
  assertRedisConfigured();

  const exists = await redis.exists(key);
  if (!exists) {
    const err = new Error("invalid");
    err.code = "NOT_FOUND";
    throw err;
  }

  // Revoke old token (single-use)
  await redis.del(key);

  // Mint new refresh token
  const { refreshToken, jti } = await issueSession(decoded.sub, ctx);
  return { userId: decoded.sub, refreshToken };
}

// --- Optional: Revoke a given refresh token (logout) ---
async function revokeRefresh(refreshToken) {
  try {
    const { jti } = jwt.verify(refreshToken, JWT_REFRESH_SECRET.value());
    if (!jti) return false;
    assertRedisConfigured();
    await redis.del(`rt:${jti}`);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  signAccess,
  issueSession,
  rotateRefresh,
  revokeRefresh,
};
