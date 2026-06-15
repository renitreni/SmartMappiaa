// ---------------------------------------------------------------------
// Seed (or repair) the default admin account.
//
//   npm run seed:admin
//
// Creates a Supabase auth user from ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD
// (defaults admin123@smartmappia.com / admin123) with its email already
// confirmed, then upserts an admin profile. Idempotent — safe to re-run.
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment
// (loaded from .env, same as the server).
// ---------------------------------------------------------------------
require('dotenv').config();
const { supabase } = require('../lib/supabase');

const email = (process.env.ADMIN_SEED_EMAIL || 'admin123@smartmappia.com').toLowerCase();
const password = process.env.ADMIN_SEED_PASSWORD || 'admin123';

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
  // 1. Create the auth user (or reuse the existing one).
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

  // 2. Upsert the admin profile.
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
