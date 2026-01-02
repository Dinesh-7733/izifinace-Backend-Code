const express = require("express");
const router = express.Router();
const { borrowerProtect, protect } = require("../middleware/authMiddleware");
const { getLenderRecentActivity, getLenderAllTransactions,getBorrowerRecentActivity,getBorrowerAllTransactions}= require("../controllers/activityController.js")


router.get("/activity",protect,getLenderRecentActivity);
router.get("/transactions", protect,getLenderAllTransactions);


router.get("/borrower-activity",borrowerProtect, getBorrowerRecentActivity);
router.get("/borrower-transactions",borrowerProtect, getBorrowerAllTransactions);



module.exports = router;

