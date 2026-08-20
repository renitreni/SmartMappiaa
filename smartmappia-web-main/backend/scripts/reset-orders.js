// ---------------------------------------------------------------------
// Clear food and shop orders before launch.
//
//   node scripts/reset-orders.js            # report only, changes nothing
//   node scripts/reset-orders.js --confirm  # do it
//
// WHAT IT TOUCHES
//   orders, shop_orders          -> deleted, with their children (items,
//                                   payments, deliveries, dispatch offers)
//                                   via the on-delete-cascade already in
//                                   the schema.
//   merchants.credit_used        -> zeroed, and merchant_credit_ledger
//                                   cleared. The credit subsystem is
//                                   vestigial: markup is inside the list
//                                   price and collected once at checkout,
//                                   so a leftover balance is a number that
//                                   can only ever decay and confuses
//                                   whoever reads it.
//
// WHAT IT DOES NOT TOUCH
//   bookings (Pick & Drop rides), drivers, merchants themselves, menus,
//   products, and every account. Deliberate: this is a transaction reset,
//   not a factory reset.
//
// STOCK IS RESTORED FIRST. A shop order still holding a reservation has
// already had the units subtracted from the catalogue. Deleting the order
// row would strand them -- the catalogue would read short by exactly the
// amount of every unfulfilled order, forever, with nothing left to explain
// it. shop_release_stock is idempotent, so a re-run is harmless.
//
// DRIVER BALANCES ARE REPORTED, NOT CLEARED. profiles.cash_owed references
// these orders only through a text note, no foreign key, so a balance
// survives the delete and leaves a rider owing money for an order that no
// longer exists. That is a decision, not a cleanup, so this prints it and
// stops there.
// ---------------------------------------------------------------------
require('dotenv').config();
const { supabase } = require('../lib/supabase');

const confirmed = process.argv.includes('--confirm');

async function countOf(table) {
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
  return error ? `error: ${error.message}` : count || 0;
}

// Delete every row without naming ids: `neq` on a column that is never null
// is the PostgREST idiom for "all", since a bare delete is refused.
async function deleteAll(table) {
  const { error } = await supabase
    .from(table)
    .delete()
    .not('id', 'is', null);
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function run() {
  console.log('BEFORE');
  const before = {};
  for (const t of ['orders', 'shop_orders', 'bookings', 'merchant_credit_ledger']) {
    before[t] = await countOf(t);
    console.log(`  ${t.padEnd(24)} ${before[t]}`);
  }

  const { data: heldStock } = await supabase
    .from('shop_orders')
    .select('id, order_code')
    .not('stock_reserved_at', 'is', null)
    .is('stock_released_at', null);

  const { data: credits } = await supabase
    .from('merchants')
    .select('id, name, credit_used')
    .gt('credit_used', 0);

  const { data: owing } = await supabase
    .from('profiles')
    .select('id, full_name, cash_owed')
    .gt('cash_owed', 0);

  console.log('\nSHOP ORDERS STILL HOLDING STOCK');
  if (!heldStock || !heldStock.length) console.log('  none');
  else heldStock.forEach((o) => console.log(`  ${o.order_code}`));

  console.log('\nMERCHANT CREDIT TO ZERO');
  if (!credits || !credits.length) console.log('  none');
  else credits.forEach((m) => console.log(`  ${(m.name || m.id).padEnd(28)} ${m.credit_used}`));

  console.log('\nDRIVER CASH OWED — NOT TOUCHED, READ THIS');
  if (!owing || !owing.length) console.log('  none');
  else {
    owing.forEach((d) => console.log(`  ${(d.full_name || d.id).padEnd(28)} ${d.cash_owed}`));
    console.log(
      '  ^ part of this may have been accrued against orders this script is\n' +
        '    about to delete; the rest comes from cash RIDES, which survive. The\n' +
        '    ledger cannot tell them apart from here — driver_cash_ledger.booking_id\n' +
        '    is a FK to bookings, so a food/shop charge only names the order in a\n' +
        '    text note. Left alone on purpose. Settle or zero by hand if these\n' +
        '    should not carry into launch.'
    );
  }

  console.log('\nBOOKINGS (rides) are NOT touched:', before.bookings);

  if (!confirmed) {
    console.log('\nDRY RUN. Nothing was changed. Re-run with --confirm to apply.');
    return;
  }

  console.log('\nAPPLYING');

  for (const order of heldStock || []) {
    const { data, error } = await supabase.rpc('shop_release_stock', { p_order_id: order.id });
    if (error) throw new Error(`shop_release_stock(${order.order_code}): ${error.message}`);
    console.log(`  stock released  ${order.order_code}  ${JSON.stringify(data)}`);
  }

  await deleteAll('shop_orders');
  console.log('  shop_orders deleted');
  await deleteAll('orders');
  console.log('  orders deleted');

  await deleteAll('merchant_credit_ledger');
  console.log('  merchant_credit_ledger cleared');

  const { error: creditErr } = await supabase
    .from('merchants')
    .update({ credit_used: 0 })
    .gt('credit_used', 0);
  if (creditErr) throw new Error(`merchants.credit_used: ${creditErr.message}`);
  console.log('  merchants.credit_used zeroed');

  console.log('\nAFTER');
  for (const t of ['orders', 'shop_orders', 'bookings', 'merchant_credit_ledger']) {
    console.log(`  ${t.padEnd(24)} ${await countOf(t)}`);
  }
  console.log('\nRides, drivers, merchants, menus and accounts are unchanged.');
}

run().catch((err) => {
  console.error('\nFAILED:', err.message);
  console.error('Nothing further was attempted. Re-run the dry run to see current state.');
  process.exit(1);
});
