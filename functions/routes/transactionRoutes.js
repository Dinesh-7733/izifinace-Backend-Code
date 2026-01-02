const express = require("express");
const router = express.Router();
const { getRecentTransactions, addTransaction } = require("../controllers/transactionController");
const { protect } = require("../middleware/authMiddleware"); // Protect routes with authentication middleware

// GET /api/transactions - Fetch recent transactions
router.get("/", protect, getRecentTransactions);

// POST /api/transactions - Add a new transaction
router.post("/", protect, addTransaction);

module.exports = router;
