const mongoose = require('mongoose');

const statsSchema = new mongoose.Schema({
  totalLoansIssued: { type: Number, default: 0 },
  totalRepayments: { type: Number, default: 0 },
  activeLoans: { type: Number, default: 0 },
  overdueLoans: { type: Number, default: 0 },
  paidLoans: { type: Number, default: 0 },

  loanTrends: [
    {
      month: String,
      value: Number,
    }
  ],

  // 🔹 New: lender profit tracking
  lenderProfits: [
    {
      lenderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      lenderName: String,
      totalInterest: { type: Number, default: 0 }
    }
  ],

}, { versionKey: false, timestamps: true });

module.exports = mongoose.model('Stats', statsSchema);
