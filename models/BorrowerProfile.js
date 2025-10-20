const mongoose = require("mongoose");

const customerProfileSchema = new mongoose.Schema({
  customer: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Customer", 
    required: true, 
    unique: true // One profile per customer
  },

  // 1. Basic Personal Info
  dateOfBirth: { type: Date },
  gender: { type: String, enum: ["Male", "Female", "Other"] },
  maritalStatus: { type: String, enum: ["Single", "Married", "Widowed", "Divorced"] },

  // 2. Contact & Location Info
  altPhoneNumber: { type: String },
  physicalAddress: { type: String },
  gpsLocation: {
    lat: { type: Number },
    lng: { type: Number }
  },

  // 3. Economic & Social Info
  occupation: { type: String },
  monthlyIncomeRange: { 
    type: String, 
    enum: ["<KES 5,000", "5k–10k", "10k–20k", "20k+"] 
  },
  nextOfKinName: { type: String },
  nextOfKinPhone: { type: String },

  // 4. Financial Info
  preferredMobileMoney: { type: String, enum: ["M-Pesa", "Airtel", "Other"] },
  savingsGoal: { type: String },
  loanConsent: { type: Boolean, default: false },

  // 5. Compliance / KYC
  kraPin: { type: String },
  agreementAcceptance: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Auto-update timestamp
customerProfileSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("CustomerProfile", customerProfileSchema);
