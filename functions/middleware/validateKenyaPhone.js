// middlewares/validateKenyaPhone.js

exports.validateKenyaPhone = (req, res, next) => {
  const { phone } = req.body;

  // Kenya phone number format: +2547XXXXXXXX (13 characters total)
  const kenyaPhoneRegex = /^\+2547\d{8}$/;

  if (!phone) {
    return res.status(400).json({ message: "Phone number is required" });
  }

  if (!kenyaPhoneRegex.test(phone)) {
    return res
      .status(400)
      .json({ message: "Invalid Kenya phone format (+2547XXXXXXXX)" });
  }

  next();
};
