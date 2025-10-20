const OTP = require("../models/OTP");
const axios = require("axios");

const AT_API_KEY = process.env.AT_API_KEY;
const AT_USERNAME = process.env.AT_USERNAME || "sandbox";
const AT_SENDER_ID = process.env.AT_SENDER_ID || "";

const AT_BASE =
  AT_USERNAME === "sandbox"
    ? "https://api.sandbox.africastalking.com"
    : "https://api.africastalking.com";

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

exports.sendVerificationCode = async (phone) => {
  try {


    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await OTP.findOneAndUpdate(
      { phone },
      { otp, expiresAt },
      { upsert: true, new: true }
    );

    console.log(`Generated OTP for ${phone}: ${otp}`);

    // Sandbox → return OTP directly (no SMS sent)
    if (AT_USERNAME === "sandbox") {
      return { success: true, sandbox: true, phone, otp };
    }

    // Live → send SMS
    const url = `${AT_BASE}/version1/messaging`;
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      apiKey: AT_API_KEY,
    };

    const body = new URLSearchParams({
      username: AT_USERNAME,
      to: phone,
      message: `Your IziBank verification code is: ${otp}`,
    });

    if (AT_SENDER_ID) {
      body.set("from", AT_SENDER_ID);
    }

    const response = await axios.post(url, body.toString(), { headers });
    console.log("OTP Sent:", JSON.stringify(response.data, null, 2));

    const sentStatus =
      response.data?.SMSMessageData?.Recipients?.[0]?.status === "Success";

    return {
      success: sentStatus,
      phone,
      response: response.data,
    };
  } catch (err) {
    console.error("Error sending OTP:", err.response?.data || err.message);
    return { success: false, message: "Failed to send OTP" };
  }
};

exports.verifyOTP = async (phone, otp) => {
  try {
    if (!phone || !otp) {
      return { success: false, message: "Phone and OTP are required" };
    }

    const record = await OTP.findOne({ phone });
    if (!record) return { success: false, message: "OTP not found" };

    if (record.expiresAt < new Date()) {
      return { success: false, message: "OTP expired" };
    }

    if (record.otp !== otp) {
      return { success: false, message: "Invalid OTP" };
    }

    // OTP verified → delete it
    await OTP.deleteOne({ phone });

    return { success: true, message: "OTP verified successfully" };

  } catch (err) {
    console.error("Error verifying OTP:", err.message);
    return { success: false, message: "Failed to verify OTP" };
  }
};
