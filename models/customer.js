const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema({
  registeredBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: "registeredByModel" // dynamically reference model
  },
  registeredByModel: {
    type: String,
    required: true,
    enum: ["User", "Agent"] // allow either User or Agent
  },
  assignedAgent: { type: mongoose.Schema.Types.ObjectId, ref: "Agent" }, // assigned agent
  fullName: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  idNumber: { type: String, required: true, unique: true },
  livePhoto: { type: String, required: true }, // Borrower must provide live photo
  frontID: { type: String, required: true },   // ID front photo
  backID: { type: String, required: true },    // ID back photo
  isVerified: { type: Boolean, default: false }, // Verification status
  preferences: { 
    type: mongoose.Schema.Types.Mixed, // Optional extra data
    default: {} 
  }, 
  savingsBalance: { 
    type: Number, 
    default: 0, 
    min: 0 // Ensure savings balance cannot be negative
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Agent"
  },

  // 🔹 Customer Profile Fields
  dateOfBirth: { type: Date },
  gender: { type: String, enum: ["Male", "Female", "Other"] },
  maritalStatus: { type: String, enum: ["Single", "Married", "Widowed", "Divorced"] },

  altPhoneNumber: { type: String },
  physicalAddress: { type: String },
  gpsLocation: {
    lat: { type: Number },
    lng: { type: Number }
  },

  occupation: { type: String },
  monthlyIncomeRange: { 
    type: String, 
    enum: ["<KES 5,000", "5k–10k", "10k–20k", "20k+"] 
  },
  nextOfKinName: { type: String },
  nextOfKinPhone: { type: String },

  preferredMobileMoney: { type: String, enum: ["M-Pesa", "Airtel", "Other"] },
  savingsGoal: { type: String },
  loanConsent: { type: Boolean, default: false },

  kraPin: { type: String },
  agreementAcceptance: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Auto-update `updatedAt` before saving
customerSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Customer", customerSchema);
