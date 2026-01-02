// utils/africatalking.js - SIMPLIFIED VERSION
const OTP = require("../models/OTP");
const axios = require("axios");

function africasTalkingService({ atUsername, atApiKey, atSenderId }) {
  const AT_USERNAME = (atUsername || "").trim();
  const AT_API_KEY = (atApiKey || "").trim();
  const AT_SENDER_ID = atSenderId?.trim() || "AFRICASTKNG";

  console.log(`🔧 Africa's Talking Config:`, {
    username: AT_USERNAME,
    apiKeyLength: AT_API_KEY.length,
    senderId: AT_SENDER_ID
  });

  const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

  async function sendVerificationCode(phone) {
    try {
      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      // Always save OTP first
      await OTP.findOneAndUpdate(
        { phone },
        { otp, expiresAt },
        { upsert: true, new: true }
      );

      console.log(`📌 OTP generated for ${phone}: ${otp}`);

      // If no credentials, just return OTP saved
      if (!AT_USERNAME || !AT_API_KEY) {
        console.log("⚠️ Africa's Talking credentials missing");
        return {
          success: true,
          phone,
          delivered: false,
          message: "OTP saved but SMS credentials not configured",
          otp: process.env.NODE_ENV === "development" ? otp : undefined,
        };
      }

      // Try direct connection with better timeout handling
      const cleanPhone = phone.replace(/^\+/, "");
      const isSandbox = AT_USERNAME.toLowerCase().includes("sandbox");
      const baseUrl = isSandbox
        ? "https://api.sandbox.africastalking.com"
        : "https://api.africastalking.com";

      const url = `${baseUrl}/version1/messaging`;
      
      console.log(`📤 Attempting to send SMS to ${phone} via ${isSandbox ? 'SANDBOX' : 'LIVE'}`);

      const body = new URLSearchParams({
        username: AT_USERNAME,
        to: cleanPhone,
        message: `Your Izifinance verification code is: ${otp}. Valid for 5 minutes.`,
        from: AT_SENDER_ID,
      });

      // Use a simpler approach with axios
      const response = await axios.post(url, body.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "apiKey": AT_API_KEY,
        },
        timeout: 10000, // 10 seconds
      });

      const result = response.data?.SMSMessageData?.Recipients?.[0];

      if (result?.status === "Success" || result?.statusCode === "101") {
        console.log(`✅ SMS sent successfully: ${result.messageId}`);
        return {
          success: true,
          phone,
          delivered: true,
          trackingId: result.messageId,
          status: result.status,
          cost: result.cost,
        };
      }

      // SMS failed but OTP was saved
      console.log(`⚠️ SMS sending failed: ${result?.status || 'Unknown error'}`);
      return {
        success: true, // OTP was saved successfully
        phone,
        delivered: false,
        error: result?.status || "SMS_SENDING_FAILED",
        providerResponse: result,
        otp: process.env.NODE_ENV === "development" ? otp : undefined,
      };

    } catch (error) {
      console.error("❌ SMS sending error:", error.message);
      
      // Even if SMS fails, OTP is saved
      return {
        success: true, // OTP was saved successfully
        phone,
        delivered: false,
        message: "OTP saved but SMS delivery failed",
        error: error.code || error.message,
        otp: process.env.NODE_ENV === "development" ? otp : undefined,
      };
    }
  }






 


  // -------------------------------
  // Verify OTP
  // -------------------------------
  async function verifyOTP(phone, otp) {
    try {
      if (!phone || !otp)
        return { success: false, message: "Phone and OTP are required" };

      const record = await OTP.findOne({ phone });
      if (!record) return { success: false, message: "OTP not found" };

      if (record.expiresAt < new Date())
        return { success: false, message: "OTP expired" };

      if (record.otp !== otp)
        return { success: false, message: "Invalid OTP" };

      await OTP.deleteOne({ phone });

      return { success: true, message: "OTP verified successfully" };
    } catch (err) {
      console.error("Error verifying OTP:", err);
      return { success: false, message: "Failed to verify OTP" };
    }
  }

  return {
    sendVerificationCode,
    verifyOTP,
  };
}

module.exports = africasTalkingService;
