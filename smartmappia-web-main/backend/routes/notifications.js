const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const {
  registerToken,
  unregisterToken,
  listMyNotifications,
} = require('../controllers/notificationsController');

// Register / refresh this device's push token (called after login on the app).
router.post('/register', requireAuth, registerToken);
// Remove a device token (called on logout).
router.post('/unregister', requireAuth, unregisterToken);
// A user's own notification history.
router.get('/', requireAuth, listMyNotifications);

module.exports = router;
