// routes/borrowerAuth.js
const express = require("express");
const router = express.Router();

// const tokenController = require("../controllers/tokenController"); // for refresh + logout
const { loginRequest, loginVerify } = require("../controllers/customerAuthController");

// Borrower OTP login
router.post("/login/request", loginRequest)
router.post("/login/verify",loginVerify);

// Token handling
// router.post("/refresh", tokenController.refreshToken);   // get new access + refresh token
// router.post("/logout", tokenController.logout);          // revoke refresh token

module.exports = router;
