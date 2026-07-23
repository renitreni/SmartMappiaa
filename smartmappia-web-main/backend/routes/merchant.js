const express = require('express');
const router = express.Router();
const { requireMerchant } = require('../middleware/auth');
const { validateBody } = require('../lib/validate');
const merchant = require('../controllers/merchantController');

const BUSINESS_FIELDS = {
  name: { type: 'string', required: true, maxLength: 120 },
  cuisine_type: { type: 'string', maxLength: 60, nullable: true },
  description: { type: 'string', maxLength: 1000, nullable: true },
  logo_url: { type: 'string', maxLength: 500, nullable: true },
  address: { type: 'string', maxLength: 500, nullable: true },
  // Location is mandatory: absent keys are fine on a partial PATCH, but an
  // explicit null (clearing the pin) is rejected. See updateProfile.
  lat: { type: 'number', min: -90, max: 90 },
  lng: { type: 'number', min: -180, max: 180 },
};

const CATEGORY_FIELDS = {
  name: { type: 'string', maxLength: 80 },
  sort_order: { type: 'integer', min: 0, max: 1000 },
  is_active: { type: 'boolean' },
};

const ITEM_FIELDS = {
  category_id: { type: 'string', maxLength: 60, nullable: true },
  name: { type: 'string', maxLength: 120 },
  description: { type: 'string', maxLength: 1000, nullable: true },
  price: { type: 'number', min: 0.01, max: 100000 },
  item_type: { type: 'string', enum: ['meal_package', 'drink_dessert_addon'] },
  image_url: { type: 'string', maxLength: 500, nullable: true },
  is_available: { type: 'boolean' },
  // Drink sizes: validated field-by-field in lib/foodSizes.
  size_options: { type: 'array', itemType: 'object', maxItems: 6, nullable: true },
};

router.use(requireMerchant);

router.get('/profile', merchant.getProfile);
router.patch('/profile', validateBody(BUSINESS_FIELDS), merchant.updateProfile);
router.post(
  '/logo/signed-url',
  validateBody({
    file_name: { type: 'string', required: true, maxLength: 200 },
    mime_type: { type: 'string', required: true, maxLength: 80 },
  }),
  merchant.createLogoUploadUrl
);
router.post(
  '/logo/confirm',
  validateBody({
    path: { type: 'string', required: true, maxLength: 300 },
    size_bytes: { type: 'integer', min: 1, max: 10 * 1024 * 1024, nullable: true },
  }),
  merchant.confirmLogoUpload
);
router.post(
  '/menu/items/image/signed-url',
  validateBody({
    file_name: { type: 'string', required: true, maxLength: 200 },
    mime_type: { type: 'string', required: true, maxLength: 80 },
  }),
  merchant.createMenuItemImageUploadUrl
);
router.post(
  '/menu/items/image/confirm',
  validateBody({
    path: { type: 'string', required: true, maxLength: 300 },
    size_bytes: { type: 'integer', min: 1, max: 10 * 1024 * 1024, nullable: true },
  }),
  merchant.confirmMenuItemImageUpload
);
router.get('/analytics', merchant.getAnalytics);

router.get('/menu', merchant.getMenu);
router.post(
  '/menu/categories',
  validateBody({ ...CATEGORY_FIELDS, name: { ...CATEGORY_FIELDS.name, required: true } }),
  merchant.addCategory
);
router.patch('/menu/categories/:id', validateBody(CATEGORY_FIELDS), merchant.updateCategory);
router.delete('/menu/categories/:id', merchant.deleteCategory);

router.post(
  '/menu/items',
  validateBody({
    ...ITEM_FIELDS,
    name: { ...ITEM_FIELDS.name, required: true },
    price: { ...ITEM_FIELDS.price, required: true },
    item_type: { ...ITEM_FIELDS.item_type, required: true },
  }),
  merchant.addItem
);
router.patch('/menu/items/:id', validateBody(ITEM_FIELDS), merchant.updateItem);
router.delete('/menu/items/:id', merchant.deleteItem);

module.exports = router;
