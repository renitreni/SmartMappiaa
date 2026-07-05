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
  'id, name, cuisine_type, description, logo_url, address, lat, lng, service_radius_km';

async function listRestaurants(req, res) {
  try {
    const q = (req.query.q || '').toString().trim();
    const cuisine = (req.query.cuisine || '').toString().trim();

    let query = supabase
      .from('merchants')
      .select(PUBLIC_MERCHANT_FIELDS)
      .eq('is_active', true)
      .eq('status', 'active')
      .order('name')
      .limit(100);

    // Escape LIKE wildcards so user input can't turn into a pattern.
    if (q) query = query.ilike('name', `%${q.replace(/[%_]/g, '\\$&')}%`);
    if (cuisine) query = query.eq('cuisine_type', cuisine);

    const { data, error } = await query;
    if (error) {
      console.error('listRestaurants error:', error);
      return res.status(500).json({ error: 'Could not load restaurants' });
    }

    // Distinct cuisines drive the filter chips on the discovery screen.
    const { data: cuisines } = await supabase
      .from('merchants')
      .select('cuisine_type')
      .eq('is_active', true)
      .eq('status', 'active')
      .not('cuisine_type', 'is', null);

    return res.json({
      restaurants: data || [],
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
      .select(`${PUBLIC_MERCHANT_FIELDS}, is_active, status`)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('getRestaurant error:', error);
      return res.status(500).json({ error: 'Could not load the restaurant' });
    }
    if (!merchant || !merchant.is_active || merchant.status !== 'active') {
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
        .select('id, category_id, name, description, price, item_type, image_url, is_available')
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

    const { is_active, status, ...publicMerchant } = merchant;
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
