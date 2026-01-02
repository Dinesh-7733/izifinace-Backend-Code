const Transaction = require("../models/Transaction");

// Fetch Recent Transactions
exports.getRecentTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.id }) // Fetch user-specific transactions
      .sort({ date: -1 }) // Sort by most recent
      .limit(20); // Limit results

    res.json({ transactions });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
};

// Add a New Transaction
exports.addTransaction = async (req, res) => {
  try {
    const { type, amount, description } = req.body;
    
    if (!type || amount === undefined) {
      return res.status(400).json({ message: "Type and amount are required" });
    }

    const transaction = new Transaction({
      userId: req.user.id, // Assuming user is authenticated
      type,
      amount,
      description,
    });

    await transaction.save();
    res.status(201).json({ message: "Transaction added successfully", transaction });

  } catch (error) {
    console.error("Error adding transaction:", error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
};
