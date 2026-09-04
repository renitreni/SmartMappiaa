// ---------------------------------------------------------------------
// Seed (or repair) the bootstrap SUPER admin account.
//
//   npm run seed:super-admin
//
// Same shape as seed-admins.js, with one extra write: is_super_admin.
// Idempotent — if the auth user already exists its password is reset to a
// fresh random value. The password is PRINTED ONCE; record it and have the
// account change it on first login.
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment, and
// migration 0043 applied (the is_super_admin column has to exist).
//
// UNLIKE seed-admins.js, this address should NOT be added to ADMIN_EMAILS.
// It does not need to be — syncProfile keeps any profile that already has
// role 'admin', which this script writes directly — and being on that list
// makes the account impossible to deactivate from the portal later, since
// the escalation guard would then lock it out rather than demote it.
// ---------------------------------------------------------------------
require('dotenv').config();
const crypto = require('crypto');
const { supabase } = require('../lib/supabase');

const SUPER_ADMIN = { email: 'ferdzsabado@smartmappia.com', full_name: 'Ferdz Sabado' };

function strongPassword() {
  return crypto.randomBytes(15).toString('base64url'); // ~20 chars, 120 bits
}

// listUsers is paginated; the address may already exist as any role.
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
  const email = SUPER_ADMIN.email.toLowerCase();
  const password = strongPassword();

  let userId;
  let note;
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) {
    const existing = await findUserByEmail(email);
    if (!existing) throw createErr;
    userId = existing.id;
    // ban_duration 'none' so re-running this also un-deactivates the
    // account — the point of a repair script is to get you back in.
    await supabase.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      ban_duration: 'none',
    });
    note = 'already existed - password reset';
  } else {
    userId = created.user.id;
    note = 'created';
  }

  const { error: profileErr } = await supabase.from('profiles').upsert(
    {
      id: userId,
      role: 'admin',
      email,
      full_name: SUPER_ADMIN.full_name,
      driver_approved: true,
      is_super_admin: true,
      disabled_at: null,
      disabled_by: null,
    },
    { onConflict: 'id' }
  );
  if (profileErr) throw profileErr;

  console.log('\nSuper admin ready. Sign in at /login:\n');
  console.log(`  ${SUPER_ADMIN.full_name} (${note})`);
  console.log(`     email:    ${email}`);
  console.log(`     password: ${password}`);
  console.log('\nChange this password on first login.');
  console.log('Do NOT add this address to ADMIN_EMAILS - see the header of this script.\n');
}

run().catch((err) => {
  console.error('seed-super-admin failed:', err.message || err);
  process.exit(1);
});
