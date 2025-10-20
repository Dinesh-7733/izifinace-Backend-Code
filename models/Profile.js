const mongoose = require("mongoose");

const profileSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    // required: true, 
    unique: true 
  },
  fullName: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  idNumber: { type: String, required: true, unique: true },
  selfie: { type: String }, // For lenders
  livePhoto: { type: String }, // For borrowers
  frontID: { type: String },
  backID: { type: String },
  isVerified: { type: Boolean, default: false }, // Verification status
});

module.exports = mongoose.model("Profile", profileSchema);
