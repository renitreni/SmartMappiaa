// ---------------------------------------------------------------------
// Verify required Supabase migrations are applied.
//   npm run check:migrations
// ---------------------------------------------------------------------
require('dotenv').config();
const { supabase } = require('../lib/supabase');

const CHECKS = [
  {
    id: '0001',
    name: 'profiles table',
    run: async () => {
      const { error } = await supabase.from('profiles').select('id, role').limit(0);
      return error ? error.message : null;
    },
  },
  {
    id: '0002',
    name: 'driver_approved column',
    run: async () => {
      const { error } = await supabase.from('profiles').select('driver_approved').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0002_auth_driver_approval.sql',
  },
  {
    id: '0003',
    name: 'extended registration fields',
    run: async () => {
      const { error } = await supabase.from('profiles').select('date_of_birth').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0003_profile_registration_fields.sql',
  },
  {
    id: '0009',
    name: 'food delivery core (merchants + menus)',
    run: async () => {
      const { error } = await supabase.from('menu_items').select('id, item_type').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0009_food_delivery_core.sql',
  },
  {
    id: '0010',
    name: 'food delivery carts + orders',
    run: async () => {
      const { error } = await supabase.from('orders').select('order_code, platform_margin_total').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0010_food_delivery_orders.sql',
  },
  {
    id: '0011',
    name: 'merchant credit ledger',
    run: async () => {
      const { error } = await supabase.from('merchant_credit_ledger').select('balance_after').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0011_food_delivery_credit.sql',
  },
  {
    id: '0012',
    name: 'food delivery extras (analytics + audit logs)',
    run: async () => {
      const { error } = await supabase.from('audit_logs').select('action').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0012_food_delivery_extras.sql',
  },
  {
    id: '0013',
    name: 'dispatch offers + merchant vetting',
    run: async () => {
      const { error } = await supabase.from('dispatch_offers').select('expires_at').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0013_dispatch_and_merchant_vetting.sql',
  },
  {
    id: '0014',
    name: 'driver star ratings',
    run: async () => {
      const { error } = await supabase.from('driver_ratings').select('stars').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0014_driver_ratings.sql',
  },
  {
    id: '0015',
    name: 'merchant homepage presentation (featured + badge)',
    run: async () => {
      const { error } = await supabase.from('merchants').select('is_featured, badge').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0015_merchant_homepage_presentation.sql',
  },
  {
    id: '0016',
    name: 'food audit hardening (indexes, deliveries.status enum, money checks)',
    // Light check: 0016 adds indexes / CHECK constraints / an enum conversion, none of
    // which PostgREST can introspect. This just confirms deliveries is reachable; the
    // migration self-reports via NOTICE in the Supabase SQL editor when it runs.
    run: async () => {
      const { error } = await supabase.from('deliveries').select('status').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0016_food_audit_hardening.sql',
  },
  {
    id: '0021',
    name: 'ride cash payment (enum value)',
    // Filtering on the enum value makes PostgREST cast it: errors with
    // "invalid input value for enum payment_method" until 0021 has run.
    run: async () => {
      const { error } = await supabase
        .from('bookings')
        .select('id')
        .eq('payment_method', 'cash')
        .limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0021_ride_cash_payment.sql',
  },
  {
    id: '0022',
    name: 'driver cash settlement (cash_owed + ledger)',
    run: async () => {
      const e1 = (await supabase.from('profiles').select('cash_owed, cash_owed_limit').limit(0)).error;
      if (e1) return e1.message;
      const e2 = (await supabase.from('driver_cash_ledger').select('balance_after').limit(0)).error;
      return e2 ? e2.message : null;
    },
    sqlFile: '0022_driver_cash_settlement.sql',
  },
];

async function main() {
  console.log('Checking Smart Mappia database migrations...\n');
  let failed = 0;

  for (const check of CHECKS) {
    const err = await check.run();
    if (err) {
      failed += 1;
      console.log(`❌ ${check.id} ${check.name}`);
      console.log(`   ${err}`);
      if (check.sqlFile) {
        console.log(`   → Run backend/migrations/${check.sqlFile} in Supabase → SQL Editor\n`);
      } else {
        console.log('   → Run backend/migrations/0001_init_smart_mappia.sql first\n');
      }
    } else {
      console.log(`✅ ${check.id} ${check.name}`);
    }
  }

  if (failed) {
    console.log('\nFix the failed migrations, then run: npm run seed:admin');
    process.exit(1);
  }

  console.log('\nAll migrations look good.');
}

main().catch((err) => {
  console.error('check-migrations failed:', err.message || err);
  process.exit(1);
});
