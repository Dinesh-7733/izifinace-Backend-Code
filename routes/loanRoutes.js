const express = require("express");
const router = express.Router(); // Initialize the router
const loanController = require("../controllers/loanController");
const validateRegisteredPhone = require("../middleware/validatePhone");
const { protect, borrowerProtect } = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/rolemiddleware");

// Issue a new loan
router.post("/issue", protect, loanController.issueLoan);


// --- B2C Callback ---
// Safaricom will call this endpoint after B2C payment

router.post("/outstanding/loan-details",borrowerProtect ,loanController.getActiveLoansByPhone);

// Track loan repayments
router.post("/repay", loanController.trackRepayment);

router.get("/fully-paid",protect, loanController.getFullyPaidLoans);


router.get("/customers-with-fully-paid/loans", loanController.getAllCustomersWithLoansFullyPaid);


// GET all fully paid loans for a borrower
router.get("/borrower/:borrowerId/fully-paid", loanController.getFullyPaidLoansByCustomer);

router.get("/borrowers/active-overdue", loanController.getBorrowersWithLoans);


router.get('/outstanding/:borrowerId',protect, loanController.getLoansByBorrower);



router.post("/request-loan",protect,authorizeRoles("agent"),loanController.requestLoan);

router.get("/loan-requests",protect,authorizeRoles("lender"),loanController.getAllLoanRequests);

router.post("/review-loan",protect,authorizeRoles("lender"),loanController.reviewLoanRequest);

module.exports = router; // Export the router