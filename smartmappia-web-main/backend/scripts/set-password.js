// ---------------------------------------------------------------------
// Set a chosen password on an EXISTING Supabase auth user. Unlike
// seed-admin(s).js this never creates an account or touches the profile
// row — it only exists for when you want a specific password instead of
// a random generated one.
//
//   npm run set:password -- --email ruth@smartmappia.com --password 'yourChosenPass'
// ---------------------------------------------------------------------
require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { passwordError } = require('../lib/validate');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

async function findUserByEmail(targetEmail) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = (data.users || []).find((u) => (u.email || '').toLowerCase() === targetEmail);
    if (match) return match;
    if (!data.users || data.users.length < 200) break;
  }
  return null;
}

async function run() {
  const email = (arg('email') || '').trim().toLowerCase();
  const password = arg('password') || '';

  if (!email) throw new Error('Usage: --email <address> --password <newPassword>');
  const pwErr = passwordError(password);
  if (pwErr) throw new Error(pwErr);

  const user = await findUserByEmail(email);
  if (!user) throw new Error(`No auth user found for ${email}`);

  const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
  if (error) throw error;

  console.log(`Password updated for ${email}.`);
}

run().catch((err) => {
  console.error('set-password failed:', err.message || err);
  process.exit(1);
});
