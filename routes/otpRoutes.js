const express = require("express");
const router = express.Router();
const { sendOTP, verifyOTPController } = require("../controllers/otpController");

// Route to send OTP
router.post("/send", sendOTP);

// Route to verify OTP
router.post("/verify", verifyOTPController);

module.exports = router;
