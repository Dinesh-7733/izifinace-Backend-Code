const OTP = require("../models/OTP");
const User = require("../models/User"); // Assuming you have a User model
const {sendSMS }= require("../utils/sms"); // Function to send SMS
const generateOTP = require("../utils/generateOTP"); // Function to generate OTP
const { isE164, normalizeToE164 } = require("../utils/phone");




// Send OTP
// Send OTP
exports.sendOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    console.log("Phone:", phone);

    if (!phone) {
      return res.status(400).json({ message: "Missing 'phone' in body" });
    }

    // Get OTP service from app.locals (correct!)
    const { sendVerificationCode } = req.app.locals.otpService;

    const otpResponse = await sendVerificationCode(phone);

    if (!otpResponse.success) {
      return res.status(500).json({
        message: "Failed to send OTP",
        error: otpResponse.message,
      });
    }

    const responseData = {
      success: true,
      message: "OTP sent successfully",
      phone: otpResponse.phone,
    };

    // Sandbox → OTP included for testing
    if (otpResponse.sandbox) {
      responseData.otp = otpResponse.otp;
    }

    return res.status(200).json(responseData);

  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ message: "Server error while sending OTP" });
  }
};


// Verify OTP
exports.verifyOTPController = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ message: "Phone and OTP are required" });
    }

    // Get OTP service (correct!)
    const { verifyOTP } = req.app.locals.otpService;

    const result = await verifyOTP(phone, otp);

    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    return res.json({ message: result.message });

  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ message: "Server error while verifying OTP" });
  }
};
