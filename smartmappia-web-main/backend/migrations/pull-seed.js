// ---------------------------------------------------------------------
// Pull a full data snapshot FROM the live Supabase project into a local
// JSON seeder file, using the same server-side connection (lib/supabase.js)
// every other script here uses.
//
//   npm run seed:pull                          // all tables, full pull
//   npm run seed:pull -- --tables profiles,merchants
//   npm run seed:pull -- --limit 500           // cap rows per table
//   npm run seed:pull -- --out ./some-dir      // custom output dir
//
// Output lands in backend/migrations/seed-snapshots/ (gitignored — the
// snapshot contains real user data, never commit it). The newest pull is
// always mirrored to seed-snapshot-latest.json; seed-push.js can read it
// back into any project.
//
// Auth users (supabase auth) are included under the "auth_users" key so a
// reseed can recreate logins, not just table rows.
// ---------------------------------------------------------------------
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabase } = require('../lib/supabase');

const PAGE = 1000; // PostgREST max rows per request

// Every table in migrations/reconstructed/0001_schema.sql
const ALL_TABLES = [
  'profiles',
  'merchants',
  'merchant_hours',
  'bookings',
  'menu_categories',
  'menu_items',
  'product_categories',
  'products',
  'product_variants',
  'carts',
  'cart_items',
  'orders',
  'order_items',
  'order_payments',
  'deliveries',
  'ratings',
  'shop_carts',
  'shop_cart_items',
  'shop_orders',
  'shop_order_items',
  'shop_order_payments',
  'shop_deliveries',
  'shop_ratings',
  'payment_proofs',
  'payments',
  'tracking_events',
  'ledger_entries',
  'driver_cash_ledger',
  'driver_documents',
  'driver_locations',
  'dispatch_offers',
  'driver_ratings',
  'merchant_credit_ledger',
  'device_push_tokens',
  'notification_events',
  'fd_analytics_events',
  'audit_logs',
  'app_settings',
  'admin_login_events',
  'error_logs',
  'payment_customers',
  'saved_payment_methods',
  'webhook_events',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  return {
    tables: get('--tables') ? get('--tables').split(',').map((s) => s.trim()) : ALL_TABLES,
    limit: get('--limit') !== undefined ? parseInt(get('--limit'), 10) : 0,
    out: get('--out') || path.join(__dirname, 'seed-snapshots'),
  };
}

async function pullTable(table, limit) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const to = limit ? Math.min(from + PAGE - 1, limit - 1) : from + PAGE - 1;
    const { data, error } = await supabase.from(table).select('*').range(from, to);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
    if (limit && rows.length >= limit) break;
  }
  return rows;
}

async function pullAuthUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth.users: ${error.message}`);
    users.push(...(data.users || []));
    if (!data.users || data.users.length < 200) break;
  }
  return users;
}

async function run() {
  const opts = parseArgs();
  const started = Date.now();
  const snapshot = {
    pulled_at: new Date().toISOString(),
    source: process.env.SUPABASE_URL,
    tables: {},
  };

  fs.mkdirSync(opts.out, { recursive: true });

  for (const table of opts.tables) {
    const rows = await pullTable(table, opts.limit);
    snapshot.tables[table] = rows;
    console.log(`  ${table}: ${rows.length} rows`);
  }

  let authCount = 0;
  try {
    snapshot.auth_users = await pullAuthUsers();
    authCount = snapshot.auth_users.length;
    console.log(`  auth.users: ${authCount} users`);
  } catch (err) {
    console.warn(`  auth.users skipped (${err.message})`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(opts.out, `seed-${stamp}.json`);
  const latest = path.join(opts.out, 'seed-snapshot-latest.json');
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(latest, JSON.stringify(snapshot, null, 2));

  const totalRows = Object.values(snapshot.tables).reduce((n, r) => n + r.length, 0);
  console.log(`\n✅ Pulled ${totalRows} rows across ${opts.tables.length} tables` +
    (authCount ? ` + ${authCount} auth users` : '') +
    ` in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`   snapshot: ${file}`);
  console.log(`   latest:   ${latest}`);
}

run().catch((err) => {
  console.error('seed:pull failed:', err.message || err);
  process.exit(1);
});
