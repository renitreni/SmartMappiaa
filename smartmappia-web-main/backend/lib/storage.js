// ---------------------------------------------------------------------
// Supabase Storage helpers for payment proofs.
//
// Files NEVER pass through this server. The browser uploads straight to
// Supabase Storage using a short-lived signed upload URL, then tells us
// the path. Admins later read proofs through short-lived signed download
// URLs. The bucket itself is PRIVATE (see README setup step).
// ---------------------------------------------------------------------
const crypto = require('crypto');
const { supabase } = require('./supabase');
const { config } = require('./config');

// Build a unique, non-guessable object path for a booking's proof.
//   payment-proofs/SM-7K3PQ9TM/1718352000000-3f9a2c.jpg
function buildProofPath(bookingCode, originalName) {
  const safeCode = String(bookingCode).replace(/[^A-Za-z0-9-]/g, '');
  const ext = (originalName && originalName.includes('.'))
    ? originalName.slice(originalName.lastIndexOf('.')).toLowerCase().replace(/[^.a-z0-9]/g, '')
    : '';
  const rand = crypto.randomBytes(4).toString('hex');
  return `${safeCode}/${Date.now()}-${rand}${ext}`;
}

// The client PUTs the file directly to Supabase Storage with this.
async function createProofUploadUrl(path) {
  const { data, error } = await supabase.storage
    .from(config.proofs.bucket)
    .createSignedUploadUrl(path);

  if (error) throw error;
  return { path, token: data.token, signedUrl: data.signedUrl };
}

// Signed download URL for admin review.
async function createProofDownloadUrl(path) {
  const { data, error } = await supabase.storage
    .from(config.proofs.bucket)
    .createSignedUrl(path, config.proofs.downloadUrlTtlSeconds);

  if (error) throw error;
  return data.signedUrl;
}

// --- Driver verification documents (same pattern, PRIVATE `driver-docs` bucket) ---

// Build a unique, non-guessable object path for a driver's document.
//   driver-docs/<driverId>/license-1718352000000-3f9a2c.jpg
function buildDriverDocPath(driverId, docType, originalName) {
  const safeId = String(driverId).replace(/[^A-Za-z0-9-]/g, '');
  const safeType = String(docType).replace(/[^a-z_]/g, '');
  const ext = (originalName && originalName.includes('.'))
    ? originalName.slice(originalName.lastIndexOf('.')).toLowerCase().replace(/[^.a-z0-9]/g, '')
    : '';
  const rand = crypto.randomBytes(4).toString('hex');
  return `${safeId}/${safeType}-${Date.now()}-${rand}${ext}`;
}

async function createDriverDocUploadUrl(path) {
  const { data, error } = await supabase.storage
    .from(config.driverDocs.bucket)
    .createSignedUploadUrl(path);

  if (error) throw error;
  return { path, token: data.token, signedUrl: data.signedUrl };
}

async function createDriverDocDownloadUrl(path) {
  const { data, error } = await supabase.storage
    .from(config.driverDocs.bucket)
    .createSignedUrl(path, config.driverDocs.downloadUrlTtlSeconds);

  if (error) throw error;
  return data.signedUrl;
}

// --- Merchant images (restaurant logos + menu photos, PUBLIC `merchant-images` bucket) ---
//
// Same signed-upload pattern as proofs/docs, but the bucket is PUBLIC: instead
// of issuing signed download URLs we hand back a stable public URL that is
// stored directly in merchants.logo_url / menu_items.image_url and served to
// customers via a plain <img src>.

// Build a unique object path for a merchant image.
//   merchant-images/<merchantId>/logo-1718352000000-3f9a2c.jpg
//   merchant-images/<merchantId>/item-1718352000000-3f9a2c.png
function buildMerchantImagePath(merchantId, kind, originalName) {
  const safeId = String(merchantId).replace(/[^A-Za-z0-9-]/g, '');
  const safeKind = String(kind).replace(/[^a-z]/g, '') || 'img';
  const ext = (originalName && originalName.includes('.'))
    ? originalName.slice(originalName.lastIndexOf('.')).toLowerCase().replace(/[^.a-z0-9]/g, '')
    : '';
  const rand = crypto.randomBytes(4).toString('hex');
  return `${safeId}/${safeKind}-${Date.now()}-${rand}${ext}`;
}

function buildMerchantLogoPath(merchantId, originalName) {
  return buildMerchantImagePath(merchantId, 'logo', originalName);
}

function buildMenuItemImagePath(merchantId, originalName) {
  return buildMerchantImagePath(merchantId, 'item', originalName);
}

async function createMerchantImageUploadUrl(path) {
  const { data, error } = await supabase.storage
    .from(config.merchantImages.bucket)
    .createSignedUploadUrl(path);

  if (error) throw error;
  return { path, token: data.token, signedUrl: data.signedUrl };
}

// Bucket is public, so this is a stable URL, not a signed one.
function merchantImagePublicUrl(path) {
  const { data } = supabase.storage.from(config.merchantImages.bucket).getPublicUrl(path);
  return data.publicUrl;
}

// --- User avatars (profile pictures, PUBLIC `avatars` bucket) ---------------
//
// Same signed-upload pattern as merchant images. The bucket is created
// lazily on first use so no manual Supabase setup step is needed.

let avatarBucketReady = false;
async function ensureAvatarBucket() {
  if (avatarBucketReady) return;
  const { error } = await supabase.storage.createBucket(config.avatars.bucket, {
    public: true,
    fileSizeLimit: config.avatars.maxBytes,
    allowedMimeTypes: config.avatars.allowedMimeTypes,
  });
  // "already exists" is fine — anything else propagates.
  if (error && !/already exists/i.test(error.message || '')) throw error;
  avatarBucketReady = true;
}

// avatars/<userId>/avatar-1718352000000-3f9a2c.jpg
function buildAvatarPath(userId, originalName) {
  const safeId = String(userId).replace(/[^A-Za-z0-9-]/g, '');
  const ext = (originalName && originalName.includes('.'))
    ? originalName.slice(originalName.lastIndexOf('.')).toLowerCase().replace(/[^.a-z0-9]/g, '')
    : '';
  const rand = crypto.randomBytes(4).toString('hex');
  return `${safeId}/avatar-${Date.now()}-${rand}${ext}`;
}

async function createAvatarUploadUrl(path) {
  await ensureAvatarBucket();
  const { data, error } = await supabase.storage
    .from(config.avatars.bucket)
    .createSignedUploadUrl(path);
  if (error) throw error;
  return { path, token: data.token, signedUrl: data.signedUrl };
}

function avatarPublicUrl(path) {
  const { data } = supabase.storage.from(config.avatars.bucket).getPublicUrl(path);
  return data.publicUrl;
}

module.exports = {
  buildProofPath,
  createProofUploadUrl,
  createProofDownloadUrl,
  buildAvatarPath,
  createAvatarUploadUrl,
  avatarPublicUrl,
  buildDriverDocPath,
  createDriverDocUploadUrl,
  createDriverDocDownloadUrl,
  buildMerchantImagePath,
  buildMerchantLogoPath,
  buildMenuItemImagePath,
  createMerchantImageUploadUrl,
  merchantImagePublicUrl,
  // Aliases used by the merchant portal controller (merchantController.js).
  createMerchantMediaUploadUrl: createMerchantImageUploadUrl,
  getMerchantMediaPublicUrl: merchantImagePublicUrl,
};
