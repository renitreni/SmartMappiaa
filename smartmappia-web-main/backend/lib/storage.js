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

// Create a signed upload URL the client uses to PUT the file directly.
// Returns { path, token, signedUrl } or throws on Supabase error.
async function createProofUploadUrl(path) {
  const { data, error } = await supabase.storage
    .from(config.proofs.bucket)
    .createSignedUploadUrl(path);

  if (error) throw error;
  return { path, token: data.token, signedUrl: data.signedUrl };
}

// Create a signed download URL (admin review). Returns the URL string.
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

module.exports = {
  buildProofPath,
  createProofUploadUrl,
  createProofDownloadUrl,
  buildDriverDocPath,
  createDriverDocUploadUrl,
  createDriverDocDownloadUrl,
};
