const express = require("express");
const router = express.Router();
const borrowerController = require("../controllers/borrowerProfileController");


const { protect } = require("../middleware/authMiddleware");
// const { uploadIDFields } = require("../utils/multer");

// POST /api/borrowers/register
// router.post("/register", protect,  borrowerController.registerBorrower);

// GET all borrowers
router.get("/findAll", protect,borrowerController.getAllBorrowers);
module.exports = router;
