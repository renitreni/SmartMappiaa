const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const {
  getStats,
  getReports,
  listBookings,
  getBookingDetail,
  verifyPayment,
  rejectPayment,
  assignDriver,
  listDrivers,
  setDriverApproval,
  listDriverDocuments,
  reviewDriverDocument,
} = require('../controllers/adminController');

// Every admin route requires an authenticated admin (Supabase JWT, role admin).
router.use(requireAdmin);

router.get('/stats', getStats);
router.get('/reports', getReports);
router.get('/bookings', listBookings);
router.get('/bookings/:bookingCode', getBookingDetail);
router.post('/bookings/:bookingCode/verify-payment', verifyPayment);
router.post('/bookings/:bookingCode/reject-payment', rejectPayment);
router.post('/bookings/:bookingCode/assign-driver', assignDriver);

// Driver approval (verification)
router.get('/drivers', listDrivers);
router.post('/drivers/:driverId/approval', setDriverApproval);
router.get('/drivers/:driverId/documents', listDriverDocuments);
router.post('/drivers/:driverId/documents/:docId/review', reviewDriverDocument);

module.exports = router;
