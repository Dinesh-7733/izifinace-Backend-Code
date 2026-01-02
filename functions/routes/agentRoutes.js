const express = require("express");
const router = express.Router();


const { registerAgent, changePassword, loginAgent, registerCustomer, getAgentProfile, getCustomersForAgent , } = require("../controllers/agentController");
const { protect, agentProtect } = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/rolemiddleware.js");
// Get upload from app locals
const { validateKenyaPhone } = require("../middleware/validateKenyaPhone.js");
const firebaseSafeUpload = require("../utils/upload.js");
// const handleMulterErrors = require("../utils/upload.js")
// Register agent (lender only


router.post(
  "/register/customer",
    protect,
  authorizeRoles("agent"),

  firebaseSafeUpload([
    { name: "frontID", maxCount: 1 },
    { name: "backID", maxCount: 1 },
    { name: "livePhoto", maxCount: 1 },
  ]),

  registerCustomer
);

router.get(
  "/getall/customer",
    protect,
  authorizeRoles("agent"),
  getCustomersForAgent 
);


router.post("/register", protect,authorizeRoles("lender"), validateKenyaPhone, // ✅ phone validation here
registerAgent);

// Agent login
router.post("/login",validateKenyaPhone,loginAgent);

// Change password (agent only, must be logged in)
router.put("/change-password", protect, changePassword);


// Enhanced customer registration with proper error handling



router.get("/profile",protect,getAgentProfile)
module.exports = router;
