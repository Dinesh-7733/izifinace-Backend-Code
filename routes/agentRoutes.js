const express = require("express");
const router = express.Router();


const { registerAgent, changePassword, loginAgent, registerCustomer, getAgentProfile } = require("../controllers/agentController");
const { protect, agentProtect } = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/rolemiddleware");
const upload = require("../utils/upload");
const { validateKenyaPhone } = require("../middleware/validateKenyaPhone.js");

// Register agent (lender only)
router.post("/register", protect,authorizeRoles("lender"), validateKenyaPhone, // ✅ phone validation here
registerAgent);

// Agent login
router.post("/login",validateKenyaPhone,loginAgent);

// Change password (agent only, must be logged in)
router.put("/change-password", protect, changePassword);


router.post(
  "/register/customer",
  protect,                    // ✅ authenticate JWT
  authorizeRoles("agent"),    // ✅ only agent can register customer
  upload.fields([
    { name: "frontID", maxCount: 1 },
    { name: "backID", maxCount: 1 },
    { name: "livePhoto", maxCount: 1 }
  ]),validateKenyaPhone,
  registerCustomer
);

router.get("/profile",protect,getAgentProfile)
module.exports = router;
