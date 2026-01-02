// functions/services/mpesaAuth.service.js
const axios = require("axios");

exports.getMpesaToken = async () => {
  const mode = (global.config.mpesaEnv || "sandbox").trim().toLowerCase();

  const baseURL =
    mode === "live"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

  // Trim key/secret before encoding
  const consumerKey = (global.config.mpesaConsumerKey || "").trim();
  const consumerSecret = (global.config.mpesaConsumerSecret || "").trim();

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const { data } = await axios.get(
    `${baseURL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 10000,
    }
  );

  return data.access_token;
};
