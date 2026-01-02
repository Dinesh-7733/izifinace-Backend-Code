const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true }, // OTP expiry time
});

module.exports = mongoose.model("OTP", otpSchema);
