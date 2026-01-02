const express = require("express");
const router = express.Router();
const customerController = require("../controllers/customerController");

const { protect, borrowerProtect } = require("../middleware/authMiddleware");
const { app } = require("../app");


const authorizeRoles = require("../middleware/rolemiddleware");
const { validateKenyaPhone } = require("../middleware/validateKenyaPhone");
const busboyMiddleware = require("../middleware/busboyMiddleware");
const firebaseSafeUpload = require("../utils/upload");


router.get("/eligible-loan",protect,customerController.getCustomersWithoutActiveLoans) 
// Register a new borrower with ID photos
// Upload 3 files with fields
// Enhanced customer registration with proper error handling

// Register a new borrower with ID photos - USING BUSBOY
// Register a new borrower with ID photos - USING BUSBOY WITH RAW BODY
// Register a borrower with 3 files
router.post(
  "/register",
  protect,
  authorizeRoles("lender"),

  firebaseSafeUpload([
    { name: "frontID", maxCount: 1 },
    { name: "backID", maxCount: 1 },
    { name: "livePhoto", maxCount: 1 },
  ]),

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