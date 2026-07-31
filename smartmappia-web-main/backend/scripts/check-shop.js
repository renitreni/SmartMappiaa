// ---------------------------------------------------------------------
// Verify the Ecommerce ("shop") vertical: schema, money confidentiality,
// write privileges, RLS visibility, markup integrity, RPC presence and
// stock sanity.
//   npm run check:shop
//
// READ-ONLY / SELF-CLEANING. Every check is a SELECT, or an UPDATE/RPC
// call targeted at the all-zeros UUID (00000000-0000-0000-0000-000000000000),
// which matches no real row and so can never create or mutate one. This
// script never writes to shop_orders, shop_cart_items, products, etc. and
// leaves the database exactly as it found it.
//
// Follows the shape of check-migrations.js:
//
//   * SCHEMA checks run with the SERVICE ROLE key and probe for a table or
//     column (`.select(col).limit(0)` — PostgREST reports 42703/table-not-
//     found until the migration has run).
//
//   * CONFIDENTIALITY / PRIVILEGE / RLS checks run with the ANON key,
//     because the service role bypasses RLS and grants and so cannot
//     detect a leak or an open write even in principle. Set
//     SUPABASE_ANON_KEY in backend/.env to enable them (public key, safe
//     to store); they are SKIPPED with a warning when it is absent.
// ---------------------------------------------------------------------
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { supabase } = require('../lib/supabase');

const anonKey = process.env.SUPABASE_ANON_KEY || '';
const anon = anonKey
  ? createClient(process.env.SUPABASE_URL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// Matches no real row in any table — every write/RPC probe below targets
// this id, so a "success" can only mean the grant/RLS is open, never that
// a row was actually touched.
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const SHOP_STORE_NAMES = ['Pinas Supermarket', 'Al Wafa Hypermarket'];

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

// A confidential column is correct when reading it as anon FAILS with the
// Postgres "insufficient_privilege" code. Returns null on success (column
// properly hidden), a message on a leak or an inconclusive result.
async function assertHidden(table, column) {
  const { error } = await anon.from(table).select(column).limit(1);
  if (!error) {
    return `LEAK: anon can read ${table}.${column} — the column grant is missing or was overwritten`;
  }
  if (error.code === '42501') return null;
  return `INCONCLUSIVE for ${table}.${column}: ${error.code || ''} ${error.message}`;
}

// A column the client roles must NOT be able to write. Targets ZERO_UUID
// so it can never match a real row — this reads the error CODE, not the
// effect. 42501 means the grant is gone (correct). Anything else means the
// grant is still there and only RLS stands between a client and the write.
async function assertNoWrite(table, patch) {
  const column = Object.keys(patch)[0];
  const { error } = await anon.from(table).update(patch).eq('id', ZERO_UUID);
  if (!error) {
    return `ESCALATION RISK: anon/authenticated still hold UPDATE on ${table}.${column} — only RLS blocks it. Run 0030.`;
  }
  if (error.code === '42501') return null;
  return `INCONCLUSIVE for ${table}.${column}: ${error.code || ''} ${error.message}`;
}

// A row set that must be INVISIBLE to anon: expect an empty array, not an
// error (an error would mean something else entirely — a missing table, a
// typo, an outage — and must not be read as "hidden").
async function assertRowsInvisible(queryFn, label) {
  const { data, error } = await queryFn();
  if (error) {
    return `INCONCLUSIVE for ${label}: ${error.code || ''} ${error.message}`;
  }
  if (data && data.length > 0) {
    return `LEAK: anon can see ${data.length} row(s) for ${label} — RLS is not filtering the unlisted store`;
  }
  return null;
}

async function main() {
  console.log('Checking Smart Mappia shop (ecommerce) vertical...\n');

  // ---------------------------------------------------------------------
  // One-time setup reads (service role), reused by several sections below.
  // ---------------------------------------------------------------------

  // The two seeded, unlisted stores — needed for the RLS section.
  let shopStores = [];
  try {
    const { data, error } = await supabase
      .from('merchants')
      .select('id, name, is_active, status')
      .eq('vertical', 'shop')
      .in('name', SHOP_STORE_NAMES);
    if (!error && data) shopStores = data;
  } catch (e) {
    // leave shopStores empty; the RLS checks below report SKIP
  }

  // All products / variants — needed for money integrity + stock sanity.
  let products = [];
  let productsErr = null;
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, price, net_price, stock_quantity');
    if (error) productsErr = error;
    else products = data || [];
  } catch (e) {
    productsErr = e;
  }

  let variants = [];
  let variantsErr = null;
  try {
    const { data, error } = await supabase
      .from('product_variants')
      .select('id, label, price, net_price, stock_quantity');
    if (error) variantsErr = error;
    else variants = data || [];
  } catch (e) {
    variantsErr = e;
  }

  const CHECKS = [
    // =====================================================================
    // 1. SCHEMA — every shop table and key column exists (service role)
    // =====================================================================
    {
      id: '1.1',
      name: 'products table + key columns (net_price, stock_quantity, low_stock_threshold)',
      run: async () => {
        const { error } = await supabase
          .from('products')
          .select('id, net_price, stock_quantity, low_stock_threshold')
          .limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.2',
      name: 'product_variants table + key columns (net_price, stock_quantity)',
      run: async () => {
        const { error } = await supabase
          .from('product_variants')
          .select('id, net_price, stock_quantity')
          .limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.3',
      name: 'product_categories table',
      run: async () => {
        const { error } = await supabase.from('product_categories').select('id, merchant_id, sort_order').limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.4',
      name: 'shop_carts table',
      run: async () => {
        const { error } = await supabase.from('shop_carts').select('id, customer_id, merchant_id').limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.5',
      name: 'shop_cart_items table',
      run: async () => {
        const { error } = await supabase.from('shop_cart_items').select('id, cart_id, variant_id').limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.6',
      name: 'shop_orders table + key columns (platform_margin_total, stock_reserved_at, stock_released_at)',
      run: async () => {
        const { error } = await supabase
          .from('shop_orders')
          .select('id, order_code, platform_margin_total, vat_amount, stock_reserved_at, stock_released_at')
          .limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.7',
      name: 'shop_order_items table + key columns (margin_per_item, margin_total, reserved_qty)',
      run: async () => {
        const { error } = await supabase
          .from('shop_order_items')
          .select('id, sku_snapshot, margin_per_item, margin_total, reserved_qty')
          .limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.8',
      name: 'shop_order_payments table',
      run: async () => {
        const { error } = await supabase.from('shop_order_payments').select('id, proof_path').limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.9',
      name: 'shop_deliveries table',
      run: async () => {
        const { error } = await supabase.from('shop_deliveries').select('id, pickup_photo_path').limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.10',
      name: 'shop_ratings table',
      run: async () => {
        const { error } = await supabase.from('shop_ratings').select('id, product_rating').limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.11',
      name: 'merchants.vertical column',
      run: async () => {
        const { error } = await supabase.from('merchants').select('vertical').limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.12',
      name: 'dispatch_offers.shop_order_id column',
      run: async () => {
        const { error } = await supabase.from('dispatch_offers').select('shop_order_id').limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.13',
      name: 'merchant_credit_ledger.shop_order_id column',
      run: async () => {
        const { error } = await supabase.from('merchant_credit_ledger').select('shop_order_id').limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.14',
      name: 'driver_ratings.shop_order_id column',
      run: async () => {
        const { error } = await supabase.from('driver_ratings').select('shop_order_id').limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.15',
      name: 'fd_analytics_events.shop_order_id column',
      run: async () => {
        const { error } = await supabase.from('fd_analytics_events').select('shop_order_id').limit(0);
        return error ? error.message : null;
      },
    },
    {
      id: '1.16',
      name: 'notification_events.shop_order_id column',
      run: async () => {
        const { error } = await supabase.from('notification_events').select('shop_order_id').limit(0);
        return error ? error.message : null;
      },
    },

    // =====================================================================
    // 2. CONFIDENTIALITY (anon key) — a success reading these is a LEAK.
    // =====================================================================
    {
      id: '2.1',
      name: 'CONFIDENTIAL products.net_price refused to anon (42501)',
      needsAnon: true,
      run: async () => assertHidden('products', 'net_price'),
    },
    {
      id: '2.2',
      name: 'CONFIDENTIAL products.stock_quantity refused to anon (42501)',
      needsAnon: true,
      run: async () => assertHidden('products', 'stock_quantity'),
    },
    {
      id: '2.3',
      name: 'CONFIDENTIAL products.low_stock_threshold refused to anon (42501)',
      needsAnon: true,
      run: async () => assertHidden('products', 'low_stock_threshold'),
    },
    {
      id: '2.4',
      name: 'CONFIDENTIAL product_variants.net_price refused to anon (42501)',
      needsAnon: true,
      run: async () => assertHidden('product_variants', 'net_price'),
    },
    {
      id: '2.5',
      name: 'CONFIDENTIAL product_variants.stock_quantity refused to anon (42501)',
      needsAnon: true,
      run: async () => assertHidden('product_variants', 'stock_quantity'),
    },
    {
      id: '2.6',
      name: 'CONFIDENTIAL shop_orders.platform_margin_total refused to anon (42501)',
      needsAnon: true,
      run: async () => assertHidden('shop_orders', 'platform_margin_total'),
    },
    {
      id: '2.7',
      name: 'CONFIDENTIAL shop_order_items.margin_per_item refused to anon (42501)',
      needsAnon: true,
      run: async () => assertHidden('shop_order_items', 'margin_per_item'),
    },
    {
      id: '2.8',
      name: 'CONFIDENTIAL shop_order_items.margin_total refused to anon (42501)',
      needsAnon: true,
      run: async () => assertHidden('shop_order_items', 'margin_total'),
    },

    // =====================================================================
    // 3. PRIVILEGE (anon key, ZERO_UUID target) — a success is an open
    //    escalation. This is migration 0030.
    // =====================================================================
    {
      id: '3.1',
      name: 'PRIVILEGE profiles.role UPDATE refused to anon (42501)',
      needsAnon: true,
      run: async () => assertNoWrite('profiles', { role: 'admin' }),
    },
    {
      id: '3.2',
      name: 'PRIVILEGE profiles.driver_approved UPDATE refused to anon (42501)',
      needsAnon: true,
      run: async () => assertNoWrite('profiles', { driver_approved: true }),
    },
    {
      id: '3.3',
      name: 'PRIVILEGE profiles.cash_owed UPDATE refused to anon (42501)',
      needsAnon: true,
      run: async () => assertNoWrite('profiles', { cash_owed: 0 }),
    },
    {
      id: '3.4',
      name: 'PRIVILEGE products.net_price UPDATE refused to anon (42501)',
      needsAnon: true,
      run: async () => assertNoWrite('products', { net_price: 1 }),
    },
    {
      id: '3.5',
      name: 'PRIVILEGE menu_items.net_price UPDATE refused to anon (42501)',
      needsAnon: true,
      run: async () => assertNoWrite('menu_items', { net_price: 1 }),
    },
    {
      id: '3.6',
      name: 'PRIVILEGE merchants.vertical UPDATE refused to anon (42501)',
      needsAnon: true,
      run: async () => assertNoWrite('merchants', { vertical: 'shop' }),
    },
    {
      id: '3.7',
      name: 'PRIVILEGE merchants.credit_used UPDATE refused to anon (42501)',
      needsAnon: true,
      run: async () => assertNoWrite('merchants', { credit_used: 0 }),
    },

    // =====================================================================
    // 4. RLS — unlisted stores and their products invisible to anon
    // =====================================================================
    {
      id: '4.1',
      name: `RLS: unlisted stores (${SHOP_STORE_NAMES.join(', ')}) invisible to anon`,
      needsAnon: true,
      needsStores: true,
      run: async () =>
        assertRowsInvisible(
          () =>
            anon
              .from('merchants')
              .select('id')
              .eq('vertical', 'shop')
              .in('id', shopStores.map((s) => s.id)),
          'merchants (unlisted shop stores)'
        ),
    },
    {
      id: '4.2',
      name: 'RLS: products of unlisted stores invisible to anon',
      needsAnon: true,
      needsStores: true,
      run: async () =>
        assertRowsInvisible(
          () =>
            anon
              .from('products')
              .select('id')
              .in('merchant_id', shopStores.map((s) => s.id)),
          'products (of unlisted shop stores)'
        ),
    },

    // =====================================================================
    // 5. MONEY INTEGRITY — net_price > 0 and <= price, for every seeded
    //    row (service role — this is the true, ungated markup model).
    // =====================================================================
    {
      id: '5.1',
      name: 'money: every product has 0 < net_price <= price',
      run: async () => {
        if (productsErr) return productsErr.message;
        console.log(`   ${products.length} product(s) checked.`);
        const bad = products.filter((p) => {
          const price = Number(p.price);
          const net = p.net_price === null || p.net_price === undefined ? null : Number(p.net_price);
          if (net === null) return true; // seeded products must set net_price directly
          return !(net > 0 && net <= price);
        });
        if (bad.length) {
          return (
            `${bad.length} product(s) violate 0 < net_price <= price: ` +
            bad.map((p) => `${p.name} (price=${p.price}, net_price=${p.net_price})`).join('; ')
          );
        }
        return null;
      },
    },
    {
      id: '5.2',
      name: 'money: every variant that sets both price and net_price has 0 < net_price <= price',
      run: async () => {
        if (variantsErr) return variantsErr.message;
        const withBoth = variants.filter((v) => v.price !== null && v.net_price !== null);
        console.log(`   ${variants.length} variant(s) found, ${withBoth.length} set both price and net_price.`);
        const bad = withBoth.filter((v) => !(Number(v.net_price) > 0 && Number(v.net_price) <= Number(v.price)));
        if (bad.length) {
          return (
            `${bad.length} variant(s) violate 0 < net_price <= price: ` +
            bad.map((v) => `${v.label} (price=${v.price}, net_price=${v.net_price})`).join('; ')
          );
        }
        return null;
      },
    },

    // =====================================================================
    // 6. RPC PRESENCE
    // =====================================================================
    {
      id: '6.1',
      name: "shop_release_stock(ZERO_UUID) returns {released:false, reason:'order_not_found'}",
      run: async () => {
        const { data, error } = await supabase.rpc('shop_release_stock', { p_order_id: ZERO_UUID });
        if (error) return `${error.code || ''} ${error.message}`.trim();
        if (!data || data.released !== false || data.reason !== 'order_not_found') {
          return `unexpected response: ${JSON.stringify(data)}`;
        }
        return null;
      },
    },
    {
      id: '6.2',
      name: 'shop_place_order({}, []) fails with 23502 (NOT NULL), not PGRST202 (missing function)',
      run: async () => {
        const { error } = await supabase.rpc('shop_place_order', { p_order: {}, p_lines: [] });
        if (!error) {
          return 'shop_place_order succeeded on an empty payload — this must never happen (it would insert a bogus order)';
        }
        if (error.code === 'PGRST202') {
          return `RPC missing: ${error.message}`;
        }
        if (error.code !== '23502') {
          return `expected 23502 (NOT NULL violation), got ${error.code || '?'}: ${error.message}`;
        }
        return null;
      },
    },

    // =====================================================================
    // 7. ENUM — delivery_status carries 'cancelled' (migration 0031).
    //    EXPECTED TO FAIL until 0031 is applied.
    // =====================================================================
    {
      id: '7.1',
      name: "delivery_status enum has 'cancelled' value (0031)",
      knownIssue: true,
      run: async () => {
        const { error } = await supabase.from('shop_deliveries').select('id').eq('status', 'cancelled').limit(0);
        if (error) {
          return (
            "0031 NOT APPLIED — delivery_status enum has no 'cancelled' value yet " +
            `(${error.message}). Run backend/migrations/0031_delivery_status_cancelled.sql ALONE ` +
            'in the Supabase SQL Editor (see the file header for why it must run alone).'
          );
        }
        return null;
      },
    },

    // =====================================================================
    // 8. STOCK SANITY — no negative stock_quantity anywhere
    // =====================================================================
    {
      id: '8.1',
      name: 'stock: no product has negative stock_quantity',
      run: async () => {
        if (productsErr) return productsErr.message;
        const bad = products.filter((p) => Number(p.stock_quantity) < 0);
        if (bad.length) {
          return (
            `${bad.length} product(s) have negative stock_quantity: ` +
            bad.map((p) => `${p.name} (${p.stock_quantity})`).join('; ')
          );
        }
        return null;
      },
    },
    {
      id: '8.2',
      name: 'stock: no variant has negative stock_quantity',
      run: async () => {
        if (variantsErr) return variantsErr.message;
        const bad = variants.filter((v) => Number(v.stock_quantity) < 0);
        if (bad.length) {
          return (
            `${bad.length} variant(s) have negative stock_quantity: ` +
            bad.map((v) => `${v.label} (${v.stock_quantity})`).join('; ')
          );
        }
        return null;
      },
    },
  ];

  let failed = 0;
  let knownFailed = 0;
  let skipped = 0;

  for (const check of CHECKS) {
    if (check.needsAnon && !anon) {
      skipped += 1;
      console.log(`[SKIP] ${check.id} ${check.name}`);
      console.log('   Needs SUPABASE_ANON_KEY in backend/.env (public key, safe to store).\n');
      continue;
    }
    if (check.needsStores && shopStores.length < SHOP_STORE_NAMES.length) {
      skipped += 1;
      console.log(`[SKIP] ${check.id} ${check.name}`);
      console.log(
        `   Could not find both seeded stores (${SHOP_STORE_NAMES.join(', ')}) via the service role — ` +
          `found ${shopStores.length}. Run npm run seed:shop first.\n`
      );
      continue;
    }

    let err;
    try {
      err = await check.run();
    } catch (e) {
      err = e.message || String(e);
    }

    if (err) {
      if (check.knownIssue) {
        knownFailed += 1;
        console.log(`[FAIL] ${check.id} ${check.name}  (KNOWN — see note)`);
        console.log(`   ${err}\n`);
      } else {
        failed += 1;
        console.log(`[FAIL] ${check.id} ${check.name}`);
        console.log(`   ${err}\n`);
      }
    } else {
      console.log(`[OK]   ${check.id} ${check.name}`);
    }
  }

  console.log('');
  if (skipped) {
    console.log(`${skipped} check(s) skipped — see [SKIP] notes above.`);
  }
  if (knownFailed) {
    console.log(
      `${knownFailed} known, tracked exception (0031 delivery_status 'cancelled' — not yet applied to this database).`
    );
  }

  if (failed) {
    console.log(`\n${failed} check(s) FAILED. Fix before considering the shop vertical verified.`);
    process.exit(1);
  }

  console.log('\nAll shop vertical checks look good' + (knownFailed ? ' (aside from the known 0031 exception above).' : '.'));
}

main().catch((err) => {
  console.error('check-shop failed:', err.message || err);
  process.exit(1);
});
