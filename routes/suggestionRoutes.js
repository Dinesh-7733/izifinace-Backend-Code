const express = require("express");
const router = express.Router(); // Initialize the router
const suggestionController = require("../controllers/suggestionController");

// Suggest loan amount based on savings
router.get("/suggest/:borrowerId", suggestionController.suggestLoanAmount);

module.exports = router; // Export the router