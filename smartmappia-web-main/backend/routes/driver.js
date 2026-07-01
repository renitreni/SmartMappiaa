const express = require('express');
const router = express.Router();
const { requireDriver, requireApprovedDriver } = require('../middleware/auth');
const { driverAcceptLimiter, locationLimiter } = require('../middleware/rateLimiters');
const {
  listAvailableRides,
  acceptRide,
  updateDriverLocation,
  listMyRides,
  updateRideStatus,
} = require('../controllers/driverController');
const {
  createDocUploadUrl,
  recordDriverDocument,
  listMyDocuments,
} = require('../controllers/driverDocsController');

// Seeing the open feed, accepting, and broadcasting location all require an
// APPROVED driver. Viewing/advancing already-assigned rides only needs a
// signed-in driver.
router.get('/available', requireApprovedDriver, listAvailableRides);
router.post('/location', locationLimiter, requireApprovedDriver, updateDriverLocation);
router.post('/rides/:bookingCode/accept', driverAcceptLimiter, requireApprovedDriver, acceptRide);

router.get('/rides', requireDriver, listMyRides);
router.post('/rides/:bookingCode/status', requireDriver, updateRideStatus);

// Verification documents — a signed-in (not-yet-approved) driver can upload,
// view status, and re-upload rejected docs.
router.post('/documents/signed-url', requireDriver, createDocUploadUrl);
router.post('/documents', requireDriver, recordDriverDocument);
router.get('/documents', requireDriver, listMyDocuments);

module.exports = router;
