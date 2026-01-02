// functions/routes/c2bRoutes.js
const express = require("express");
const { registerC2B, simulatePayment, validationHandler, confirmationHandler } = require("../controllers/mpesaC2BController");
const router = express.Router();

// Import the controller
// PUBLIC MPESA CALLBACKS
router.post("/validate", validationHandler);
router.post("/confirm", confirmationHandler);

// DEV ACTIONS
router.post("/register", registerC2B);
router.post("/simulate", simulatePayment);



// Health check for C2B
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "C2B service is healthy",
    timestamp: new Date().toISOString(),
    endpoints: {
      register: "POST /c2b/register",
      validate: "POST /c2b/validate",
      confirm: "POST /c2b/confirm",
      simulate: "POST /c2b/simulate",
      debug: "POST /c2b/debug",
      "debug-config": "GET /c2b/debug-config",
      health: "GET /c2b/health"
    }
  });
});

module.exports = router;