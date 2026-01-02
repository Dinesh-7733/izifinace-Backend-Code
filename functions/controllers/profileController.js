const Profile = require('../models/Profile');

exports.getProfile = async (req, res) => {
  try {
    const profile = await Profile.findOne({ userId: req.user._id })
      .populate({
        path: "userId",
        select: "-password -__v" // exclude password & version field
      });
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { fullName, idNumber, selfie, frontID, backID } = req.body;

    const profile = await Profile.findOneAndUpdate(
      { phone: req.user.phone },
      {  selfie },
      { new: true }
    );

    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    res.json({ message: 'Profile updated', profile });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};



exports.getCustomerProfile = async (req, res) => {
    try {
      const { phone } = req.params; // Get phone from request URL
  
      const customer = await Profile.findOne({ phone });
  
      if (!customer) return res.status(404).json({ message: "Customer not found" });
  
      res.json(customer);
    } catch (error) {
      res.status(500).json({ message: "Server error", error });
    }
};