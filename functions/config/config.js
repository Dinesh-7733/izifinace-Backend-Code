// config/config.js
function getConfig() {
  const {
    AT_USERNAME,
    API_KEY,
    JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET,
    JWT_ACCESS_TTL,
    JWT_REFRESH_TTL,
    FB_PRIVATE_KEY,
    CLIENT_EMAIL,
    PROJECT_ID,
    STORAGE_BUCKET,
  } = process.env;



  if (!FB_PRIVATE_KEY || !CLIENT_EMAIL || !PROJECT_ID || !STORAGE_BUCKET) {
    console.warn("Firebase Storage env vars are missing!");
  }

  return {
    AT_USERNAME,
    API_KEY,
    JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET,
    JWT_ACCESS_TTL,
    JWT_REFRESH_TTL,
    FB_PRIVATE_KEY,
    CLIENT_EMAIL,
    PROJECT_ID,
    STORAGE_BUCKET,
    WALLET_LIMITS: {
      dailyTransferLimit: 999999,
      perTransactionLimit: 150000,
      maxWalletBalance: 999999,
      withdrawalThreshold: 1000,
    },
  };
}

module.exports = { getConfig };
