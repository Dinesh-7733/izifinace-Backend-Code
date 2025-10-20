const express = require("express");
const router = express.Router();
const { getRecentActivity, getAllTransactions } = require("../controllers/activityController");

router.get("/activity", getRecentActivity);
router.get("/transactions", getAllTransactions);

module.exports = router;

