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


// Borrower transactions
const getBorrowerRecentActivity = async (req, res) => {
  try {
    const borrower = req.borrower;
    if (!borrower) return res.status(404).json({ success: false, message: "Borrower not found" });

    const transactions = await Transaction.find({ userId: borrower._id, userModel: "Customer" })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("loanId");

    res.status(200).json({ success: true, transactions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error fetching borrower transactions" });
  }
};

const getBorrowerAllTransactions = async (req, res) => {
  try {
    const borrower = req.borrower;
    if (!borrower) return res.status(404).json({ success: false, message: "Borrower not found" });

    const transactions = await Transaction.find({ userId: borrower._id, userModel: "Customer" })
      .sort({ createdAt: -1 })
      .populate("loanId");

    res.status(200).json({ success: true, transactions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error fetching borrower transactions" });
  }
};

// Lender transactions
const getLenderRecentActivity = async (req, res) => {
  try {
    const lender = req.user;
    if (!lender) return res.status(404).json({ success: false, message: "Lender not found" });

    const transactions = await Transaction.find({ userId: lender._id, userModel: "User" })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("loanId")
      .populate("userId");

    res.status(200).json({ success: true, transactions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error fetching lender transactions" });
  }
};

const getLenderAllTransactions = async (req, res) => {
  try {
    const lender = req.user;
    if (!lender) return res.status(404).json({ success: false, message: "Lender not found" });

    const transactions = await Transaction.find({ userId: lender._id, userModel: "User" })
      .sort({ createdAt: -1 })
      .populate("loanId")
      .populate("userId");

    res.status(200).json({ success: true, transactions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error fetching lender transactions" });
  }
};

// ✅ Export all functions
module.exports = {
  // getRecentActivity,
  // getAllTransactions,
  getBorrowerRecentActivity,
  getBorrowerAllTransactions,
  getLenderRecentActivity,
  getLenderAllTransactions
};