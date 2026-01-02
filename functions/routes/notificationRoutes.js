const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { protect, borrowerProtect } = require("../middleware/authMiddleware");

// Fetch all notifications for a user
router.get("/", protect,notificationController.getUnreadNotifications);

// Create a new notification
router.post("/",protect, notificationController.markAllAsRead);

// Delete a notification
router.delete("/:id",protect, notificationController.softDeleteNotification);



router.get("/borrower", borrowerProtect, notificationController.getBorrowerNotifications);

router.put("/borrower/read", borrowerProtect,  notificationController.markBorrowerNotificationAsRead);

router.delete("/borrower/:id", borrowerProtect, notificationController.deleteBorrowerNotification);

module.exports = router;

