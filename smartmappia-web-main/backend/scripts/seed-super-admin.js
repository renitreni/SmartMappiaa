// ---------------------------------------------------------------------
// Seed (or repair) the bootstrap SUPER admin account.
//
//   npm run seed:super-admin
//
// Same shape as seed-admins.js, with one extra write: is_super_admin.
// Idempotent — if the auth user already exists its password is reset, so
// this doubles as the recovery path when the password is lost or the
// account has been locked out.
//
// By default the password is random and PRINTED ONCE; record it and have
// the account change it on first login. See SUPER_ADMIN_PASSWORD below to
// set a chosen one instead.
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment, and
// migration 0043 applied (the is_super_admin column has to exist).
//
// SETTING A CHOSEN PASSWORD. Export SUPER_ADMIN_PASSWORD (or put it in
// backend/.env, which is gitignored) and that is used instead of a random
// one. It is read from the environment and NEVER hardcoded here: this file
// is tracked and pushed to GitHub, so a literal password in it would be in
// the history permanently, readable by anyone with repo access, and would
// survive any later change to the live password.
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

const MIN_PASSWORD_LENGTH = 12;

function strongPassword() {
  return crypto.randomBytes(15).toString('base64url'); // ~20 chars, 120 bits
}

// A chosen password if one was supplied, otherwise a generated one. The
// length floor matches the signup rule in lib/validate.js — the account
// with the most privilege on the platform should not be held to less.
function resolvePassword() {
  const chosen = (process.env.SUPER_ADMIN_PASSWORD || '').trim();
  if (!chosen) return { password: strongPassword(), generated: true };
  if (chosen.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SUPER_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return { password: chosen, generated: false };
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
  const { password, generated } = resolvePassword();

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
