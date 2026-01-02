const User = require("../models/User"); // Assuming you have a User model

const validateRegisteredPhone = async (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ message: "Phone number is required" });
  }

  try {
    const user = await User.findOne({ phone });

    if (!user) {
      return res.status(404).json({ message: "Phone number not registered" });
    }

    next(); // Proceed if phone is valid
  } catch (error) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

module.exports = validateRegisteredPhone;

