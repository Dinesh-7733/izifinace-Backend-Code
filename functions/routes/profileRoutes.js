const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, profileController.getProfile);
router.put('/', protect, profileController.updateProfile);
router.get('/customer/:phone', protect, profileController.getCustomerProfile);

module.exports = router;
