const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ["repayment", "savings", "loan issued", "withdrawal",  "customer deposit","agent withdrawal",// new
      "customer withdrawal" // new

    ],
    required: true 
  },
 // only for loan/repayment
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    refPath: "userModel", // dynamically reference either User or Customer
    required: true
  },
  userModel: { 
    type: String, 
    required: true,
    enum: ["User", "Customer","Agent"] // removed Agent
  },
checkoutRequestID: { type: String, default: null }, // optional
    withdrawalRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WithdrawalRequest"
    },
  loanId: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" }, // only for loan/repayment
  clientId: { type: String }, // National ID reference
  phone: { type: String },    // Mpesa phone used


  // ⭐ ADD ACCOUNT REFERENCE HERE (IMPORTANT)
  accountReference: { type: String },   // <-- Save dynamic AccountReference
  
transactionId: {
  type: String,
  index: { unique: true, sparse: true },
  default: undefined
},
// models/Transaction.js
originatorConversationID: {
  type: String,
  unique: true,
  sparse: true,
},


  amount: { type: Number, required: true },
  balanceBefore: { type: Number, default: 0 },
  balanceAfter: { type: Number, default: 0 },

  status: { type: String, enum: ["pending", "successful","reversed" ,"failed"], default: "pending" },

  mpesaPayload: { type: mongoose.Schema.Types.Mixed }, // store raw Daraja payload
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Transaction", transactionSchema);


const Transaction = mongoose.model("Transaction", transactionSchema);

module.exports = Transaction;
