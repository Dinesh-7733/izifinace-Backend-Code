const express = require("express");
const router = express.Router(); // Initialize the router
const walletController = require("../controllers/walletController");
const validateRegisteredPhone = require("../middleware/validatePhone");
const { protect } = require("../middleware/authMiddleware");

// Deposit money into wallet
router.post("/deposit",protect, walletController.deposit);

// Withdraw money from wallet
router.post("/withdraw", protect,walletController.withdraw);

// Send balance via SMS
router.post("/send-balance-sms", walletController.sendBalanceSMS);


module.exports = router; // Export the router