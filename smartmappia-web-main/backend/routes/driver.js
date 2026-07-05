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
const {
  listOffers,
  acceptOffer,
  declineOffer,
  listMyDeliveries,
  listOpenDeliveries,
  claimOpenDelivery,
  createDeliveryPhotoUrl,
  updateDeliveryStatus,
} = require('../controllers/driverDispatchController');
const { validateBody } = require('../lib/validate');

// Seeing the open feed, accepting, and broadcasting location all require an
// APPROVED driver. Viewing/advancing already-assigned rides only needs a
// signed-in driver.
router.get('/available', requireApprovedDriver, listAvailableRides);
router.post('/location', locationLimiter, requireApprovedDriver, updateDriverLocation);
router.post('/rides/:bookingCode/accept', driverAcceptLimiter, requireApprovedDriver, acceptRide);

router.get('/rides', requireDriver, listMyRides);
router.post('/rides/:bookingCode/status', requireDriver, updateRideStatus);

// --- Grab-style dispatch: exclusive 30s offers, then the open pool ---
router.get('/offers', requireApprovedDriver, listOffers);
router.post('/offers/:id/accept', driverAcceptLimiter, requireApprovedDriver, acceptOffer);
router.post('/offers/:id/decline', driverAcceptLimiter, requireApprovedDriver, declineOffer);

// --- Food deliveries (rider leg) ---
router.get('/deliveries', requireDriver, listMyDeliveries);
router.get('/deliveries/available', requireApprovedDriver, listOpenDeliveries);
router.post('/deliveries/:code/claim', driverAcceptLimiter, requireApprovedDriver, claimOpenDelivery);
// Mandatory photo proof: signed upload URL, then the status change carries
// the uploaded path (rejected without it).
router.post(
  '/deliveries/:code/photo-url',
  requireDriver,
  validateBody({
    kind: { type: 'string', required: true, enum: ['pickup', 'delivery'] },
    file_name: { type: 'string', maxLength: 255 },
    mime_type: { type: 'string', required: true, maxLength: 100 },
  }),
  createDeliveryPhotoUrl
);
router.post(
  '/deliveries/:code/status',
  requireDriver,
  validateBody({
    status: { type: 'string', required: true, enum: ['picked_up', 'delivered'] },
    photo_path: { type: 'string', required: true, maxLength: 400 },
  }),
  updateDeliveryStatus
);

// Verification documents — a signed-in (not-yet-approved) driver can upload,
// view status, and re-upload rejected docs.
router.post('/documents/signed-url', requireDriver, createDocUploadUrl);
router.post('/documents', requireDriver, recordDriverDocument);
router.get('/documents', requireDriver, listMyDocuments);

module.exports = router;
