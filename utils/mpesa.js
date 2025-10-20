// utils/mpesa.js
const axios = require("axios");
require("dotenv").config();

const baseURL =
  process.env.MPESA_ENV === "sandbox"
    ? "https://sandbox.safaricom.co.ke"
    : "https://api.safaricom.co.ke";

// 🔹 Get OAuth Access Token
async function getAccessToken() {
  try {
    const auth = Buffer.from(
      `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString("base64");

    const { data } = await axios.get(
      `${baseURL}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` } }
    );

    return data.access_token;
  } catch (error) {
    console.error("❌ Failed to get access token:", error.response?.data || error.message);
    throw new Error("Unable to authenticate with M-Pesa API");
  }
}

// 🔹 Helpers
function timestamp14() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function stkPassword(shortcode, passkey, ts) {
  return Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");
}

// 🔹 STK Push (Customer to Business - Deposits)
async function initiateSTKPush(phoneNumber, amount) {
  try {
    amount = Number(amount);

    // Validation
    if (!Number.isFinite(amount) || amount < 1) throw new Error("Amount must be >= 1");
    if (process.env.MPESA_ENV === "sandbox" && phoneNumber !== "254708374149")
      throw new Error("Sandbox MSISDN must be 254708374149");
    if (process.env.MPESA_ENV !== "sandbox" && !/^2547\d{8}$/.test(phoneNumber))
      throw new Error("Phone must be 2547XXXXXXXX");

    const accessToken = await getAccessToken();
    const ts = timestamp14();
    const password = stkPassword(process.env.MPESA_SHORTCODE, process.env.MPESA_PASSKEY, ts);

    const { data } = await axios.post(
      `${baseURL}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: ts,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phoneNumber,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: phoneNumber,
        CallBackURL: process.env.MPESA_STK_CALLBACK_URL || "https://your-ngrok-url.ngrok-free.app/mpesa/callback",
        AccountReference: process.env.MPESA_ENV === "sandbox" ? "TEST-STK" : "IziBank",
        TransactionDesc: process.env.MPESA_ENV === "sandbox" ? "TEST MODE — NO REAL DEBIT" : "Deposit to Wallet",
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return data;
  } catch (error) {
    console.error("❌ STK Push failed:", error.response?.data || error.message);
    throw new Error("STK Push initiation failed");
  }
}

// 🔹 STK Query (Check transaction status)
async function querySTK(checkoutRequestID) {
  try {
    const accessToken = await getAccessToken();
    const ts = timestamp14();
    const password = stkPassword(process.env.MPESA_SHORTCODE, process.env.MPESA_PASSKEY, ts);

    const { data } = await axios.post(
      `${baseURL}/mpesa/stkpushquery/v1/query`,
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
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

// 🔹 B2C Payment (Business to Customer - Loan disbursement / withdrawals)
async function initiateB2C(phoneNumber, amount) {
  try {
    console.log("B2C Initiation Started");
    console.log("PhoneNumber (PartyB):", phoneNumber);
    console.log("Amount:", amount);
    
    const accessToken = await getAccessToken();
    console.log("Access token obtained:", accessToken);

    const { data } = await axios.post(
      `${baseURL}/mpesa/b2c/v1/paymentrequest`,
      {
        InitiatorName: process.env.MPESA_B2C_INITIATOR,
        SecurityCredential: process.env.MPESA_B2C_SECURITY_CREDENTIAL,
        CommandID: "BusinessPayment",
        Amount: amount,
        PartyA: process.env.MPESA_B2C_SHORTCODE,
        PartyB: phoneNumber,
        Remarks: "Loan Disbursement",
        QueueTimeOutURL: process.env.MPESA_B2C_TIMEOUT_URL,
        ResultURL: process.env.MPESA_B2C_RESULT_URL,
        Occasion: "Loan Payment",
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    console.log("B2C Response:", data);
    return data;
  } catch (error) {
    console.error("❌ B2C Payment failed:", error.response?.data || error.message);
    throw new Error("B2C initiation failed");
  }
}


// 🔹 Transaction Reversal
async function reverseTransaction(transactionId, amount, sender) {
  try {
    const token = await getAccessToken();
    await axios.post(process.env.REVERSAL_URL, {
      Initiator: process.env.INITIATOR_NAME,
      SecurityCredential: process.env.SECURITY_CREDENTIAL,
      CommandID: "TransactionReversal",
      TransactionID: transactionId,
      Amount: amount,
      ReceiverParty: sender,
      RecieverIdentifierType: "1", // 1 = MSISDN
      ResultURL: `${process.env.DOMAIN}/api/transactions/reversal/result`,
      QueueTimeOutURL: `${process.env.DOMAIN}/api/transactions/reversal/timeout`,
      Remarks: "Invalid account reference",
      Occasion: "Refund",
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log(`Reversal started for ${transactionId}`);
  } catch (err) {
    console.error("Reversal error:", err.response?.data || err.message);
  }
}



module.exports = { initiateSTKPush, querySTK, initiateB2C ,reverseTransaction };
