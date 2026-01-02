// functions/smsProxy.js
const { onCall } = require("firebase-functions/v2/https");
const { defineString, defineSecret } = require("firebase-functions/params");
const axios = require("axios");

// Define parameters
const atUsername = defineSecret("AT_USERNAME");
const atApiKey = defineSecret("AT_API_KEY");
const atSenderId = defineSecret("AT_SENDER_ID");

// SMS Proxy function - Deploy in europe-west1 (closer to Africa)
exports.sendSMSProxy = onCall(
  {
    region: "europe-west1", // Closer to Kenya
    timeoutSeconds: 30,
    secrets: [atUsername, atApiKey, atSenderId],
  },
  async (request) => {
    const { phone, message } = request.data;
    
    if (!phone || !message) {
      throw new Error("Phone and message required");
    }

    try {
      const cleanPhone = phone.replace(/^\+/, "");
      const username = atUsername.value();
      const apiKey = atApiKey.value();
      const senderId = atSenderId.value();

      const isSandbox = username.toLowerCase().includes("sandbox");
      const baseUrl = isSandbox 
        ? "https://api.sandbox.africastalking.com"
        : "https://api.africastalking.com";

      const url = `${baseUrl}/version1/messaging`;

      const body = new URLSearchParams({
        username: username,
        to: cleanPhone,
        message: message,
        from: senderId || "AFRICASTKNG",
      });

      console.log(`📤 Proxy sending SMS from Europe to ${phone}`);

      const response = await axios.post(url, body.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          apiKey: apiKey,
        },
        timeout: 25000, // 25 seconds
      });

      const result = response.data?.SMSMessageData?.Recipients?.[0];

      return {
        success: result?.status === "Success" || result?.statusCode === "101",
        messageId: result?.messageId,
        status: result?.status,
        rawResponse: response.data,
      };
    } catch (error) {
      console.error("Proxy SMS error:", error.message);
      throw new Error(`SMS sending failed: ${error.message}`);
    }
  }
);