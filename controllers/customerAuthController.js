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
    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: "Phone and OTP are required" });
    }

    const normalizedPhone = normalizeToE164(phone, "KE");
    if (!normalizedPhone) return res.status(400).json({ success: false, message: "Invalid phone number" });

    // Verify OTP
    const result = await verifyOTP(normalizedPhone, otp);
    if (!result.success) return res.status(400).json(result);

    // Get customer
    const customer = await Customer.findOne({ phone: normalizedPhone });
    if (!customer) return res.status(404).json({ success: false, message: "Borrower not registered" });

    // Generate tokens
    const accessToken = signAccess({ sub: customer._id, role: "borrower" });
    const { refreshToken } = await issueSession(customer._id, {
      ua: req.headers["user-agent"],
      ip: req.ip,
    });

    res.json({
      success: true,
      message: "Login successful",
      customer: {
        id: customer._id,
        fullName: customer.fullName,
        phone: customer.phone,
        isVerified: customer.isVerified,
      },
      tokens: { accessToken, refreshToken },
    });
  } catch (err) {
    console.error("loginVerify error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
