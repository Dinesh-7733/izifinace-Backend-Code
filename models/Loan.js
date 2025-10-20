const mongoose = require("mongoose");


const loanSchema = new mongoose.Schema({
  lenderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  borrowerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
  requestedByAgentId: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", required: true }, // Agent who requested
  issuedByLenderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Lender who approved

  clientId: { type: String}, // National ID for M-Pesa BillRef
  fullName: String,
  phoneNumber: String,
  lenderPhone: String,

  amount: { type: Number, required: true, min: 0 },
  interest: { type: Number, required: true, min: 0 },
  // fee: { type: Number, required: true, min: 0 },
  totalRepayment: { type: Number, required: true, min: 0 },
  dailyRepayment: { type: Number, required: true, min: 0 },

  repaidAmount: { type: Number, default: 0 },
  balance: { type: Number, default: function() { return this.totalRepayment; } },

  duration: { type: Number, required: true, min: 1 },
  issueDate: { type: Date, default: Date.now },
  dueDate: { type: Date, required: true },

  status: { type: String, enum: ["pending", "active", "fully paid", "overdue"], default: "active" },
  // ✅ New loan request status
  loanRequestStatus: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  // rejectReason: { type: String, default: null },
  repayments: [{
    amount: Number,
    date: { type: Date, default: Date.now },
    transactionId: String
  }],
// 🔹 Add this field for reminders
  lastReminderSent: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});



// Update the `updatedAt` field before saving
loanSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// ✅ Create and export the model
const Loan = mongoose.model("Loan", loanSchema);
module.exports = Loan;