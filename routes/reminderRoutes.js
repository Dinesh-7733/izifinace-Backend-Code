const express = require("express");
const { sendBorrowerLoanReminder } = require("../controllers/reminderController");
const { protect } = require("../middleware/authMiddleware");
const router = express.Router();


// 🔹 Route to send reminder for one borrower by ID
// Example: GET /api/reminder/borrower/68b70973f3fa3b05db0298b2
router.post("/borrower/:borrowerId/loan/:loanId",protect, sendBorrowerLoanReminder);
module.exports = router;
