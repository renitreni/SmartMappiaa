// ---------------------------------------------------------------------
// Seed (or repair) the named admin accounts: Ruth and Nawaf.
//
//   npm run seed:admins
//
// Mirrors seed-admin.js but for a LIST of admins. For each entry it creates a
// Supabase auth user (email already confirmed) with a STRONG RANDOM password,
// then upserts an admin profile. Idempotent — if the user already exists the
// password is reset to a fresh random value. The generated passwords are PRINTED
// ONCE at the end; record them and have each admin change theirs on first login.
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment
// (loaded from .env, same as the server).
//
// Reminder: also add these emails to ADMIN_EMAILS in .env so the auto-admin
// sync rule keeps them admin (the profile row already carries role:'admin',
// which syncProfile preserves — this is belt-and-suspenders).
// ---------------------------------------------------------------------
require('dotenv').config();
const crypto = require('crypto');
const { supabase } = require('../lib/supabase');

// The admins to provision. Passwords are generated at runtime (never hardcoded).
const ADMINS = [
  { email: 'ruth@smartmappia.com', full_name: 'Ruth' },
  { email: 'nawaf@smartmappia.com', full_name: 'Nawaf' },
];

// A strong, human-typeable temporary password (base64url, no ambiguous padding).
function strongPassword() {
  return crypto.randomBytes(15).toString('base64url'); // ~20 chars, 120 bits
}

// Find an existing auth user by email (listUsers is paginated).
async function findUserByEmail(targetEmail) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = (data.users || []).find((u) => (u.email || '').toLowerCase() === targetEmail);
    if (match) return match;
    if (!data.users || data.users.length < 200) break; // last page
  }
  return null;
}

async function seedOne({ email, full_name }) {
  const lcEmail = email.toLowerCase();
  const password = strongPassword();

  // 1. Create the auth user (or reuse the existing one + reset the password).
  let userId;
  let note;
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: lcEmail,
    password,
    email_confirm: true,
  });
  if (createErr) {
    const existing = await findUserByEmail(lcEmail);
    if (!existing) throw createErr;
    userId = existing.id;
    await supabase.auth.admin.updateUserById(userId, { password, email_confirm: true });
    note = 'already existed — password reset';
  } else {
    userId = created.user.id;
    note = 'created';
  }

  // 2. Upsert the admin profile.
  const { error: profileErr } = await supabase
    .from('profiles')
    .upsert(
      { id: userId, role: 'admin', email: lcEmail, full_name, driver_approved: true },
      { onConflict: 'id' }
    );
  if (profileErr) throw profileErr;

  return { email: lcEmail, full_name, password, note };
}

async function run() {
  const results = [];
  for (const admin of ADMINS) {
    results.push(await seedOne(admin));
  }

  console.log('\n✅ Admin accounts ready. Sign in at /login:\n');
  for (const r of results) {
    console.log(`  ${r.full_name} (${r.note})`);
    console.log(`     email:    ${r.email}`);
    console.log(`     password: ${r.password}`);
    console.log('');
  }
  console.log('Give each admin their password privately and have them CHANGE IT on first login.');
  console.log('Make sure these emails are also in ADMIN_EMAILS in backend/.env.\n');
}

run().catch((err) => {
  console.error('seed-admins failed:', err.message || err);
  process.exit(1);
});
