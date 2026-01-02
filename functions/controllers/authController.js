const multer = require("multer");
// const { bucket } = require("../utils/firebaseConfig");
const User = require("../models/User");
const Profile = require("../models/Profile");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sendSMS = require("../utils/sms");
const africasTalkingService = require("../utils/africatalking");
const { signAccess, issueSession, rotateRefresh,revokeRefresh } = require('../utils/tokens-redis');
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const uploadToFirebase = require("../utils/uploadToFirebase");



// const signAccess = (payload) =>
//   jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: process.env.JWT_ACCESS_TTL });

// const signRefresh = (payload) =>
//   jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_TTL });


// Step 1: Register User (Send OTP)
exports.register = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ message: "Phone number and password are required" });
    }

    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

       // Get OTP service from app.locals
    const { sendVerificationCode } = req.app.locals.otpService;

    // Send OTP
    const otpResponse = await sendVerificationCode(phone);


    if (!otpResponse.success) {
      return res.status(500).json({ message: "Failed to send OTP", error: otpResponse.message });
    }

    // Return OTP in sandbox mode for testing
    const responseData = {
      message: "OTP sent successfully. Verify your phone to complete registration.",
      phone: phone,
    };

    if (otpResponse.sandbox) {
      responseData.otp = otpResponse.otp; // show OTP in sandbox only
    }

    return res.status(200).json(responseData);

  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).json({ message: "Error registering user", error: error.message });
  }
};


// Step 2:// --- VERIFY PHONE & CREATE ACCOUNT (returns BOTH tokens) ---
exports.verifyPhoneNumber = async (req, res) => {
  try {
    const { phone, otp, password } = req.body;
console.log("data:",phone,otp,password);

    // Validate required fields
    if (!phone || !otp || !password ) {
      return res.status(400).json({ message: "Phone, OTP, password, name, and role are required" });
    }
// Get OTP service from app.locals
    const { verifyOTP } = req.app.locals.otpService;
    // Verify OTP
    const ok = await verifyOTP(phone, otp);
    if (!ok) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // Check if user already exists
    const exists = await User.findOne({ phone });
    if (exists) {
      return res.status(409).json({ message: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    let newUser;
    try {
      newUser = await User.create({
        
        phone,
        password: hashedPassword,
        walletBalance: 0,
        role: "lender",
        isPhoneVerified: true,
      });
    } catch (dbErr) {
      console.error("Database Error:", dbErr);
      return res.status(500).json({ message: "Database error", error: dbErr.message });
    }

    // Generate JWT tokens
    const accessToken = signAccess({ sub: newUser._id.toString(), role: newUser.role });
   // issueSession returns { refreshToken, jti }
const { refreshToken } = await issueSession(newUser._id.toString());
    // Success response
    return res.status(201).json({
      message: "User registered successfully",
      accessToken,
      refreshToken,
      user: {
        id: newUser._id,
        
        phone: newUser.phone,
       
        walletBalance: newUser.walletBalance,
        isPhoneVerified: newUser.isPhoneVerified,
      },
    });

  } catch (err) {
    console.error("Error verifying phone number:", err);
    return res.status(400).json({
      message: "Error verifying phone number",
      error: err.message,
    });
  }
};


// // Set up Multer for file upload
// const storage = multer.memoryStorage();
// const upload = multer({ storage: storage }).fields([
//   { name: "selfie", maxCount: 1 },
//   { name: "livePhoto", maxCount: 1 },
//   { name: "frontID", maxCount: 1 },
//   { name: "backID", maxCount: 1 },
// ]);

// Upload ID Verification Endpoint
exports.uploadLenderIDVerification = async (req, res) => {
  try {

        // ✅ Allow only lenders
    if (req.user.role !== "lender") {
      return res.status(403).json({
        message: "Access denied: Only lenders can upload ID verification",
      });
    }

    const lenderId = req.user._id; // assume protect middleware sets req.user
    console.log(lenderId);
    
    const { fullName, idNumber } = req.body;

    if (!fullName || !idNumber) {
      return res.status(400).json({ message: "Full Name and ID Number are required" });
    }
     // 🔹 Check if ID number is already registered by another lender
    const existingID = await Profile.findOne({
      idNumber,
      lenderId: { $ne: lenderId },
    });
    if (existingID) {
      return res.status(409).json({
        message: "This ID number is already registered by another lender.",
      });
    }


    const lender = await User.findById(lenderId).select("+phone");
    if (!lender) return res.status(404).json({ message: "Lender not found" });

    let profile = await Profile.findOne({ lenderId });
    // Check if idNumber already exists for another profile
const existing = await Profile.findOne({ idNumber, lenderId: { $ne: lenderId } });
if (existing) {
  return res.status(409).json({ message: "This ID number is already registered by another lender" });
}

    if (!profile) {
      profile = new Profile({  userId: lenderId, fullName, phone: lender.phone, idNumber });
    } else {
      profile.fullName = fullName;
      profile.idNumber = idNumber;
      profile.phone = lender.phone;
    }

    // Upload files to Firebase
profile.selfie  = (await uploadToFirebase(req.files?.selfie?.[0], "lenderid_verify_selfie", "lenders"))  || profile.selfie;
profile.frontID = (await uploadToFirebase(req.files?.frontID?.[0], "lenderid_verify_frontID", "lenders")) || profile.frontID;
profile.backID  = (await uploadToFirebase(req.files?.backID?.[0], "lenderid_verify_backID", "lenders"))   || profile.backID;


    profile.isVerified = true;
    await profile.save();

    return res.status(200).json({ message: "Lender ID verification submitted successfully", profile });
  }catch (error) {
  console.error("Error uploading lender ID verification:", error);
  return res.status(500).json({
    message: "Server error while uploading lender ID verification",
    error: error.message,  // 🔹 include the actual error
  });
}

};
// Login user
exports.login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ message: 'Phone and password are required' });
    }

    // Normalize phone if you store them normalized (e.g., strip spaces, country code handling)
    const user = await User.findOne({ phone /* or normalizedPhone */ }).select('+password');
    // Use identical response for not found vs wrong password to avoid user enumeration
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

     // Check phone verification status
    if (!user.isPhoneVerified) {
      // You can use 403 (Forbidden) or 409; 403 is conventional here
      return res.status(403).json({ message: 'Phone number not verified. Please verify to continue.' });
    }
        const accessToken = signAccess({ sub: user._id.toString(), role: user.role });
    const { refreshToken } = await issueSession(user._id.toString(), {
      ua: req.get('user-agent'),
      ip: req.ip,
    });

   
    return res.status(200).json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: { id: user._id, name: user.name, phone: user.phone, role: user.role },
    });
  } catch (err) {
    console.error('Error logging in:', err);
    return res.status(500).json({ message: 'Error logging in' });
  }
};


exports.refresh = async (req, res) => {
  try {
    const { refreshToken: oldRefreshToken } = req.body;
    if (!oldRefreshToken) return res.status(400).json({ message: 'refreshToken required' });

    // Verify + rotate (revokes old, mints new)
    let userId, newRefreshToken;
    try {
      const out = await rotateRefresh(oldRefreshToken, {
        ua: req.get('user-agent'),
        ip: req.ip,
      });
      userId = out.userId;
      newRefreshToken = out.refreshToken;
    } catch (e) {
      console.error('Refresh failed:', e.code || e.message);
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    // Load role (or other checks) and issue new access token
    const user = await User.findById(userId).select('role');
    if (!user) return res.status(401).json({ message: 'User not found' });

    const accessToken = signAccess({ sub: userId, role: user.role });
    return res.status(200).json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    console.error('Error refreshing token:', err);
    return res.status(500).json({ message: 'Error refreshing token' });
  }
};

// Send verification code manually (if needed)
exports.sendVerificationCode = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

        // Get the OTP service instance from app.locals
    const { sendVerificationCode } = req.app.locals.otpService;

    const otpResponse = await sendVerificationCode(phone);
    if (!otpResponse.success) {
      return res.status(500).json({ message: "Failed to send OTP" });
    }

    res.status(200).json({ message: "OTP sent successfully" });
  } catch (error) {
    console.error("Error sending verification code:", error);
    res.status(500).json({ message: "Error sending verification code" });
  }
};



// Forgot Password Route
exports.forgotPassword = async (req, res) => {
  try {
    const { phone } = req.body;

    // Validate phone number
    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    // Check if user exists
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate a temporary OTP/password (4-6 digit code)
    const tempPassword = Math.floor(100000 + Math.random() * 900000).toString();

    // Send the temporary password via SMS
    const message = `Your password reset code is: ${tempPassword}`;
    await sendSMS(phone, message);

    // Save the temporary password in the database (hashed for security)
    const salt = await bcrypt.genSalt(10);
    const hashedTempPassword = await bcrypt.hash(tempPassword, salt);
    user.tempPassword = hashedTempPassword;
    await user.save();

    res.json({ message: "Temporary password sent to your phone." });
  } catch (error) {
    console.error("Error handling forgot password:", error);
    res.status(500).json({ message: "Server error" });
  }
};



exports.resetPassword = async (req, res) => {
  try {
    const { phone, otp, password } = req.body;

    // Validate input fields
    if (!phone || !otp || !password) {
      return res.status(400).json({ message: "Phone, OTP, and new password are required" });
    }

    // Check if user exists
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verify OTP (Check if it matches stored tempPassword)
    const isOtpValid = await bcrypt.compare(otp, user.tempPassword);
    if (!isOtpValid) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Update user password and clear tempPassword
    user.password = hashedPassword;
    user.tempPassword = undefined; // Remove temp password after reset
    await user.save();

    res.json({ success: true, message: "Password reset successful!" });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({ message: "Server error" });
  }
};


exports.logout = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ message: 'refreshToken required' });
  await revokeRefresh(refreshToken);
  return res.status(204).send();
};



exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // 1️⃣ Validate permission (very important)
    if (req.user.role !== "admin" && req.user._id.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to delete this account"
      });
    }

    // 2️⃣ Find user
    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    // 3️⃣ Soft delete user
    user.name = null;
    user.phone = null;
    user.firebaseUID = null;
    user.fcmToken = null;

    user.isDeleted = true;
    user.deletedAt = new Date();

    await user.save();

    // 4️⃣ Soft delete profile (if exists)
    const profile = await Profile.findOne({ userId });

    if (profile) {
      profile.fullName = null;
      profile.phone = null;
      profile.idNumber = null;

      profile.isDeleted = true;
      profile.deletedAt = new Date();

      // Optional - anonymize stored images
      // profile.selfie = null;
      // profile.frontID = null;
      // profile.backID = null;

      await profile.save();
    }

    return res.json({
      success: true,
      message: "User and profile deleted successfully (soft delete)."
    });

  } catch (err) {
    console.error("Delete error:", err.message);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
