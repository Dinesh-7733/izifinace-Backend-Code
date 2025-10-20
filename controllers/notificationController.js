const Notification = require("../models/Notification");

// Fetch notifications (for the `NotificationsScreen.js` component)
// 1. Get notifications (only not deleted & unread for user)
exports.getUnreadNotifications = async (req, res) => {
  try {
    const userId = req.user._id; // userId from token middleware

    const notifications = await Notification.find({
      userId,
      isDeleted: false,
      
    }).sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getBorrowerNotifications = async (req, res) => {
  try {
    const borrowerId = req.borrower._id; // borrowerProtect middleware sets this

    const notifications = await Notification.find({
      borrowerId,
      isDeleted: false,
    }).sort({ createdAt: -1 }); // latest first

    res.status(200).json({ 
      success: true, 
      count: notifications.length,
      data: notifications 
    });
  } catch (error) {
    console.error("Error fetching borrower notifications:", error.message);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch borrower notifications", 
      error: error.message 
    });
  }
};

exports.markBorrowerNotificationAsRead = async (req, res) => {
  try {
    const borrowerId = req.borrower._id;
    const { id } = req.params; // notification ID

    const notification = await Notification.findOneAndUpdate(
      { _id: id, borrowerId, isDeleted: false },
      { $set: { isRead: true } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.status(200).json({ success: true, data: notification });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteBorrowerNotification = async (req, res) => {
  try {
    const borrowerId = req.borrower._id;
    const { id } = req.params; // notification ID

    const notification = await Notification.findOneAndUpdate(
      { _id: id, borrowerId, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.status(200).json({ success: true, message: "Notification deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create a new notification (to store important updates)
// 2. Mark as read

// ✅ 2. Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await Notification.updateMany(
      { userId, isDeleted: false, isRead: false },
      { $set: { isRead: true } }
    );

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a notification (if needed in the future)
// 3. Soft delete
exports.softDeleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.status(200).json({ success: true, data: notification });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
