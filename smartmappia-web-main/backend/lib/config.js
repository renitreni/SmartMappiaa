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

  // Supabase Storage bucket holding driver verification documents (PRIVATE bucket).
  driverDocs: {
    bucket: process.env.DRIVER_DOCS_BUCKET || 'driver-docs',
    uploadUrlTtlSeconds: toNumber(process.env.DRIVER_DOCS_UPLOAD_TTL, 900),
    downloadUrlTtlSeconds: toNumber(process.env.DRIVER_DOCS_DOWNLOAD_TTL, 3600),
    maxBytes: toNumber(process.env.DRIVER_DOCS_MAX_BYTES, 10 * 1024 * 1024), // 10 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
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
};

module.exports = { config };
