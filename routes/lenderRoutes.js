const express = require("express");
const router = express.Router();
const lenderController = require("../controllers/lenderController");
const authorizeRoles = require("../middleware/rolemiddleware");
const { protect } = require("../middleware/authMiddleware");

// Send money to borrower
router.post("/send-money", lenderController.sendMoneyToBorrower);
router.get("/customers", protect, authorizeRoles("lender"),lenderController.getAllCustomersForLender);
router.post("/assign-customer", protect, authorizeRoles("lender"), lenderController.assignCustomerToAgent);
router.get("/agents", protect,authorizeRoles("lender"), lenderController.getAgentsByLender);

module.exports = router;
