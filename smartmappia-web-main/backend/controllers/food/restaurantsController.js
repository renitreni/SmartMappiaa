// ---------------------------------------------------------------------
// Food Delivery — public restaurant discovery
//   - listRestaurants : GET /api/food/restaurants?q=&cuisine=
//   - getRestaurant   : GET /api/food/restaurants/:id
//
// Public endpoints (no auth): they expose only active restaurants and
// safe display fields. The optional bearer token is used purely to tag
// the view_menu analytics event with a user id.
// ---------------------------------------------------------------------
const { supabase } = require('../../lib/supabase');
const { config } = require('../../lib/config');
const { logFoodEvent } = require('../../lib/foodEvents');

const PUBLIC_MERCHANT_FIELDS =
  'id, name, cuisine_type, description, logo_url, address, lat, lng, service_radius_km, is_featured, badge';

// Real restaurant ratings, aggregated from the `ratings` table (food_rating).
// Returns Map(merchant_id -> { rating, reviewCount }); empty until customers
// actually review — the homepage simply hides stars when there are none.
async function ratingsForMerchants(merchantIds) {
  const out = new Map();
  if (!merchantIds.length) return out;
  const { data, error } = await supabase
    .from('ratings')
    .select('merchant_id, food_rating')
    .in('merchant_id', merchantIds);
  if (error) {
    console.error('ratingsForMerchants error:', error);
    return out;
  }
  const agg = new Map();
  for (const r of data || []) {
    const e = agg.get(r.merchant_id) || { sum: 0, n: 0 };
    e.sum += Number(r.food_rating) || 0;
    e.n += 1;
    agg.set(r.merchant_id, e);
  }
  for (const [mid, e] of agg) {
    out.set(mid, { rating: Math.round((e.sum / e.n) * 10) / 10, reviewCount: e.n });
  }
  return out;
}

async function listRestaurants(req, res) {
  try {
    const q = (req.query.q || '').toString().trim();
    const cuisine = (req.query.cuisine || '').toString().trim();
    const featuredOnly = String(req.query.featured || '') === 'true';

    let query = supabase
      .from('merchants')
      .select(PUBLIC_MERCHANT_FIELDS)
      // merchants is shared with the Ecommerce vertical (migration 0026).
      // Without this filter, stores would appear in restaurant discovery.
      .eq('vertical', 'food')
      .eq('is_active', true)
      .eq('status', 'active')
      // Featured restaurants lead the grid (drives the homepage section),
      // then alphabetical.
      .order('is_featured', { ascending: false })
      .order('name')
      .limit(100);

    // Escape LIKE wildcards so user input can't turn into a pattern.
    if (q) query = query.ilike('name', `%${q.replace(/[%_]/g, '\\$&')}%`);
    if (cuisine) query = query.eq('cuisine_type', cuisine);
    if (featuredOnly) query = query.eq('is_featured', true);

    const { data, error } = await query;
    if (error) {
      console.error('listRestaurants error:', error);
      return res.status(500).json({ error: 'Could not load restaurants' });
    }

    // Distinct cuisines drive the filter chips on the discovery screen.
    const { data: cuisines } = await supabase
      .from('merchants')
      .select('cuisine_type')
      .eq('vertical', 'food')
      .eq('is_active', true)
      .eq('status', 'active')
      .not('cuisine_type', 'is', null);

    const ratingMap = await ratingsForMerchants((data || []).map((m) => m.id));

    return res.json({
      restaurants: (data || []).map((m) => {
        const r = ratingMap.get(m.id);
        return { ...m, rating: r ? r.rating : null, reviewCount: r ? r.reviewCount : 0 };
      }),
      cuisines: [...new Set((cuisines || []).map((c) => c.cuisine_type).filter(Boolean))].sort(),
      deliveryFee: config.food.deliveryFeeSar,
      minOrder: config.food.minOrderSar,
    });
  } catch (err) {
    console.error('listRestaurants error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function getRestaurant(req, res) {
  try {
    const { id } = req.params;
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select(`${PUBLIC_MERCHANT_FIELDS}, vertical, is_active, status`)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('getRestaurant error:', error);
      return res.status(500).json({ error: 'Could not load the restaurant' });
    }
    // A shop merchant reached by id is a 404 here, not a partial render — the
    // food storefront must not confirm that some other kind of merchant sits
    // at that id, and its catalogue lives in different tables anyway.
    if (!merchant || merchant.vertical !== 'food' || !merchant.is_active || merchant.status !== 'active') {
      return res.status(404).json({ error: 'Restaurant not found or currently closed' });
    }

    const [{ data: categories }, { data: items }] = await Promise.all([
      supabase
        .from('menu_categories')
        .select('id, name, sort_order')
        .eq('merchant_id', id)
        .eq('is_active', true)
        .order('sort_order'),
      // Unavailable items are included, flagged, so the menu can render
      // them greyed out instead of silently vanishing.
      supabase
        .from('menu_items')
        .select('id, category_id, name, description, price, item_type, image_url, is_available, size_options')
        .eq('merchant_id', id)
        .order('name'),
    ]);

    // PRD analytics: view_menu fires when a restaurant profile is opened.
    logFoodEvent({
      eventName: 'view_menu',
      userId: req.userId || null,
      merchantId: id,
      params: { restaurant_id: id, cuisine_type: merchant.cuisine_type },
    });

    const { vertical, is_active, status, ...publicMerchant } = merchant;
    return res.json({
      restaurant: publicMerchant,
      categories: categories || [],
      items: items || [],
      deliveryFee: config.food.deliveryFeeSar,
      minOrder: config.food.minOrderSar,
    });
  } catch (err) {
    console.error('getRestaurant error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { listRestaurants, getRestaurant };
