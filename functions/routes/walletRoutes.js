const express = require("express");
const router = express.Router(); // Initialize the router
const walletController = require("../controllers/walletController");
const validateRegisteredPhone = require("../middleware/validatePhone");
const { protect, borrowerProtect } = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/rolemiddleware");

// Deposit money into wallet
router.post("/deposit",protect, walletController.deposit);

// Withdraw money from wallet
router.post("/withdraw", protect,walletController.withdraw);

// Send balance via SMS
router.post("/send-balance-sms", walletController.sendBalanceSMS);

router.post("/customer/deposit",borrowerProtect,walletController.depositSavings)

router.post("/customer/withdraw",borrowerProtect,walletController.withdrawCustomerSavings)

router.post("/agent/withdraw",protect,
  authorizeRoles("agent"),walletController.requestAgentWithdrawal)


router.post("/agent/review-withdraw",protect,
  authorizeRoles("lender"),walletController.reviewAgentWithdrawRequest)

  router.get("/agent-withdrawal", protect, walletController.getPendingWithdrawalsForLender);
  
module.exports = router; // Export the router