// ---------------------------------------------------------------------
// Verify required Supabase migrations are applied.
//   npm run check:migrations
//
// Two kinds of check:
//
//   * SCHEMA checks run with the SERVICE ROLE key and probe for a column
//     or table the migration adds (`.select(col).limit(0)` — PostgREST
//     reports 42703 until the SQL has run).
//
//   * GRANT checks run with the ANON key and assert that a confidential
//     column is REFUSED. The service role sees everything, so it cannot
//     detect a missing column grant even in principle — which is why
//     migrations 0019 and 0029 were previously unverifiable and a
//     database missing the margin confidentiality control still passed.
//     Set SUPABASE_ANON_KEY to enable these; they are skipped with a
//     warning when it is absent. The anon key is public by design (it
//     ships in the frontend bundle), so holding a copy here is safe.
// ---------------------------------------------------------------------
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { supabase } = require('../lib/supabase');

// Anon-key client, used only by the grant checks. Optional on purpose.
const anonKey = process.env.SUPABASE_ANON_KEY || '';
const anon = anonKey
  ? createClient(process.env.SUPABASE_URL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// A confidential column is correct when reading it FAILS as anon.
// Returns null on success (column properly hidden), a message on a leak.
async function assertHidden(table, column) {
  const { error } = await anon.from(table).select(column).limit(1);
  if (!error) {
    return `LEAK: anon can read ${table}.${column} — the column grant is missing or was overwritten`;
  }
  // Only a PRIVILEGE error means the control is working. Treating any error
  // as a pass would let a missing table, a typo in the column name, or an
  // unrelated outage masquerade as "confidential" — the check would go green
  // on a database that has none of this applied.
  const msg = String(error.message || '');
  if (/permission denied|not allowed/i.test(msg)) return null;
  return `INCONCLUSIVE for ${table}.${column}: ${msg}`;
}

// A column the client roles must NOT be able to write.
//
// Every probe targets the all-zeros UUID, so it can never match a real row —
// this reads the error CODE, not the effect. 42501 means the grant is gone
// (correct). Anything else means the grant is still there and only RLS stands
// between a client and the write, which for profiles.role is a straight path
// to admin.
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
async function assertNoWrite(table, patch) {
  const column = Object.keys(patch)[0];
  const { error } = await anon.from(table).update(patch).eq('id', ZERO_UUID);
  if (!error) {
    return `ESCALATION RISK: anon still holds UPDATE on ${table}.${column} — only RLS blocks it. Run 0030.`;
  }
  if (error.code === '42501') return null;
  return `INCONCLUSIVE for ${table}.${column}: ${error.code || ''} ${error.message}`;
}

// The probe above runs with the anon key and NO session, so PostgREST executes
// as `anon`. That is not the role the escalation needed: the RLS policy is
// `id = auth.uid()`, so it required `authenticated`. Grants to the two roles
// are independent, and 0030's own reversal notes grant to `authenticated`
// only — meaning a rolled-back database would still pass the anon probe.
//
// check_column_privilege (migration 0032) asks the catalogue directly, for any
// role, with no test user required.
async function assertRoleLacksUpdate(role, table, column) {
  const { data, error } = await supabase.rpc('check_column_privilege', {
    p_role: role,
    p_table: table,
    p_column: column,
    p_privilege: 'update',
  });
  if (error) return `probe unavailable (${error.code || ''} ${error.message}) — run 0032`;
  if (data === true) {
    return `ESCALATION RISK: role "${role}" holds UPDATE on ${table}.${column}. Run 0030.`;
  }
  return null;
}

async function assertRoleHasUpdate(role, table, column) {
  const { data, error } = await supabase.rpc('check_column_privilege', {
    p_role: role,
    p_table: table,
    p_column: column,
    p_privilege: 'update',
  });
  if (error) return `probe unavailable (${error.code || ''} ${error.message}) — run 0032`;
  if (data !== true) {
    return `${role} cannot UPDATE ${table}.${column} — users can no longer edit their own profile.`;
  }
  return null;
}

// A non-confidential column must remain readable as anon.
async function assertVisible(table, column) {
  const { error } = await anon.from(table).select(column).limit(1);
  if (error && /permission denied/i.test(error.message || '')) {
    return `${table}.${column} is not granted to anon — re-grant it (see 0029 Part B)`;
  }
  return null;
}

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
    id: '0005',
    name: 'driver verification documents',
    run: async () => {
      const { error } = await supabase.from('driver_documents').select('status').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0005_driver_verification.sql',
  },
  {
    id: '0006',
    name: 'payment gateway groundwork (webhook_events)',
    run: async () => {
      const { error } = await supabase.from('webhook_events').select('id').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0006_payment_gateway.sql',
  },
  {
    id: '0007',
    name: 'data collection (order_type + booking snapshots)',
    // Filtering on the enum value forces PostgREST to cast it.
    run: async () => {
      const { error } = await supabase
        .from('bookings')
        .select('id')
        .eq('order_type', 'shop')
        .limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0007_data_collection.sql',
  },
  {
    id: '0008',
    name: 'notifications (push tokens + event inbox)',
    run: async () => {
      const e1 = (await supabase.from('device_push_tokens').select('id').limit(0)).error;
      if (e1) return e1.message;
      const e2 = (await supabase.from('notification_events').select('type').limit(0)).error;
      return e2 ? e2.message : null;
    },
    sqlFile: '0008_notifications.sql',
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
    id: '0017',
    name: 'web push notification columns',
    run: async () => {
      const { error } = await supabase
        .from('notification_events')
        .select('order_id, code, read_at')
        .limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0017_web_push_notifications.sql',
  },
  {
    id: '0018',
    name: 'menu item net price (variable markup)',
    run: async () => {
      const { error } = await supabase.from('menu_items').select('net_price').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0018_menu_item_net_price.sql',
  },
  {
    id: '0019',
    name: 'food money confidentiality (column grants)',
    // THE control that hides the margin model from the public anon key.
    // Unverifiable with the service role — this needs the anon client.
    grantCheck: true,
    run: async () => {
      return (
        (await assertHidden('menu_items', 'net_price')) ||
        (await assertHidden('orders', 'platform_margin_total')) ||
        (await assertHidden('order_items', 'margin_total')) ||
        null
      );
    },
    sqlFile: '0019_food_money_confidentiality.sql',
  },
  {
    id: '0020',
    name: 'driver service types',
    run: async () => {
      const { error } = await supabase.from('profiles').select('service_types').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0020_driver_service_types.sql',
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
  {
    id: '0023',
    name: 'menu item drink sizes (size_options + cart/order size)',
    run: async () => {
      const e1 = (await supabase.from('menu_items').select('size_options').limit(0)).error;
      if (e1) return e1.message;
      const e2 = (await supabase.from('cart_items').select('size').limit(0)).error;
      if (e2) return e2.message;
      const e3 = (await supabase.from('order_items').select('size_snapshot').limit(0)).error;
      return e3 ? e3.message : null;
    },
    sqlFile: '0023_menu_item_sizes.sql',
  },
  {
    id: '0024',
    name: 'profile avatar/address + order contact phone',
    run: async () => {
      const e1 = (await supabase.from('profiles').select('avatar_url, address').limit(0)).error;
      if (e1) return e1.message;
      const e2 = (await supabase.from('orders').select('contact_phone').limit(0)).error;
      return e2 ? e2.message : null;
    },
    sqlFile: '0024_profile_and_contact.sql',
  },
  {
    id: '0025',
    name: '15% VAT (orders + bookings tax snapshot)',
    run: async () => {
      const e1 = (await supabase.from('orders').select('vat_amount, vat_rate').limit(0)).error;
      if (e1) return e1.message;
      const e2 = (
        await supabase.from('bookings').select('vat_amount, vat_rate, total_amount').limit(0)
      ).error;
      return e2 ? e2.message : null;
    },
    sqlFile: '0025_vat.sql',
  },
  {
    id: '0026',
    name: 'ecommerce core (merchants.vertical + catalogue)',
    run: async () => {
      const e1 = (await supabase.from('merchants').select('vertical').limit(0)).error;
      if (e1) return e1.message;
      const e2 = (await supabase.from('product_categories').select('sort_order').limit(0)).error;
      if (e2) return e2.message;
      const e3 = (
        await supabase.from('products').select('net_price, stock_quantity, track_stock, barcode').limit(0)
      ).error;
      if (e3) return e3.message;
      const e4 = (
        await supabase.from('product_variants').select('sku, label, stock_quantity').limit(0)
      ).error;
      return e4 ? e4.message : null;
    },
    sqlFile: '0026_ecommerce_core.sql',
  },
  {
    id: '0027',
    name: 'ecommerce carts + orders',
    run: async () => {
      const e1 = (await supabase.from('shop_carts').select('merchant_id').limit(0)).error;
      if (e1) return e1.message;
      const e2 = (await supabase.from('shop_cart_items').select('variant_id').limit(0)).error;
      if (e2) return e2.message;
      const e3 = (
        await supabase.from('shop_orders').select('order_code, platform_margin_total, vat_amount').limit(0)
      ).error;
      if (e3) return e3.message;
      const e4 = (
        await supabase.from('shop_order_items').select('sku_snapshot, margin_total').limit(0)
      ).error;
      if (e4) return e4.message;
      const e5 = (await supabase.from('shop_order_payments').select('proof_path').limit(0)).error;
      if (e5) return e5.message;
      const e6 = (await supabase.from('shop_deliveries').select('pickup_photo_path').limit(0)).error;
      if (e6) return e6.message;
      const e7 = (await supabase.from('shop_ratings').select('product_rating').limit(0)).error;
      return e7 ? e7.message : null;
    },
    sqlFile: '0027_ecommerce_orders.sql',
  },
  {
    id: '0028',
    name: 'ecommerce dispatch widening + atomic stock RPCs',
    run: async () => {
      const e1 = (await supabase.from('dispatch_offers').select('shop_order_id').limit(0)).error;
      if (e1) return e1.message;
      const e2 = (await supabase.from('merchant_credit_ledger').select('shop_order_id').limit(0)).error;
      if (e2) return e2.message;
      const e3 = (await supabase.from('driver_ratings').select('shop_order_id').limit(0)).error;
      if (e3) return e3.message;
      const e4 = (
        await supabase.from('shop_orders').select('stock_reserved_at, stock_released_at').limit(0)
      ).error;
      if (e4) return e4.message;

      // Probe both RPCs. shop_release_stock on a random uuid is a read-only
      // no-op that returns { released: false, reason: 'order_not_found' }.
      const { error: rpcError } = await supabase.rpc('shop_release_stock', {
        p_order_id: '00000000-0000-0000-0000-000000000000',
      });
      if (rpcError) return rpcError.message;

      // shop_place_order with EMPTY line/order payloads. This does not just
      // prove the function exists — it exercises the jsonb argument shape.
      // A NOT NULL violation (23502) on the empty order means the function
      // is present and parsing; anything else (missing function PGRST202,
      // or a cast error) is a real failure. Worth the extra call: an earlier
      // build shipped a variant_id cast bug that made every checkout with a
      // plain product 500, and a mere existence check went green on it.
      const { error: placeError } = await supabase.rpc('shop_place_order', {
        p_order: {},
        p_lines: [],
      });
      if (placeError && placeError.code !== '23502' && placeError.code !== '22P02') {
        return `shop_place_order: ${placeError.message}`;
      }
      return null;
    },
    sqlFile: '0028_ecommerce_dispatch_and_stock.sql',
  },
  {
    id: '0029',
    name: 'ecommerce money confidentiality (column grants)',
    grantCheck: true,
    run: async () => {
      return (
        (await assertHidden('products', 'net_price')) ||
        (await assertHidden('products', 'stock_quantity')) ||
        // The threshold is withheld too: published alongside the band it
        // would let the band be inverted back into a numeric range.
        (await assertHidden('products', 'low_stock_threshold')) ||
        (await assertHidden('product_variants', 'net_price')) ||
        (await assertHidden('product_variants', 'stock_quantity')) ||
        (await assertHidden('shop_orders', 'platform_margin_total')) ||
        (await assertHidden('shop_order_items', 'margin_per_item')) ||
        (await assertHidden('shop_order_items', 'margin_total')) ||
        // Part B: the three food columns 0019 left ungranted.
        (await assertVisible('menu_items', 'size_options')) ||
        (await assertVisible('order_items', 'size_snapshot')) ||
        (await assertVisible('orders', 'contact_phone')) ||
        null
      );
    },
    sqlFile: '0029_ecommerce_money_confidentiality.sql',
  },
  {
    id: '0030',
    name: 'privilege lockdown + shop hardening',
    run: async () => {
      // reserved_qty is the schema half (B5).
      const e1 = (await supabase.from('shop_order_items').select('reserved_qty').limit(0)).error;
      if (e1) return e1.message;
      return null;
    },
    sqlFile: '0030_privilege_lockdown_and_shop_hardening.sql',
  },
  {
    id: '0031',
    name: "delivery_status 'cancelled' (run this file ALONE)",
    // Split out of 0030 because ALTER TYPE ... ADD VALUE can abort the whole
    // transaction the SQL Editor wraps a pasted script in, taking every
    // other statement down with it. Filtering forces the enum cast.
    run: async () => {
      const { error } = await supabase
        .from('shop_deliveries')
        .select('id')
        .eq('status', 'cancelled')
        .limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0031_delivery_status_cancelled.sql',
  },
  {
    id: '0032',
    name: 'merchant location grant tightened + authenticated-role privilege probe',
    // The anon probes above cannot see the `authenticated` grants, which is
    // the role the escalation actually needed. This asks the catalogue.
    run: async () => {
      return (
        (await assertRoleLacksUpdate('authenticated', 'profiles', 'role')) ||
        (await assertRoleLacksUpdate('authenticated', 'profiles', 'driver_approved')) ||
        (await assertRoleLacksUpdate('authenticated', 'profiles', 'cash_owed')) ||
        (await assertRoleLacksUpdate('authenticated', 'products', 'net_price')) ||
        (await assertRoleLacksUpdate('authenticated', 'menu_items', 'net_price')) ||
        (await assertRoleLacksUpdate('authenticated', 'merchants', 'vertical')) ||
        (await assertRoleLacksUpdate('authenticated', 'merchants', 'credit_used')) ||
        // 0032: lat/lng are the pickup geofence target, not presentation.
        (await assertRoleLacksUpdate('authenticated', 'merchants', 'lat')) ||
        (await assertRoleLacksUpdate('authenticated', 'merchants', 'lng')) ||
        // The other direction: a user must STILL be able to edit their own
        // profile, or 0030 has locked everyone out of their own account.
        (await assertRoleHasUpdate('authenticated', 'profiles', 'full_name')) ||
        null
      );
    },
    sqlFile: '0032_merchant_location_grant_and_probe.sql',
  },
  {
    id: '0030-priv',
    name: 'write grants revoked from the public client roles (CRITICAL)',
    // The privilege half of 0030. Needs the anon key for the same reason
    // the grant checks do: the service role holds every privilege, so it
    // cannot see that anon holds one too. A failure here means any signed-in
    // user can PATCH their own profiles.role to 'admin'.
    grantCheck: true,
    run: async () => {
      return (
        (await assertNoWrite('profiles', { role: 'admin' })) ||
        (await assertNoWrite('profiles', { driver_approved: true })) ||
        (await assertNoWrite('menu_items', { net_price: 1 })) ||
        (await assertNoWrite('products', { net_price: 1 })) ||
        (await assertNoWrite('merchants', { vertical: 'shop' })) ||
        null
      );
    },
    sqlFile: '0030_privilege_lockdown_and_shop_hardening.sql',
  },
];

async function main() {
  console.log('Checking Smart Mappia database migrations...\n');
  let failed = 0;
  let skipped = 0;

  for (const check of CHECKS) {
    if (check.grantCheck && !anon) {
      skipped += 1;
      console.log(`[SKIP] ${check.id} ${check.name}`);
      console.log('   Needs SUPABASE_ANON_KEY in backend/.env (public key, safe to store).\n');
      continue;
    }

    let err;
    try {
      err = await check.run();
    } catch (e) {
      err = e.message || String(e);
    }

    if (err) {
      failed += 1;
      console.log(`[FAIL] ${check.id} ${check.name}`);
      console.log(`   ${err}`);
      if (check.sqlFile) {
        console.log(`   -> Run backend/migrations/${check.sqlFile} in Supabase -> SQL Editor\n`);
      } else {
        console.log('   -> Run backend/migrations/0001_init_smart_mappia.sql first\n');
      }
    } else {
      console.log(`[OK]   ${check.id} ${check.name}`);
    }
  }

  if (skipped) {
    console.log(
      `\n${skipped} grant check(s) skipped. These are the ONLY checks that can detect a missing\n` +
        'column grant — the service role sees every column, so a database leaking net_price or\n' +
        'platform_margin_total to the public anon key would otherwise pass silently.\n' +
        'Set SUPABASE_ANON_KEY in backend/.env to enable them.'
    );
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
