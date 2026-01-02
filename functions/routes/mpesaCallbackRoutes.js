const express = require("express");
const { stkCallback, reversalResultHandler, reversalTimeoutHandler } = require("../controllers/stkCallbackController");
const { b2cCallback } = require("../controllers/b2cCallbackController");

const router = express.Router();

// STK Push callback

router.post("/stk/callback", stkCallback);

// B2C Payment callback (loan disbursement / withdrawals)
router.post('/b2c/callback', b2cCallback)
// Transaction Reversal callbacks

router.post("/reversal/result", reversalResultHandler);
router.post("/reversal/timeout", reversalTimeoutHandler);

module.exports = router;