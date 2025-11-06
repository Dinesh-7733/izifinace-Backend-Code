// controllers/borrowerAuthController.js

const Customer = require("../models/customer");
const { sendVerificationCode, verifyOTP } = require("../utils/africatalking");

const { normalizeToE164 } = require("../utils/phone");
const { signAccess, issueSession, rotateRefresh,revokeRefresh } = require('../utils/tokens-redis');

exports.loginRequest = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: "Phone is required" });

    // Normalize number for Kenya
    const normalizedPhone = normalizeToE164(phone, "KE");
    if (!normalizedPhone) return res.status(400).json({ success: false, message: "Invalid phone number" });

    // Check if customer exists
    const customer = await Customer.findOne({ phone: normalizedPhone });
    if (!customer) return res.status(404).json({ success: false, message: "Borrower not registered" });

    // Send OTP
    const result = await sendVerificationCode(normalizedPhone);
    if (!result.success) return res.status(500).json({ success: false, message: "Failed to send OTP" });

   // ✅ Send OTP in response if sandbox
    if (result.sandbox) {
      return res.json({
        success: true,
        message: "OTP sent successfully (sandbox mode)",
        sandbox: true,
        otp: result.otp,   // 🔥 OTP included
      });
    }

    // ✅ Otherwise, just confirm OTP sent
    res.json({ success: true, message: "OTP sent successfully" });

  } catch (err) {
    console.error("loginRequest error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.loginVerify = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    // Step 1: Validate input
    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: "Phone and OTP are required" });
    }

    console.log("Step 1: Received phone & OTP", phone, otp);

    // Step 2: Normalize phone
    const normalizedPhone = normalizeToE164(phone, "KE");
    if (!normalizedPhone) {
      return res.status(400).json({ success: false, message: "Invalid phone number" });
    }
    console.log("Step 2: Normalized phone", normalizedPhone);

    // Step 3: Verify OTP
    let otpResult;
    try {
      otpResult = await verifyOTP(normalizedPhone, otp);
    } catch (err) {
      console.error("OTP verification error:", err);
      return res.status(400).json({ success: false, message: err.message || "OTP verification failed" });
    }

    if (!otpResult.success) {
      return res.status(400).json(otpResult);
    }
    console.log("Step 3: OTP verified", otpResult);

    // Step 4: Find customer
    const customer = await Customer.findOne({ phone: normalizedPhone });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Borrower not registered" });
    }
    console.log("Step 4: Customer found", customer._id);

    // Step 5: Generate access token
    const accessToken = signAccess({ sub: customer._id, role: "borrower" });
    console.log("Step 5: Access token generated");

    // Step 6: Issue refresh token (no artificial timeout)
    let sessionResult;
    try {
      sessionResult = await issueSession(customer._id, {
        ua: req.headers["user-agent"],
        ip: req.ip,
      });
    } catch (err) {
      console.error("Session creation error:", err);
      return res.status(500).json({ success: false, message: "Failed to create session" });
    }
    console.log("Step 6: Refresh token issued");

    // Step 7: Respond with tokens and customer info
    return res.json({
      success: true,
      message: "Login successful",
      customer: {
        id: customer._id,
        fullName: customer.fullName,
        phone: customer.phone,
        isVerified: customer.isVerified,
      },
      tokens: {
        accessToken,
        refreshToken: sessionResult.refreshToken,
      },
    });
  } catch (err) {
    console.error("loginVerify error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
