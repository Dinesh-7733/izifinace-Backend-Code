// config/config.js
// config/config.js
require('dotenv').config();

const WITHDRAWAL_THRESHOLD = 1000;  // e.g., $1000 threshold for withdrawal notification



// allow dummy defaults only in dev/test
const isProd = process.env.NODE_ENV === 'production';
const API_USERNAME = process.env.API_USERNAME || (isProd ? '' : 'dev-user');
const API_KEY     = process.env.API_KEY     || (isProd ? '' : 'dev-key');

// fail only in production
if (isProd && (!API_USERNAME || !API_KEY)) {
  throw new Error('Missing env: API_USERNAME / API_KEY');
}



module.exports = {


   // JWT
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_TTL: process.env.JWT_ACCESS_TTL || '30d',
  JWT_REFRESH_TTL: process.env.JWT_REFRESH_TTL || '50d',

  JWT_SECRET: process.env.JWT_SECRET,
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
  WALLET_LIMITS: {
    dailyTransferLimit: 999999, // e.g., $999999 daily transfer limit
    perTransactionLimit: 150000, // e.g., $150000 per transaction limit
    maxWalletBalance: 999999, 
    withdrawalThreshold: WITHDRAWAL_THRESHOLD,  // include it here as a property
  },
};

