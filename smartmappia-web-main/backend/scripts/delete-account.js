// ---------------------------------------------------------------------
// Remove an account, auth user and profile together.
//
//   node scripts/delete-account.js someone@example.com            # report only
//   node scripts/delete-account.js someone@example.com --confirm  # act
//
// Written for retiring the admin123 seed account before launch, but it is
// not specific to it.
//
// TWO HALVES, AND ONLY DOING ONE IS WORSE THAN USELESS. The admin role is
// granted at sign-in from the ADMIN_EMAILS allow-list, BUT syncProfile also
// keeps 'admin' for any profile row that already says admin
// (controllers/authController.js). So taking the address out of
// ADMIN_EMAILS on its own leaves a fully working admin behind. Do both:
//
//   1. remove the address from ADMIN_EMAILS in backend/.env (grep it first,
//      never blind-sed a comma-separated list), then pm2 restart
//   2. run this
//
// FAILS CLOSED ON REAL DATA. If the profile row is referenced by bookings,
// orders or audit rows, the delete is refused rather than cascaded — losing
// an order to tidy up an account is not a trade worth making silently. The
// script then tells you to demote and rotate instead, which removes the
// access without touching history.
// ---------------------------------------------------------------------
require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { config } = require('../lib/config');

const email = String(process.argv[2] || '').trim().toLowerCase();
const confirmed = process.argv.includes('--confirm');

if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/delete-account.js <email> [--confirm]');
  process.exit(1);
}

// listUsers is paginated; there is no getUserByEmail in the admin API.
async function findUserByEmail(target) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = (data.users || []).find((u) => (u.email || '').toLowerCase() === target);
    if (match) return match;
    if (!data.users || data.users.length < 200) break;
  }
  return null;
}

async function countRefs(userId) {
  const counts = {};
  const probes = [
    ['bookings', 'user_id'],
    ['orders', 'customer_id'],
    ['shop_orders', 'customer_id'],
    ['audit_log', 'actor_id'],
    ['driver_cash_ledger', 'driver_id'],
  ];
  for (const [table, column] of probes) {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq(column, userId);
    // A table that does not exist in this project is not an error worth
    // stopping for — report it as unknown rather than pretending it is 0.
    counts[table] = error ? 'unknown' : count || 0;
  }
  return counts;
}

async function run() {
  const user = await findUserByEmail(email);
  if (!user) {
    console.log(`No auth user found for ${email}. Nothing to do.`);
    return;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, full_name, created_at')
    .eq('id', user.id)
    .maybeSingle();

  const refs = await countRefs(user.id);
  const blocking = Object.entries(refs).filter(([, n]) => n !== 'unknown' && n > 0);

  console.log('\nACCOUNT');
  console.log(`  email      ${email}`);
  console.log(`  user id    ${user.id}`);
  console.log(`  role       ${profile ? profile.role : '(no profile row)'}`);
  console.log(`  created    ${user.created_at}`);
  console.log(`  last sign  ${user.last_sign_in_at || 'never'}`);
  console.log('\nREFERENCES');
  for (const [table, n] of Object.entries(refs)) console.log(`  ${table.padEnd(20)} ${n}`);

  const stillListed = config.adminEmails.includes(email);
  if (stillListed) {
    console.log(
      '\n!! This address is STILL in ADMIN_EMAILS. Remove it from backend/.env and\n' +
        '   restart the API, or the account can be recreated with admin rights.'
    );
  }

  if (blocking.length) {
    console.log('\nREFUSING TO DELETE — this account owns real data:');
    for (const [table, n] of blocking) console.log(`  ${table}: ${n} row(s)`);
    console.log(
      '\nDeleting it would cascade through that history. Do this instead:\n' +
        '  1. remove the address from ADMIN_EMAILS in backend/.env\n' +
        "  2. update profiles set role = 'passenger' where id = '" + user.id + "';\n" +
        '  3. rotate the password to something long and random, or ban the user\n' +
        '     in Supabase Auth so it cannot sign in at all.\n' +
        'That removes the access and keeps the history intact.'
    );
    process.exitCode = 2;
    return;
  }

  if (!confirmed) {
    console.log('\nDRY RUN. Nothing was changed. Re-run with --confirm to delete.');
    return;
  }

  // Profile first: deleting the auth user may cascade it anyway, but doing
  // it explicitly means a failure here stops before the irreversible half.
  const { error: profileErr } = await supabase.from('profiles').delete().eq('id', user.id);
  if (profileErr) {
    console.error(`\nCould not delete the profile row: ${profileErr.message}`);
    process.exitCode = 1;
    return;
  }

  const { error: authErr } = await supabase.auth.admin.deleteUser(user.id);
  if (authErr) {
    console.error(
      `\nProfile deleted, but the auth user could not be: ${authErr.message}\n` +
        'Delete it by hand in Supabase Dashboard -> Authentication -> Users.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nDeleted ${email} (${user.id}).`);
  console.log('Confirm it is gone: try signing in as that address — it must fail.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
