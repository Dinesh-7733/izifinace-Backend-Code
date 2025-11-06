const express = require("express");
const router = express.Router();
const customerController = require("../controllers/customerController");

const { protect, borrowerProtect } = require("../middleware/authMiddleware");

const upload = require("../utils/upload");
const authorizeRoles = require("../middleware/rolemiddleware");
const { validateKenyaPhone } = require("../middleware/validateKenyaPhone");


router.get("/eligible-loan",protect,customerController.getCustomersWithoutActiveLoans) 
// Register a new borrower with ID photos
// Upload 3 files with fields
router.post(
  "/register",
  protect,
   authorizeRoles( "lender"), // ✅ allow agent or lender
  upload.fields([
    { name: "frontID", maxCount: 1 },
    { name: "backID", maxCount: 1 },
    { name: "livePhoto", maxCount: 1 },
  ]),validateKenyaPhone,
  customerController.registerCustomer
);


router.get("/findAll",protect, customerController.getAllCustomers);
// GET customer details by ID
// router.get("/:id",protect, customerController.getCustomerWithProfile);

// Add or update profile
// router.post("/:customerId/profile", customerController.UpdateBorrowerProfile);
// Get borrower savings balance
router.get("/savings/:customerId", customerController.getSavings);


router.get("/login/profile",borrowerProtect,customerController.getBorrowerProfile)


module.exports = router;