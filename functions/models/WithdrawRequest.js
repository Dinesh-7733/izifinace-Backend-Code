const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      required: true,
    },
    lenderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: { type: Number, required: true },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "processing", "completed", "failed"],
      default: "pending",
    },

    reason: { type: String }, // optional reject message

    // transactionId: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "Transaction",
    //   default: null,
    // },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WithdrawalRequest", withdrawalSchema);
