const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect ,statsController.getStats);

module.exports = router;
