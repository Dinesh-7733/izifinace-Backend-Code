const axios = require("axios");

const getAccessToken = async () => {
  try {
    // Get from global config (set in onInit)
    const CONSUMER_KEY = global.config.mpesaConsumerKey;
    const CONSUMER_SECRET = global.config.mpesaConsumerSecret;
    const MPESA_ENV = global.config.mpesaEnv;

    console.log("🔍 Checking M-Pesa config:", {
      hasKey: !!CONSUMER_KEY,
      hasSecret: !!CONSUMER_SECRET,
      env: MPESA_ENV,
      keyLength: CONSUMER_KEY?.length,
      secretLength: CONSUMER_SECRET?.length
    });

    if (!CONSUMER_KEY || !CONSUMER_SECRET) {
      throw new Error("❌ Missing M-Pesa credentials. Ensure secrets are loaded.");
    }

    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");

    const url = MPESA_ENV === "live"
      ? "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
      : "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

    console.log(`🔐 Requesting M-Pesa ${MPESA_ENV} Access Token from: ${url}`);

    const response = await axios.get(url, {
      headers: { 
        Authorization: `Basic ${auth}` 
      },
      timeout: 30000,
    });

    if (!response.data.access_token) {
      throw new Error("No access token in response");
    }

    console.log("✅ Access Token Generated Successfully");
    return response.data.access_token;

  } catch (error) {
    console.error("❌ FAILED TO GENERATE M-PESA TOKEN:");
    console.error("Status:", error.response?.status);
    console.error("Data:", error.response?.data);
    console.error("Message:", error.message);
    throw error;
  }
};

module.exports = { getAccessToken };