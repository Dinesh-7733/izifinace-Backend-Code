// utils/otpService.js

const isUsingFirebase = process.env.OTP_PROVIDER === "firebase";
const sendOtpFirebase = require("./firebaseOtp");
const sendOtpAT = require("./africatalkingOtp");

exports.sendOTP = async (phone) => {
  return isUsingFirebase ? sendOtpFirebase.send(phone) : sendOtpAT.send(phone);
};

exports.verifyOTP = async (phone, code) => {
  return isUsingFirebase ? sendOtpFirebase.verify(phone, code) : sendOtpAT.verify(phone, code);
};
