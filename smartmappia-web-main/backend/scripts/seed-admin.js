// ---------------------------------------------------------------------
// Seed (or repair) the default admin account.
//
//   npm run seed:admin
//
// Creates a Supabase auth user from ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD
// with its email already confirmed, then upserts an admin profile.
// Idempotent — safe to re-run.
//
// BOTH VARIABLES ARE REQUIRED and there are no defaults; see below.
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment
// (loaded from .env, same as the server).
// ---------------------------------------------------------------------
require('dotenv').config();
const { supabase } = require('../lib/supabase');

// NO DEFAULTS ANY MORE. This script used to default to
// admin123@smartmappia.com / admin123 -- an eight-character password on a
// full-privilege account, which is exactly the credential that had to be
// deleted before launch. Leaving the default in place meant anyone running
// `npm run seed:accounts` on the box would put it straight back.
const email = String(process.env.ADMIN_SEED_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_SEED_PASSWORD || '';
const MIN_PASSWORD = 12;

if (!email || !email.includes('@')) {
  console.error(
    'ADMIN_SEED_EMAIL is required. Run it explicitly, e.g.\n' +
      '  ADMIN_SEED_EMAIL=you@example.com ADMIN_SEED_PASSWORD=<long random> npm run seed:admin'
  );
  process.exit(1);
}
if (password.length < MIN_PASSWORD) {
  console.error(
    `ADMIN_SEED_PASSWORD must be at least ${MIN_PASSWORD} characters. ` +
      'This account has full financial control -- generate one rather than choosing it.'
  );
  process.exit(1);
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

async function run() {
  // Create the auth user (or reuse the existing one).
  let userId;
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    // Most likely "already registered" — find it and reset the password.
    const existing = await findUserByEmail(email);
    if (!existing) throw createErr;
    userId = existing.id;
    await supabase.auth.admin.updateUserById(userId, { password, email_confirm: true });
    console.log(`Admin user already existed — password reset. (${email})`);
  } else {
    userId = created.user.id;
    console.log(`Created admin auth user. (${email})`);
  }

  const { error: profileErr } = await supabase
    .from('profiles')
    .upsert(
      { id: userId, role: 'admin', email, full_name: 'Administrator', driver_approved: true },
      { onConflict: 'id' }
    );
  if (profileErr) throw profileErr;

  console.log('\n✅ Admin ready. Sign in at /login with:');
  console.log(`     email:    ${email}`);
  console.log(`     password: ${password}`);
  console.log('\n(Make sure this email is also in ADMIN_EMAILS.)');
}

run().catch((err) => {
  console.error('seed-admin failed:', err.message || err);
  process.exit(1);
});
