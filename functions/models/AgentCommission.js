// models/AgentCommission.js
const mongoose = require("mongoose");

const agentCommissionSchema = new mongoose.Schema({
  agentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Agent", 
    required: true 
  },
  loanId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Loan", 
    required: true 
  },
  commissionType: { 
    type: String, 
    enum: ["approval", "full_repayment"], 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  status: {
    type: String,
    enum: ["pending", "earned", "cancelled"],
    default: "pending"
  },
  transactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Transaction"
  },
  issuedAt: { 
    type: Date, 
    default: Date.now 
  },
  earnedAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  },
  cancellationReason: {
    type: String
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate commissions
agentCommissionSchema.index({ 
  agentId: 1, 
  loanId: 1, 
  commissionType: 1 
}, { 
  unique: true 
});

module.exports = mongoose.model("AgentCommission", agentCommissionSchema);