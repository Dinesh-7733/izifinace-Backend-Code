const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: "userModel"  // dynamically decide model
  },
  userModel: {
    type: String,
    required: true,
    enum: ["User", "Customer","Agent"] // allowed models
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: {
    type: String,
    enum: [
      "deposit",
      "withdraw",
      "loan",
      "repayment",
      "loan_approved",
      "payment_due",
      "missed_payment",
      "general",
      "loan_rejected"
    ],
    default: "general"
  },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
   // 🔹 Soft delete fields
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },

});

module.exports = mongoose.model("Notification", NotificationSchema);
