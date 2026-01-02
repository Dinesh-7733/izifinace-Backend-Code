// utils/mpesa.js
const axios = require("axios");

// Lazy loader – ensures global.config exists
function getConfig() {
  if (!global.config) {
    throw new Error(
      "❌ global.config not initialized. Make sure initializeApp() runs first."
    );
  }
  return global.config;
}

// Base URL (dynamic)
function getBaseURL() {
  const config = getConfig();
  const env = config.mpesaEnv.trim().toLowerCase();
  return env === "sandbox"
    ? "https://sandbox.safaricom.co.ke"
    : "https://api.safaricom.co.ke";
}

// 🔹 Get Access Token
async function getAccessToken() {
  const config = getConfig();
  const env = config.mpesaEnv.trim().toLowerCase();

  console.log("M-Pesa Access Token Request with:", {
    env,
    key: config.mpesaConsumerKey ? "✅" : "❌ missing",
    secret: config.mpesaConsumerSecret ? "✅" : "❌ missing",
  });

  try {
    const consumerKey = config.mpesaConsumerKey.trim();
    const consumerSecret = config.mpesaConsumerSecret.trim();
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
      "base64"
    );

    const url = `${getBaseURL()}/oauth/v1/generate?grant_type=client_credentials`;

    const { data } = await axios.get(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    return data.access_token;
  } catch (error) {
    console.error(
      "❌ Failed to get access token:",
      error.response?.data || error.message
    );
    throw new Error("Unable to authenticate with M-Pesa API");
  }
}

// Helpers
function timestamp14() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function stkPassword(shortcode, passkey, ts) {
  return Buffer.from(`${shortcode.trim()}${passkey.trim()}${ts}`).toString(
    "base64"
  );
}

// 🔹 STK Push
async function initiateSTKPush(phoneNumber, amount, accountRef) {
  const config = getConfig();
  const env = config.mpesaEnv.trim().toLowerCase();

  try {
    phoneNumber = phoneNumber.replace(/^\+/, "").replace(/\s+/g, "");

    amount = Number(amount);
    if (!Number.isFinite(amount) || amount < 1)
      throw new Error("Amount must be >= 1");

    if (env === "sandbox" && phoneNumber !== "254708374149") {
      throw new Error("Sandbox MSISDN must be 254708374149");
    }

    const accessToken = await getAccessToken();
    const ts = timestamp14();
    const password = stkPassword(config.mpesaShortcode, config.mpesaPasskey, ts);


    // 🚀 Log before sending
    console.log("📌 STK Push Request Config:", {
      env,
      BusinessShortCode: config.mpesaShortcode.trim(),
      Passkey: config.mpesaPasskey ? "Loaded ✔" : "Missing ❌",
      CallbackURL: config.mpesaStkCallback.trim(),
      AccountReference: accountRef,
      PhoneNumber: phoneNumber,
      Amount: amount
    });
    
    const { data } = await axios.post(
      `${getBaseURL()}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: config.mpesaShortcode.trim(),
        Password: password,
        Timestamp: ts,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phoneNumber,
        PartyB: config.mpesaShortcode.trim(),
        PhoneNumber: phoneNumber,
        CallBackURL: config.mpesaStkCallback.trim(),

        // ⭐ USE DYNAMIC CUSTOMER ACCOUNT REFERENCE
        AccountReference:
          env === "sandbox"
            ? accountRef || "TEST-STK"
            : accountRef || "CustomerPayment",

        TransactionDesc:
          env === "sandbox"
            ? "TEST MODE — NO REAL DEBIT"
            : "Deposit to Wallet",
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return data;
  } catch (error) {
    console.error("❌ STK Push failed:", error.response?.data || error.message);
    throw new Error("STK Push failed");
  }
}


// 🔹 STK Query
async function querySTK(checkoutRequestID) {
  const config = getConfig();
  const ts = timestamp14();
  const password = stkPassword(config.mpesaShortcode, config.mpesaPasskey, ts);

  try {
    const accessToken = await getAccessToken();
    const { data } = await axios.post(
      `${getBaseURL()}/mpesa/stkpushquery/v1/query`,
      {
        BusinessShortCode: config.mpesaShortcode.trim(),
        Password: password,
        Timestamp: ts,
        CheckoutRequestID: checkoutRequestID,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return data;
  } catch (error) {
    console.error("❌ STK Query failed:", error.response?.data || error.message);
    throw new Error("STK Query failed");
  }
}

// 🔹 Phone formatting helper
function formatPhoneNumber(phoneNumber) {
  phoneNumber = phoneNumber.trim();
  if (phoneNumber.startsWith("+")) phoneNumber = phoneNumber.substring(1);
  if (phoneNumber.startsWith("07")) return "254" + phoneNumber.substring(1);
  if (phoneNumber.startsWith("7")) return "254" + phoneNumber;
  return phoneNumber;
}

// 🔹 B2C Payment
async function initiateB2C(phoneNumber, amount) {
  const config = getConfig();
  const sanitizedPhone = formatPhoneNumber(phoneNumber);
  const accessToken = await getAccessToken();

  try {
    const { data } = await axios.post(
      `${getBaseURL()}/mpesa/b2c/v1/paymentrequest`,
      {
        InitiatorName: config.mpesaB2cInitiator.trim(),
        SecurityCredential: config.mpesaB2cCredential.trim(),
        CommandID: "BusinessPayment",
        Amount: amount,
        PartyA: config.mpesaB2cShortcode.trim(),
        PartyB: sanitizedPhone,
        Remarks: "Loan Disbursement",
        QueueTimeOutURL: config.mpesaB2cTimeoutUrl.trim(),
        ResultURL: config.mpesaB2cResultUrl.trim(),
        Occasion: "Loan Payment",
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return data;
  } catch (error) {
    console.error("❌ B2C Payment failed:", error.response?.data || error.message);
    throw new Error("B2C initiation failed");
  }
}

// 🔹 Transaction Reversal
async function reverseTransaction(transactionId, amount, sender) {
  const config = getConfig();

  try {
    const token = await getAccessToken();

    await axios.post(
      config.mpesaReversalUrl.trim(),
      {
        Initiator: config.mpesaB2cInitiator.trim(),
        SecurityCredential: config.mpesaB2cCredential.trim(),
        CommandID: "TransactionReversal",
        TransactionID: transactionId,
        Amount: amount,
        ReceiverParty: sender,
        ReceiverIdentifierType: "1",
        ResultURL: config.mpesaReversalResult.trim(),
        QueueTimeOutURL: config.mpesaReversalTimeout.trim(),
        Remarks: "Invalid account reference",
        Occasion: "Refund",
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    console.log(`Reversal started for ${transactionId}`);
  } catch (err) {
    console.error("Reversal error:", err.response?.data || err.message);
  }
}

module.exports = {
  initiateSTKPush,
  querySTK,
  initiateB2C,
  reverseTransaction,
};
