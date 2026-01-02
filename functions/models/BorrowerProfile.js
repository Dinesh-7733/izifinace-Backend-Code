const mongoose = require("mongoose");

const borrowerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    fullName: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    idNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    frontID: String,
    backID: String,
    livePhoto: String,
    isVerified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("BorrowerProfile", borrowerProfileSchema);

