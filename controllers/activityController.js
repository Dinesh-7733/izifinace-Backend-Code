const Transaction = require("../models/Transaction"); // Adjust path to your Transaction model
const asyncHandler = require("express-async-handler");

// @desc    Get recent activity (optional: last 20 activities)
// @route   GET /api/activity
// @access  Private or Public (based on your auth)
const getRecentActivity = asyncHandler(async (req, res) => {
  const recentActivity = await Transaction.find().sort({ createdAt: -1 }).limit(100);
  res.status(200).json({ transactions: recentActivity });
});

// @desc    Get all transactions (or paginated)
// @route   GET /api/transactions
// @access  Private or Public
const getAllTransactions = asyncHandler(async (req, res) => {
  const transactions = await Transaction.find().sort({ createdAt: -1 });
  res.status(200).json(transactions);
});

module.exports = { getRecentActivity, getAllTransactions };
