// ---------------------------------------------------------------------
// Apply size and MIME limits to the Storage buckets.
//
// WHY THIS IS A SCRIPT, NOT A BOOT STEP: bucket limits are a ceiling on
// what customers can upload. Moving one should be a deliberate act with a
// person watching, not something a process restart does silently.
//
// WHY IT EXISTS AT ALL: payment-proofs, driver-docs and merchant-images
// were created by hand in the Supabase dashboard with NO fileSizeLimit.
// The browser uploads straight to Storage through a signed URL — nothing
// passes through this server — so the bucket's own limit is the only
// enforcement point that exists. Without it a single upload can be any
// size the client feels like, and storage fills long before any other
// ceiling does. When storage is full, uploads FAIL: that is an outage for
// KYC and for payment proof, not a slow degradation.
//
// The numbers come from lib/config.js, which the upload endpoints already
// validate against — so this makes the server-side check and the bucket
// agree instead of introducing a second opinion.
//
//   node scripts/setup-buckets.js
//
// Idempotent. Safe to re-run, and safe to run against production.
// ---------------------------------------------------------------------
require('dotenv').config();

const { config } = require('../lib/config');
const { ensureBucket } = require('../lib/storage');

const BUCKETS = [
  // PRIVATE. Payment screenshots, read by admins through signed URLs.
  { name: config.proofs.bucket, isPublic: false, spec: config.proofs },
  // PRIVATE. KYC documents — licences, IDs, registrations.
  { name: config.driverDocs.bucket, isPublic: false, spec: config.driverDocs },
  // PUBLIC. Logos and menu photos, served straight into <img src>.
  { name: config.merchantImages.bucket, isPublic: true, spec: config.merchantImages },
  // PUBLIC. Created lazily by the backend already; included so one run
  // leaves every bucket in a known state.
  { name: config.avatars.bucket, isPublic: true, spec: config.avatars },
];

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

async function main() {
  let failed = 0;

  for (const { name, isPublic, spec } of BUCKETS) {
    try {
      const result = await ensureBucket(name, {
        isPublic,
        maxBytes: spec.maxBytes,
        allowedMimeTypes: spec.allowedMimeTypes,
      });
      console.log(
        `[ok] ${name.padEnd(18)} ${result.action.padEnd(8)} ` +
          `limit ${mb(spec.maxBytes).padStart(6)}  ` +
          `${isPublic ? 'public ' : 'private'}  ${spec.allowedMimeTypes.join(', ')}`
      );
    } catch (err) {
      failed += 1;
      console.error(`[FAIL] ${name}: ${err.message}`);
    }
  }

  if (failed) {
    console.error(`\n${failed} bucket(s) could not be configured.`);
    process.exit(1);
  }
  console.log('\nAll buckets configured. Verify in the Supabase dashboard under Storage.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
