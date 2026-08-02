// ---------------------------------------------------------------------
// Ecommerce — public store discovery
//   - listStores : GET /api/shop/stores?q=&category=
//   - getStore   : GET /api/shop/stores/:id
//
// Public endpoints (no auth): they expose only listed, active stores and
// safe display fields. The optional bearer token is used purely to tag the
// view_store analytics event with a user id.
//
// TWO THINGS THE FOOD EQUIVALENT DOES NOT HAVE TO DO:
//   1. Every merchants query filters vertical = 'shop'. The table is shared
//      with Food Delivery; without the filter a restaurant would appear in
//      the storefront.
//   2. Nothing here may return net_price or stock_quantity. The backend
//      reads with the service role, so it CAN see both — the column grants
//      in 0029 only stop the anon key. Exact stock is sales velocity, so
//      the response carries a banded availability instead.
// ---------------------------------------------------------------------
const { supabase } = require('../../lib/supabase');
const { config } = require('../../lib/config');
const { logShopEvent } = require('../../lib/foodEvents');
const { availabilityBand } = require('../../lib/shopMoney');

const PUBLIC_STORE_FIELDS =
  'id, name, cuisine_type, description, logo_url, address, lat, lng, service_radius_km, is_featured, badge';

// Whitelist a catalogue row for public consumption. This function is the
// single place a product becomes customer-visible; net_price and
// stock_quantity are dropped here, deliberately, by omission from the
// returned object rather than by deleting keys.
function publicProduct(p) {
  return {
    id: p.id,
    categoryId: p.category_id,
    name: p.name,
    description: p.description,
    brand: p.brand,
    unit: p.unit,
    weightGrams: p.weight_grams,
    price: Number(p.price),
    imageUrl: p.image_url,
    isAvailable: p.is_available,
    availability: availabilityBand(p, p.track_stock),
    variants: (p.product_variants || [])
      .filter((v) => v.is_available)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({
        id: v.id,
        label: v.label,
        sku: v.sku,
        price: v.price != null ? Number(v.price) : Number(p.price),
        availability: availabilityBand(
          { stock_quantity: v.stock_quantity, low_stock_threshold: p.low_stock_threshold },
          p.track_stock
        ),
      })),
  };
}

// Real store ratings, aggregated from shop_ratings (product_rating).
// Returns Map(merchant_id -> { rating, reviewCount }); empty until customers
// actually review, and the storefront simply hides stars when there are none.
async function ratingsForStores(merchantIds) {
  const out = new Map();
  if (!merchantIds.length) return out;
  const { data, error } = await supabase
    .from('shop_ratings')
    .select('merchant_id, product_rating')
    .in('merchant_id', merchantIds);
  if (error) {
    console.error('ratingsForStores error:', error);
    return out;
  }
  const agg = new Map();
  for (const r of data || []) {
    const e = agg.get(r.merchant_id) || { sum: 0, n: 0 };
    e.sum += Number(r.product_rating) || 0;
    e.n += 1;
    agg.set(r.merchant_id, e);
  }
  for (const [mid, e] of agg) {
    out.set(mid, { rating: Math.round((e.sum / e.n) * 10) / 10, reviewCount: e.n });
  }
  return out;
}

async function listStores(req, res) {
  try {
    const q = (req.query.q || '').toString().trim();
    const category = (req.query.category || '').toString().trim();
    const featuredOnly = String(req.query.featured || '') === 'true';

    let query = supabase
      .from('merchants')
      .select(PUBLIC_STORE_FIELDS)
      .eq('vertical', 'shop')
      .eq('is_active', true)
      .eq('status', 'active')
      .order('is_featured', { ascending: false })
      .order('name')
      .limit(100);

    // Escape LIKE wildcards so user input can't turn into a pattern.
    if (q) query = query.ilike('name', `%${q.replace(/[%_]/g, '\\$&')}%`);
    if (category) query = query.eq('cuisine_type', category);
    if (featuredOnly) query = query.eq('is_featured', true);

    const { data, error } = await query;
    if (error) {
      console.error('listStores error:', error);
      return res.status(500).json({ error: 'Could not load stores' });
    }

    // Distinct store categories drive the filter chips on discovery.
    const { data: categories } = await supabase
      .from('merchants')
      .select('cuisine_type')
      .eq('vertical', 'shop')
      .eq('is_active', true)
      .eq('status', 'active')
      .not('cuisine_type', 'is', null);

    const ratingMap = await ratingsForStores((data || []).map((m) => m.id));

    return res.json({
      stores: (data || []).map((m) => {
        const r = ratingMap.get(m.id);
        return { ...m, rating: r ? r.rating : null, reviewCount: r ? r.reviewCount : 0 };
      }),
      categories: [...new Set((categories || []).map((c) => c.cuisine_type).filter(Boolean))].sort(),
      deliveryFee: config.shop.deliveryFeeSar,
      minOrder: config.shop.minOrderSar,
    });
  } catch (err) {
    console.error('listStores error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function getStore(req, res) {
  try {
    const { id } = req.params;
    const { data: store, error } = await supabase
      .from('merchants')
      .select(`${PUBLIC_STORE_FIELDS}, vertical, is_active, status`)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('getStore error:', error);
      return res.status(500).json({ error: 'Could not load the store' });
    }
    // A food merchant reached by id is a 404 here, not a 403 — the storefront
    // must not confirm that some other kind of merchant exists at that id.
    if (!store || store.vertical !== 'shop' || !store.is_active || store.status !== 'active') {
      return res.status(404).json({ error: 'Store not found or currently closed' });
    }

    const [{ data: categories }, { data: products }] = await Promise.all([
      supabase
        .from('product_categories')
        .select('id, name, sort_order')
        .eq('merchant_id', id)
        .eq('is_active', true)
        .order('sort_order'),
      // Unavailable products are included, flagged, so the catalogue can
      // render them greyed out instead of silently vanishing.
      supabase
        .from('products')
        .select(
          'id, category_id, name, description, brand, unit, weight_grams, price, image_url, ' +
            'is_available, track_stock, stock_quantity, low_stock_threshold, ' +
            'product_variants ( id, label, sku, price, stock_quantity, sort_order, is_available )'
        )
        .eq('merchant_id', id)
        .order('name'),
    ]);

    logShopEvent({
      eventName: 'view_store',
      userId: req.userId || null,
      merchantId: id,
      params: { store_id: id, category: store.cuisine_type },
    });

    const { vertical, is_active, status, ...publicStore } = store;
    return res.json({
      store: publicStore,
      categories: categories || [],
      products: (products || []).map(publicProduct),
      deliveryFee: config.shop.deliveryFeeSar,
      minOrder: config.shop.minOrderSar,
    });
  } catch (err) {
    console.error('getStore error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { listStores, getStore, publicProduct, PUBLIC_STORE_FIELDS };
