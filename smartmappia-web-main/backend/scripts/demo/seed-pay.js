// DEMO-ONLY — an unpaid booking, for the payment screen.
//   npm run seed:pay  ->  open the printed /pay/<code> URL
const { supabase, frontendBase, demoBooking } = require('./_demo-lib');

async function run() {
  // No status overrides -> falls back to the "awaiting payment" defaults.
  const { data, error } = await supabase
    .from('bookings')
    .insert(demoBooking())
    .select('booking_code')
    .single();
  if (error) throw error;

  console.log('\n✅ Unpaid demo booking');
  console.log(`   Payment URL : ${frontendBase()}/pay/${data.booking_code}\n`);
}

run().catch((e) => { console.error('seed-pay failed:', e.message || e); process.exit(1); });
