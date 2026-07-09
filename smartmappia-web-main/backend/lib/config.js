// ---------------------------------------------------------------------
// Centralized runtime configuration.
//
// All environment-driven knobs are parsed and defaulted in ONE place so
// controllers never read process.env directly. Keeps behavior consistent
// across local (server.js) and Vercel (api/index.js).
// ---------------------------------------------------------------------

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  // When true, uploading a proof auto-verifies the booking. TESTING ONLY.
  autoVerifyTestMode: toBool(process.env.AUTO_VERIFY_STCPAY_TEST_MODE, false),

  // stcpay_manual | stcpay_manual_test_auto | moyasar | both
  paymentMode: process.env.PAYMENT_MODE || 'stcpay_manual',

  // STC Pay recipient details shown to the passenger (spec §6).
  stcPay: {
    number: process.env.SMART_MAPPIA_STCPAY_NUMBER || '',
    recipientName: process.env.SMART_MAPPIA_STCPAY_NAME || 'Smart Mappia',
  },

  // Supabase Storage bucket holding payment proof images (PRIVATE bucket).
  proofs: {
    bucket: process.env.PAYMENT_PROOF_BUCKET || 'payment-proofs',
    // How long signed upload/download URLs stay valid.
    uploadUrlTtlSeconds: toNumber(process.env.PAYMENT_PROOF_UPLOAD_TTL, 900),
    downloadUrlTtlSeconds: toNumber(process.env.PAYMENT_PROOF_DOWNLOAD_TTL, 3600),
    maxBytes: toNumber(process.env.PAYMENT_PROOF_MAX_BYTES, 10 * 1024 * 1024), // 10 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  },

  // Supabase Storage bucket holding customer-facing merchant images: restaurant
  // logos and menu-item photos (PUBLIC bucket — unlike proofs/docs these must be
  // readable by anyone so <img src> works directly on the storefront). The
  // browser uploads straight to Storage via a short-lived signed upload URL and
  // we persist the resulting PUBLIC url into merchants.logo_url / menu_items.image_url.
  merchantImages: {
    bucket: process.env.MERCHANT_IMAGES_BUCKET || 'merchant-images',
    uploadUrlTtlSeconds: toNumber(process.env.MERCHANT_IMAGES_UPLOAD_TTL, 900),
    maxBytes: toNumber(process.env.MERCHANT_IMAGES_MAX_BYTES, 5 * 1024 * 1024), // 5 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    // logo = restaurant logo/cover, item = a menu item's photo.
    kinds: ['logo', 'item'],
  },

  // Supabase Storage bucket holding driver verification documents (PRIVATE bucket).
  driverDocs: {
    bucket: process.env.DRIVER_DOCS_BUCKET || 'driver-docs',
    uploadUrlTtlSeconds: toNumber(process.env.DRIVER_DOCS_UPLOAD_TTL, 900),
    downloadUrlTtlSeconds: toNumber(process.env.DRIVER_DOCS_DOWNLOAD_TTL, 3600),
    maxBytes: toNumber(process.env.DRIVER_DOCS_MAX_BYTES, 10 * 1024 * 1024), // 10 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    // Full doc vocabulary (must match the driver_doc_type enum in migration 0005).
    allTypes: [
      'national_id', 'license', 'vehicle_registration',
      'insurance', 'tga_permit', 'profile_photo', 'vehicle_photo',
    ],
    // Docs that MUST be 'verified' before a driver is auto-approved.
    // tga_permit is optional; adjust per TGA guidance.
    requiredTypes: [
      'national_id', 'license', 'vehicle_registration',
      'insurance', 'profile_photo', 'vehicle_photo',
    ],
  },

  // Public bucket for restaurant logos (create in Supabase Dashboard as PUBLIC).
  merchantLogos: {
    bucket: process.env.MERCHANT_LOGOS_BUCKET || 'merchant-logos',
    uploadUrlTtlSeconds: toNumber(process.env.MERCHANT_LOGOS_UPLOAD_TTL, 900),
    maxBytes: toNumber(process.env.MERCHANT_LOGOS_MAX_BYTES, 2 * 1024 * 1024), // 2 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },

  // Auth: accounts whose email is listed here automatically become admins
  // on sign-in/sync (comma-separated, case-insensitive).
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Legacy shared-secret auth (kept for reference; routes now use Supabase JWT).
  adminApiKey: process.env.ADMIN_API_KEY || '',
  driverApiKey: process.env.DRIVER_API_KEY || '',

  // Ledger / payout math (spec §12). Rate is a fraction, e.g. 0.20 = 20%.
  ledger: {
    commissionRate: toNumber(process.env.PLATFORM_COMMISSION_RATE, 0.2),
    manualPaymentFee: toNumber(process.env.MANUAL_PAYMENT_FEE, 0),
  },

  // Food Delivery business rules (docs/food-delivery/FOOD_DELIVERY_PRD.md §7).
  // These are HARD rules enforced server-side in lib/foodMoney.js and the
  // merchant accept flow — never trust client-sent money.
  food: {
    minOrderSar: toNumber(process.env.FOOD_MIN_ORDER, 30),
    deliveryFeeSar: toNumber(process.env.FOOD_DELIVERY_FEE, 10), // promo: first 3 months
    radiusKm: toNumber(process.env.FOOD_RADIUS_KM, 15),
    // Per-item platform margin by menu_items.item_type.
    margins: {
      meal_package: toNumber(process.env.FOOD_MARGIN_MEAL, 5),
      drink_dessert_addon: toNumber(process.env.FOOD_MARGIN_DRINK, 3),
    },
    merchantCreditLimit: toNumber(process.env.MERCHANT_CREDIT_LIMIT, 300),
    creditAlertPct: toNumber(process.env.CREDIT_ALERT_PCT, 0.8), // 80% => 240 SAR
  },

  // Grab-style dispatch (shared by Pick & Drop rides and food deliveries):
  // the nearest online driver gets an exclusive offer for offerSeconds; on
  // decline/timeout it cascades to the next. Drivers count as "online" when
  // their last GPS ping is fresher than driverFreshMinutes.
  dispatch: {
    offerSeconds: toNumber(process.env.DISPATCH_OFFER_SECONDS, 30),
    driverFreshMinutes: toNumber(process.env.DISPATCH_DRIVER_FRESH_MINUTES, 3),
    sweepMs: toNumber(process.env.DISPATCH_SWEEP_MS, 5000),
  },

  // Tap Payments (deferred online path — PLACEHOLDER until go-live: keep
  // these unset and every Tap endpoint answers "not configured" while the
  // manual STC Pay path stays the live one).
  tap: {
    secretKey: process.env.TAP_SECRET_KEY || '',
    publicKey: process.env.TAP_PUBLIC_KEY || '',
    webhookSecret: process.env.TAP_WEBHOOK_SECRET || '',
    merchantId: process.env.TAP_MERCHANT_ID || '',
  },
};

module.exports = { config };
