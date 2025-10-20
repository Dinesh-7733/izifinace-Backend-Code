const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const agentSchema = new mongoose.Schema({
  lenderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Lender",
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    match: [/^\+2547\d{8}$/, "Invalid Kenya phone format (+2547XXXXXXXX)"]
  },
  password: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ["Active", "Inactive"],
    default: "Active"
  },
  totalEarnings: {
    type: Number,
    default: 0
  },
  commissionEarned: { type: Number, default: 0 },

  totalCustomers: {
    type: Number,
    default: 0
  },
    
  role: {
    type: String,
    default: "agent"
  },
  customers: [  // 🔹 Array to store customer IDs
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer"
    }
  ]
}, { timestamps: true });

// 🔐 Hash password before saving
agentSchema.pre("save", async function(next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ✅ Password verification method
agentSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// ✅ Add customer to the array and increment count
agentSchema.methods.addCustomer = async function(customerId) {
  if (!this.customers.includes(customerId)) {
    this.customers.push(customerId);
    this.totalCustomers += 1;
    await this.save();
  }
};

module.exports = mongoose.model("Agent", agentSchema);
