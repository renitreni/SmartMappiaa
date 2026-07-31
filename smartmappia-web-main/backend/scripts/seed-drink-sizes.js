// ---------------------------------------------------------------------
// Seed Medium / Large drink sizes on every drink menu item.
//
//   npm run seed:drink-sizes
//
// Rules (matches the customer menu plan):
//   * item_type === 'drink_dessert_addon', OR
//   * category name matches drink|tea|coffee|milk|shake|smoothie|uhaw|juice|beverage
//
// Pricing: Medium = current list price; Large = Medium + 5 SAR.
// Idempotent — items that already have size_options are left alone.
// ---------------------------------------------------------------------
require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { normalizeSizeOptions } = require('../lib/foodSizes');

const DRINK_CATEGORY_RE = /drink|tea|coffee|milk|shake|smoothie|uhaw|juice|beverage/i;
const LARGE_UPCHARGE = 5;

function isDrinkItem(item, categoryById) {
  if (item.item_type === 'drink_dessert_addon') return true;
  const cat = categoryById.get(item.category_id);
  return DRINK_CATEGORY_RE.test(cat?.name || '');
}

function buildSizes(listPrice) {
  const medium = Math.round(Number(listPrice) * 100) / 100;
  const large = Math.round((medium + LARGE_UPCHARGE) * 100) / 100;
  return normalizeSizeOptions([
    { id: 'medium', label: 'Medium', price: medium, enabled: true },
    { id: 'large', label: 'Large', price: large, enabled: true },
  ]);
}

async function run() {
  const { data: categories, error: catErr } = await supabase
    .from('menu_categories')
    .select('id, name, merchant_id');
  if (catErr) throw catErr;

  const categoryById = new Map((categories || []).map((c) => [c.id, c]));

  const { data: items, error: itemErr } = await supabase
    .from('menu_items')
    .select('id, name, price, item_type, category_id, size_options, merchant_id, is_available');
  if (itemErr) throw itemErr;

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items || []) {
    if (!isDrinkItem(item, categoryById)) continue;
    if (Array.isArray(item.size_options) && item.size_options.length > 0) {
      skipped += 1;
      continue;
    }

    const sized = buildSizes(item.price);
    if (!sized.ok) {
      console.error(`  skip ${item.name}: ${sized.error}`);
      failed += 1;
      continue;
    }

    const { error } = await supabase
      .from('menu_items')
      .update({ size_options: sized.value })
      .eq('id', item.id);

    if (error) {
      console.error(`  fail ${item.name}: ${error.message}`);
      failed += 1;
      continue;
    }

    updated += 1;
    console.log(
      `  ✓ ${item.name} → Medium ${sized.value[0].price} / Large ${sized.value[1].price}`
    );
  }

  console.log(`\n✅ Drink sizes seeded. updated=${updated} skipped=${skipped} failed=${failed}`);
}

run().catch((err) => {
  console.error('seed-drink-sizes failed:', err.message || err);
  process.exit(1);
});
