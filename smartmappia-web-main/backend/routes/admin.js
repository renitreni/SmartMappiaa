const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { validateBody } = require('../lib/validate');
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
const food = require('../controllers/food/adminFoodController');

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

// --- Food Delivery oversight (PRD: merchant credit + reconciliation) ---
// Restaurants are onboarded by ADMINS: they contact SmartMappia, an admin
// creates the restaurant, imports the menu/prices/photos, links the owner's
// account, and finally lists it (is_active = true).
const ADMIN_MERCHANT_FIELDS = {
  name: { type: 'string', maxLength: 120 },
  cuisine_type: { type: 'string', maxLength: 60, nullable: true },
  description: { type: 'string', maxLength: 1000, nullable: true },
  logo_url: { type: 'string', maxLength: 500, nullable: true },
  address: { type: 'string', maxLength: 500, nullable: true },
  lat: { type: 'number', min: -90, max: 90, nullable: true },
  lng: { type: 'number', min: -180, max: 180, nullable: true },
  is_active: { type: 'boolean' }, // listing on/off (vetting gate)
  is_featured: { type: 'boolean' }, // leads the public homepage grid
  badge: { type: 'string', enum: ['top_rated', 'popular', 'new', 'trending'], nullable: true },
};
const ADMIN_ITEM_FIELDS = {
  category_id: { type: 'string', maxLength: 60, nullable: true },
  name: { type: 'string', maxLength: 120 },
  description: { type: 'string', maxLength: 1000, nullable: true },
  price: { type: 'number', min: 0.01, max: 100000 },
  item_type: { type: 'string', enum: ['meal_package', 'drink_dessert_addon'] },
  image_url: { type: 'string', maxLength: 500, nullable: true },
  is_available: { type: 'boolean' },
};
const ADMIN_CATEGORY_FIELDS = {
  name: { type: 'string', maxLength: 80 },
  sort_order: { type: 'integer', min: 0, max: 1000 },
  is_active: { type: 'boolean' },
};

router.get('/food/overview', food.getOverview);
router.get('/food/merchants', food.listMerchants);
router.post(
  '/food/merchants',
  validateBody({ ...ADMIN_MERCHANT_FIELDS, name: { ...ADMIN_MERCHANT_FIELDS.name, required: true } }),
  food.createMerchant
);
router.patch('/food/merchants/:id', validateBody(ADMIN_MERCHANT_FIELDS), food.updateMerchant);
router.delete('/food/merchants/:id', food.deleteMerchant);
router.post(
  '/food/merchants/:id/suspend',
  validateBody({ reason: { type: 'string', maxLength: 300, nullable: true } }),
  food.suspendMerchant
);
router.post('/food/merchants/:id/reactivate', food.reactivateMerchant);
router.post(
  '/food/merchants/:id/credit',
  validateBody({
    amount: { type: 'number', required: true, min: 0.01, max: 100000 },
    note: { type: 'string', maxLength: 300, nullable: true },
  }),
  food.replenishCredit
);
// Image upload (logo / menu photo): issue a signed upload URL for the PUBLIC
// merchant-images bucket. The frontend uploads then saves the returned public
// URL via the normal merchant/item update endpoints.
router.post(
  '/food/merchants/:id/image/signed-url',
  validateBody({
    kind: { type: 'string', required: true, enum: ['logo', 'item'] },
    file_name: { type: 'string', required: true, maxLength: 300 },
    mime_type: { type: 'string', maxLength: 100, nullable: true },
  }),
  food.createMerchantImageUploadUrl
);
// Owner account provisioning (contract-signing step): create/reuse + link the
// owner's account and grant it the merchant role.
router.post(
  '/food/merchants/:id/owner',
  validateBody({
    email: { type: 'string', required: true, maxLength: 200 },
    full_name: { type: 'string', maxLength: 120, nullable: true },
    phone: { type: 'string', maxLength: 40, nullable: true },
  }),
  food.setMerchantOwner
);
// Menu import + moderation (any restaurant)
router.get('/food/merchants/:id/menu', food.getMerchantMenu);
router.post(
  '/food/merchants/:id/menu/categories',
  validateBody({ ...ADMIN_CATEGORY_FIELDS, name: { ...ADMIN_CATEGORY_FIELDS.name, required: true } }),
  food.addCategoryForMerchant
);
router.patch('/food/categories/:id', validateBody(ADMIN_CATEGORY_FIELDS), food.updateAnyCategory);
router.delete('/food/categories/:id', food.deleteAnyCategory);
router.post(
  '/food/merchants/:id/menu/items',
  validateBody({
    ...ADMIN_ITEM_FIELDS,
    name: { ...ADMIN_ITEM_FIELDS.name, required: true },
    price: { ...ADMIN_ITEM_FIELDS.price, required: true },
    item_type: { ...ADMIN_ITEM_FIELDS.item_type, required: true },
  }),
  food.addItemForMerchant
);
router.patch('/food/items/:id', validateBody(ADMIN_ITEM_FIELDS), food.moderateItem);
router.delete('/food/items/:id', food.removeItem);
// Orders: admins run the restaurants (no owner accounts), so accept/reject
// and the fulfillment ladder live here. Accept enforces the 300 SAR credit.
router.get('/food/orders', food.listOrders);
router.post('/food/orders/:code/accept', food.acceptOrder);
router.post(
  '/food/orders/:code/reject',
  validateBody({ reason: { type: 'string', maxLength: 300, nullable: true } }),
  food.rejectOrder
);
router.patch(
  '/food/orders/:code/status',
  validateBody({
    status: {
      type: 'string',
      required: true,
      enum: ['preparing', 'ready', 'out_for_delivery', 'delivered'],
    },
  }),
  food.advanceOrderStatus
);
// STC Pay reconciliation
router.post('/food/orders/:code/verify-payment', food.verifyPayment);
router.post(
  '/food/orders/:code/assign-driver',
  validateBody({ driver_id: { type: 'string', required: true, maxLength: 60 } }),
  food.assignDriver
);
router.post(
  '/food/orders/:code/reject-payment',
  validateBody({ reason: { type: 'string', maxLength: 300, nullable: true } }),
  food.rejectPayment
);
// Support: cancel an order; if it was paid, mark the refund done once the
// money is returned (policy: within a few hours up to one day).
router.post(
  '/food/orders/:code/cancel',
  validateBody({ reason: { type: 'string', maxLength: 300, nullable: true } }),
  food.cancelOrder
);
router.post('/food/orders/:code/refund', food.refundPayment);
// Rider proof photos (mandatory pickup + delivery shots) — signed URLs.
router.get('/food/orders/:code/photos', food.getOrderPhotos);

module.exports = router;
