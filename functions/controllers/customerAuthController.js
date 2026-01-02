// controllers/borrowerAuthController.js

const Customer = require("../models/customer");

const { normalizeToE164 } = require("../utils/phone");
const { signAccess, issueSession, rotateRefresh,revokeRefresh } = require('../utils/tokens-redis');


// 📌 Borrower Login Request → Send OTP
// ----------------------------------------------
exports.loginRequest = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone is required" });
    }

    // Normalize
    const normalizedPhone = normalizeToE164(phone, "KE");
    if (!normalizedPhone) {
      return res.status(400).json({ success: false, message: "Invalid phone number" });
    }

    // Ensure borrower exists
    const customer = await Customer.findOne({ phone: normalizedPhone });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Borrower not registered" });
    }

    // 🔥 Get OTP service dynamically
    const { sendVerificationCode } = req.app.locals.otpService;

    // Send OTP
    const result = await sendVerificationCode(normalizedPhone);

    if (!result.success) {
      return res.status(500).json({ success: false, message: "Failed to send OTP" });
    }

    // Sandbox → include OTP
    if (result.sandbox) {
      return res.json({
        success: true,
        message: "OTP sent successfully (sandbox mode)",
        sandbox: true,
        otp: result.otp,
      });
    }

    return res.json({ success: true, message: "OTP sent successfully" });

  } catch (err) {
    console.error("loginRequest error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};



// ----------------------------------------------
// 📌 Borrower Login Verify → Check OTP + Issue Tokens
// ----------------------------------------------
exports.loginVerify = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: "Phone and OTP are required" });
    }

    console.log("Step 1: Received phone & OTP", phone, otp);

    // Normalize
    const normalizedPhone = normalizeToE164(phone, "KE");
    if (!normalizedPhone) {
      return res.status(400).json({ success: false, message: "Invalid phone number" });
    }
    console.log("Step 2: Normalized phone", normalizedPhone);

    // 🔥 Get OTP service dynamically
    const { verifyOTP } = req.app.locals.otpService;

    // Verify OTP
    const otpResult = await verifyOTP(normalizedPhone, otp);

    if (!otpResult.success) {
      return res.status(400).json({ success: false, message: otpResult.message });
    }

    console.log("Step 3: OTP verified");

    // Find customer
    const customer = await Customer.findOne({ phone: normalizedPhone });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Borrower not registered" });
    }

    console.log("Step 4: Customer found:", customer._id);

    // Generate JWT access token
    const accessToken = signAccess({
      sub: customer._id,
      role: "borrower",
    });

    console.log("Step 5: Access token generated");

    // Issue refresh token
    const session = await issueSession(customer._id, {
      ua: req.headers["user-agent"],
      ip: req.ip,
    });

    console.log("Step 6: Refresh token issued");

    // Success
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
        refreshToken: session.refreshToken,
      },
    });

  } catch (err) {
    console.error("loginVerify error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};


// controllers/deleteBorrower.controller.js


exports.deleteBorrower = async (req, res) => {
  try {
    const borrowerId = req.params.id;

    // 1️⃣ Allow only borrower to delete themselves  
    if (req.borrower._id.toString() !== borrowerId) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to delete this borrower account."
      });
    }

    // 2️⃣ Find borrower
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({
        success: false,
        message: "Borrower not found"
      });
    }

    // 3️⃣ Soft delete PII
    borrower.fullName = null;
    borrower.phone = null;
    borrower.idNumber = null;
    borrower.altPhoneNumber = null;
    borrower.nextOfKinName = null;
    borrower.nextOfKinPhone = null;

    // Optional: remove images
    // borrower.livePhoto = null;
    // borrower.frontID = null;
    // borrower.backID = null;

    borrower.isDeleted = true;
    borrower.deletedAt = new Date();

    await borrower.save();

    return res.json({
      success: true,
      message: "Borrower account deleted successfully (soft delete)."
    });

  } catch (err) {
    console.error("Delete Borrower Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};
