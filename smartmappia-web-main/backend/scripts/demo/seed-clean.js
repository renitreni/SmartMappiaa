// DEMO-ONLY — remove ALL demo data in one go.
//   npm run seed:clean
//
// Deletes every booking tagged DEMO_TAG (which cascades to its tracking
// events, proofs, payments, and ledger rows) and the demo driver account
// (which cascades to its profile + location pings). Real bookings, the
// admin account, and any real drivers are left untouched.
const { supabase, DEMO_TAG, DEMO_DRIVER, findUserByEmail } = require('./_demo-lib');

async function run() {
  // 1. Demo bookings (FK ON DELETE CASCADE handles their child rows).
  const { data: removed, error } = await supabase
    .from('bookings')
    .delete()
    .eq('notes', DEMO_TAG)
    .select('booking_code');
  if (error) throw error;
  console.log(`Removed ${removed ? removed.length : 0} demo booking(s).`);

  // 2. The demo driver account (cascades to profile + driver_locations).
  const driver = await findUserByEmail(DEMO_DRIVER.email);
  if (driver) {
    const { error: delErr } = await supabase.auth.admin.deleteUser(driver.id);
    if (delErr) throw delErr;
    console.log(`Removed demo driver ${DEMO_DRIVER.email}.`);
  } else {
    console.log('No demo driver to remove.');
  }

  console.log('\n✅ Demo data cleaned. Real data was left untouched.\n');
}

run().catch((e) => { console.error('seed-clean failed:', e.message || e); process.exit(1); });
