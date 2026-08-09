// ---------------------------------------------------------------------
// Food Delivery — admin oversight (extends routes/admin.js)
//   - getOverview       : GET  /api/admin/food/overview
//   - listMerchants     : GET  /api/admin/food/merchants
//   - suspendMerchant   : POST /api/admin/food/merchants/:id/suspend
//   - reactivateMerchant: POST /api/admin/food/merchants/:id/reactivate
//   - replenishCredit   : POST /api/admin/food/merchants/:id/credit
//   - getMerchantMenu   : GET  /api/admin/food/merchants/:id/menu
//   - moderateItem      : PATCH/DELETE /api/admin/food/items/:id
//   - listOrders        : GET  /api/admin/food/orders
//   - verifyPayment     : POST /api/admin/food/orders/:code/verify-payment
//   - rejectPayment     : POST /api/admin/food/orders/:code/reject-payment
//
// Every action here is a privileged admin operation -> audit-logged.
// ---------------------------------------------------------------------
const { supabase } = require('../../lib/supabase');
const { config } = require('../../lib/config');
const { round2 } = require('../../lib/foodMoney');
const { logFoodEvent } = require('../../lib/foodEvents');
const { logAudit } = require('../../lib/audit');
const { logNotification } = require('../../lib/notifications');
const { pushFoodOrderStatus, pushMerchantFeed, pingFoodAdmin } = require('../../lib/realtime');
const { markOrderPaid } = require('./ordersController');
const {
  acceptOrderCore,
  rejectOrderCore,
  advanceOrderStatusCore,
} = require('../../lib/foodOrderActions');
const {
  buildMerchantImagePath,
  createMerchantImageUploadUrl,
  merchantImagePublicUrl,
  createProofDownloadUrl,
} = require('../../lib/storage');
const { validateImageFile, validateMenuImageFile } = require('../../lib/uploadValidation');
const { normalizeSizeOptions } = require('../../lib/foodSizes');
const { passwordError } = require('../../lib/validate');
const { resolveOwnerProfile } = require('../../lib/merchantOwner');

// Credit summary for a restaurant (used / limit / warning / suspended).
function creditView(merchant) {
  const limit = Number(merchant.credit_limit);
  const used = round2(Number(merchant.credit_used));
  const alertAt = round2(limit * config.food.creditAlertPct);
  return {
    creditLimit: limit,
    creditUsed: used,
    creditRemaining: round2(Math.max(0, limit - used)),
    alertAt,
    warning: used >= alertAt && used < limit,
    exhausted: used >= limit,
    suspended: merchant.status === 'suspended',
  };
}

// --- Overview ---------------------------------------------------------
async function getOverview(req, res) {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [orders, todayOrders, merchants, pendingPayments] = await Promise.all([
      supabase.from('orders').select('status, platform_margin_total, total', { count: 'exact' }),
      supabase.from('orders').select('id', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString()),
      // merchants is shared with the Ecommerce vertical (0026) — the Food
      // overview must count restaurants only.
      supabase.from('merchants').select('status, credit_used, credit_limit').eq('vertical', 'food'),
      supabase.from('orders').select('id', { count: 'exact', head: true })
        .eq('payment_status', 'awaiting'),
    ]);

    const rows = orders.data || [];
    // Platform revenue = the per-item margins of orders that went through
    // (everything a merchant accepted; rejected/cancelled never charged).
    const revenueRows = rows.filter((o) => !['pending', 'cancelled', 'rejected'].includes(o.status));
    const merchantsRows = merchants.data || [];

    return res.json({
      totalOrders: orders.count || 0,
      todayOrders: todayOrders.count || 0,
      delivered: rows.filter((o) => o.status === 'delivered').length,
      pending: rows.filter((o) => o.status === 'pending').length,
      revenue: round2(revenueRows.reduce((sum, o) => sum + Number(o.platform_margin_total || 0), 0)),
      orderVolume: round2(revenueRows.reduce((sum, o) => sum + Number(o.total || 0), 0)),
      merchants: merchantsRows.length,
      suspendedMerchants: merchantsRows.filter((m) => m.status === 'suspended').length,
      atCreditWarning: merchantsRows.filter(
        (m) => Number(m.credit_used) >= Number(m.credit_limit) * 0.8 && m.status !== 'suspended'
      ).length,
      paymentsAwaitingReview: pendingPayments.count || 0,
    });
  } catch (err) {
    console.error('food getOverview error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Merchant management ------------------------------------------------
async function listMerchants(req, res) {
  try {
    // Restaurants are admin-run; owner_id is linked at contract signing and is
    // used to show the "owner account" status in the admin UI (and to target
    // owner notifications).
    const { data, error } = await supabase
      .from('merchants')
      .select(
        'id, name, cuisine_type, description, logo_url, address, street, building_number, lat, lng, is_active, status, ' +
          'credit_limit, credit_used, is_featured, badge, owner_id, created_at'
      )
      .eq('vertical', 'food')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('food listMerchants error:', error);
      return res.status(500).json({ error: 'Could not load merchants' });
    }

    // Resolve owner emails in one query so the UI can show who is linked.
    const ownerIds = [...new Set((data || []).map((m) => m.owner_id).filter(Boolean))];
    const ownerEmailById = new Map();
    if (ownerIds.length) {
      const { data: owners } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', ownerIds);
      for (const o of owners || []) ownerEmailById.set(o.id, o.email);
    }

    return res.json({
      merchants: (data || []).map((m) => ({
        id: m.id,
        name: m.name,
        cuisineType: m.cuisine_type,
        description: m.description,
        logoUrl: m.logo_url,
        address: m.address,
        street: m.street,
        buildingNumber: m.building_number,
        lat: m.lat,
        lng: m.lng,
        isActive: m.is_active,
        status: m.status,
        creditLimit: Number(m.credit_limit),
        creditUsed: round2(Number(m.credit_used)),
        isFeatured: m.is_featured,
        badge: m.badge,
        ownerId: m.owner_id,
        ownerEmail: m.owner_id ? ownerEmailById.get(m.owner_id) || null : null,
        createdAt: m.created_at,
      })),
    });
  } catch (err) {
    console.error('food listMerchants error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// Scoped to the food vertical on purpose. This backs every admin Food-tab
// handler that acts on a single merchant (update, delete, suspend,
// reactivate, credit, owner provisioning, menu CRUD). merchants is shared
// with Ecommerce since 0026, so without the filter an admin could reach a
// STORE through the Food tab and suspend it, replenish its credit, or
// attach a menu to it — all of which would look like they worked.
// Returning null instead means the caller's existing 404 path handles it.
async function loadMerchant(id) {
  const { data } = await supabase
    .from('merchants')
    .select('*')
    .eq('id', id)
    .eq('vertical', 'food')
    .maybeSingle();
  return data;
}

// --- Admin-driven onboarding: restaurants contact SmartMappia and an admin
// creates them + imports the menu. owner_id is linked later (nullable).

const ADMIN_MERCHANT_SELECT =
  'id, name, cuisine_type, description, logo_url, address, street, building_number, lat, lng, ' +
  'is_active, status, credit_limit, credit_used, is_featured, badge, owner_id, created_at';

async function createMerchant(req, res) {
  try {
    // Location is mandatory so drivers know where to pick up and the 15 km
    // delivery radius is enforceable (an unpinned merchant would bypass it).
    if (!Number.isFinite(req.body.lat) || !Number.isFinite(req.body.lng)) {
      return res.status(400).json({
        error: 'Restaurant location is required',
        failure_reason: 'restaurant_location_required',
      });
    }
    const { data, error } = await supabase
      .from('merchants')
      // vertical is set explicitly, NOT taken from req.body: the route schema
      // does not declare it, so an admin creating a restaurant here can never
      // accidentally (or deliberately) mint a store through the Food tab.
      .insert({ ...req.body, vertical: 'food' }) // whitelisted by the route schema; unlisted by default
      .select(ADMIN_MERCHANT_SELECT)
      .single();
    if (error) {
      console.error('admin createMerchant error:', error);
      return res.status(500).json({ error: 'Could not create the restaurant' });
    }
    logAudit({
      actorId: req.adminId,
      action: 'admin_merchant_created',
      resourceType: 'merchant',
      resourceId: data.id,
      meta: { name: data.name },
    });
    return res.status(201).json({ merchant: data });
  } catch (err) {
    console.error('admin createMerchant error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function updateMerchant(req, res) {
  try {
    const current = await loadMerchant(req.params.id);
    if (!current) return res.status(404).json({ error: 'Merchant not found' });

    // A restaurant cannot be listed (visible + orderable) without a pin.
    // The route already rejects an explicit null lat/lng, so this only bites
    // legacy unpinned rows: they must be pinned in the same request that
    // lists them (or before). Unlisting / other edits stay unblocked.
    const nextLat = req.body.lat != null ? req.body.lat : current.lat;
    const nextLng = req.body.lng != null ? req.body.lng : current.lng;
    const willBeActive = req.body.is_active != null ? req.body.is_active : current.is_active;
    if (willBeActive && (!Number.isFinite(nextLat) || !Number.isFinite(nextLng))) {
      return res.status(400).json({
        error: 'Set the restaurant location before listing it',
        failure_reason: 'restaurant_location_required',
      });
    }

    const { data, error } = await supabase
      .from('merchants')
      .update(req.body) // may include is_active — listing/unlisting the restaurant
      .eq('id', req.params.id)
      .select(ADMIN_MERCHANT_SELECT)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Merchant not found' });
    logAudit({
      actorId: req.adminId,
      action: 'admin_merchant_updated',
      resourceType: 'merchant',
      resourceId: req.params.id,
      meta: req.body,
    });
    return res.json({ merchant: data });
  } catch (err) {
    console.error('admin updateMerchant error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function deleteMerchant(req, res) {
  try {
    // Refuse while live orders exist — history stays intact otherwise
    // because orders reference merchants with ON DELETE RESTRICT.
    const { count } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', req.params.id)
      .in('status', ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery']);
    if (count > 0) {
      return res.status(409).json({ error: 'This restaurant still has live orders' });
    }

    const { error } = await supabase.from('merchants').delete().eq('id', req.params.id);
    if (error) {
      // FK restrict from historical orders: unlist instead of deleting.
      return res.status(409).json({
        error: 'This restaurant has order history and cannot be deleted. Unlist it instead.',
      });
    }
    logAudit({
      actorId: req.adminId,
      action: 'admin_merchant_deleted',
      resourceType: 'merchant',
      resourceId: req.params.id,
    });
    return res.json({ deleted: true });
  } catch (err) {
    console.error('admin deleteMerchant error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Admin menu import/CRUD (any restaurant) --------------------------------

async function addCategoryForMerchant(req, res) {
  try {
    const merchant = await loadMerchant(req.params.id);
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
    const { data, error } = await supabase
      .from('menu_categories')
      .insert({ merchant_id: merchant.id, ...req.body })
      .select('id, name, sort_order, is_active')
      .single();
    if (error) {
      console.error('admin addCategory error:', error);
      return res.status(500).json({ error: 'Could not create the category' });
    }
    logAudit({
      actorId: req.adminId,
      action: 'admin_menu_category_created',
      resourceType: 'merchant',
      resourceId: merchant.id,
      meta: { name: data.name },
    });
    return res.status(201).json({ category: data });
  } catch (err) {
    console.error('admin addCategory error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function updateAnyCategory(req, res) {
  try {
    const { data, error } = await supabase
      .from('menu_categories')
      .update(req.body)
      .eq('id', req.params.id)
      .select('id, name, sort_order, is_active')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Category not found' });
    return res.json({ category: data });
  } catch (err) {
    console.error('admin updateCategory error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function deleteAnyCategory(req, res) {
  try {
    const { error } = await supabase.from('menu_categories').delete().eq('id', req.params.id);
    if (error) {
      console.error('admin deleteCategory error:', error);
      return res.status(500).json({ error: 'Could not delete the category' });
    }
    return res.json({ deleted: true });
  } catch (err) {
    console.error('admin deleteCategory error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function addItemForMerchant(req, res) {
  try {
    const merchant = await loadMerchant(req.params.id);
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
    const b = req.body;
    // Markup must be >= 0: the restaurant's net can't exceed the list price.
    // (DB CHECK backs this up; this yields a clean 400 instead of a 500.)
    if (b.net_price != null && Number(b.net_price) > Number(b.price)) {
      return res.status(400).json({ error: 'net_price must be <= price' });
    }
    if ('size_options' in b) {
      const sized = normalizeSizeOptions(b.size_options);
      if (!sized.ok) return res.status(400).json({ error: sized.error });
      b.size_options = sized.value;
    }
    if (b.category_id) {
      const { data: cat } = await supabase
        .from('menu_categories')
        .select('id, merchant_id')
        .eq('id', b.category_id)
        .maybeSingle();
      if (!cat || cat.merchant_id !== merchant.id) {
        return res.status(400).json({ error: 'category_id does not belong to this restaurant' });
      }
    }
    const { data, error } = await supabase
      .from('menu_items')
      .insert({ merchant_id: merchant.id, ...b })
      .select('id, category_id, name, description, price, net_price, item_type, image_url, is_available, size_options')
      .single();
    if (error) {
      console.error('admin addItem error:', error);
      return res.status(500).json({ error: 'Could not create the item' });
    }
    logAudit({
      actorId: req.adminId,
      action: 'admin_menu_item_created',
      resourceType: 'merchant',
      resourceId: merchant.id,
      meta: { name: data.name, price: data.price },
    });
    return res.status(201).json({ item: data });
  } catch (err) {
    console.error('admin addItem error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function suspendMerchant(req, res) {
  try {
    const merchant = await loadMerchant(req.params.id);
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

    const { error } = await supabase
      .from('merchants')
      .update({ status: 'suspended' })
      .eq('id', merchant.id);
    if (error) {
      console.error('suspendMerchant error:', error);
      return res.status(500).json({ error: 'Could not suspend the merchant' });
    }

    logAudit({
      actorId: req.adminId,
      action: 'admin_merchant_suspended',
      resourceType: 'merchant',
      resourceId: merchant.id,
      meta: { reason: (req.body && req.body.reason) || null },
    });
    logFoodEvent({
      eventName: 'service_suspended',
      merchantId: merchant.id,
      params: { final_balance: Number(merchant.credit_used), merchant_id: merchant.id },
    });
    logNotification({ userId: merchant.owner_id, type: 'service_suspended' });
    pushMerchantFeed(merchant.id, 'merchant_update', { status: 'suspended' });

    return res.json({ id: merchant.id, status: 'suspended' });
  } catch (err) {
    console.error('suspendMerchant error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function reactivateMerchant(req, res) {
  try {
    const merchant = await loadMerchant(req.params.id);
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

    const { error } = await supabase
      .from('merchants')
      .update({ status: 'active' })
      .eq('id', merchant.id);
    if (error) {
      console.error('reactivateMerchant error:', error);
      return res.status(500).json({ error: 'Could not reactivate the merchant' });
    }

    logAudit({
      actorId: req.adminId,
      action: 'admin_merchant_reactivated',
      resourceType: 'merchant',
      resourceId: merchant.id,
    });
    pushMerchantFeed(merchant.id, 'merchant_update', { status: 'active' });
    return res.json({ id: merchant.id, status: 'active' });
  } catch (err) {
    console.error('reactivateMerchant error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// POST /api/admin/food/merchants/:id/credit { amount, note } — reconcile:
// the merchant settled (part of) what they owe, so credit_used goes DOWN.
async function replenishCredit(req, res) {
  try {
    const merchant = await loadMerchant(req.params.id);
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

    const amount = round2(Number(req.body.amount));
    const newUsed = round2(Math.max(0, Number(merchant.credit_used) - amount));
    // Dropping back under the limit lifts an automatic (credit) suspension.
    const newStatus =
      merchant.status === 'suspended' && newUsed < Number(merchant.credit_limit)
        ? 'active'
        : merchant.status;

    const { error: updErr } = await supabase
      .from('merchants')
      .update({ credit_used: newUsed, status: newStatus })
      .eq('id', merchant.id)
      .eq('credit_used', merchant.credit_used); // CAS against a racing accept
    if (updErr) {
      console.error('replenishCredit update error:', updErr);
      return res.status(500).json({ error: 'Could not update the credit' });
    }

    await supabase.from('merchant_credit_ledger').insert({
      merchant_id: merchant.id,
      type: 'replenish',
      amount,
      balance_after: newUsed,
      note: (req.body && req.body.note) || null,
      created_by: req.adminId,
    });

    logAudit({
      actorId: req.adminId,
      action: 'admin_merchant_credit_replenished',
      resourceType: 'merchant',
      resourceId: merchant.id,
      meta: { amount, credit_used_after: newUsed },
    });
    logNotification({ userId: merchant.owner_id, type: 'credit_replenished' });
    pushMerchantFeed(merchant.id, 'merchant_update', { status: newStatus, creditUsed: newUsed });

    return res.json({
      id: merchant.id,
      status: newStatus,
      credit: creditView({ ...merchant, credit_used: newUsed, status: newStatus }),
    });
  } catch (err) {
    console.error('replenishCredit error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Catalog oversight ----------------------------------------------------
async function getMerchantMenu(req, res) {
  try {
    const merchant = await loadMerchant(req.params.id);
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

    const [{ data: categories }, { data: items }] = await Promise.all([
      supabase
        .from('menu_categories')
        .select('id, name, sort_order, is_active')
        .eq('merchant_id', merchant.id)
        .order('sort_order'),
      supabase
        .from('menu_items')
        .select('id, category_id, name, description, price, net_price, item_type, image_url, is_available, size_options')
        .eq('merchant_id', merchant.id)
        .order('name'),
    ]);
    return res.json({
      merchant: { id: merchant.id, name: merchant.name },
      categories: categories || [],
      items: items || [],
    });
  } catch (err) {
    console.error('getMerchantMenu error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function moderateItem(req, res) {
  try {
    const b = req.body;
    if ('size_options' in b) {
      const sized = normalizeSizeOptions(b.size_options);
      if (!sized.ok) return res.status(400).json({ error: sized.error });
      b.size_options = sized.value;
    }
    // Guard markup >= 0 (net_price <= price). EITHER field may arrive alone on a
    // PATCH — including a price-only lowering below a stored net_price — so
    // resolve the effective PAIR: a field PRESENT in the body (even an explicit
    // null, which CLEARS net_price — validateBody keeps nullable nulls) wins;
    // an ABSENT field falls back to the stored row. Reject with a clean 400 up
    // front rather than the DB CHECK's confusing error.
    const hasNet = 'net_price' in b;
    const hasPrice = 'price' in b;
    if (hasNet || hasPrice) {
      let current = null;
      if (!hasNet || !hasPrice) {
        const { data: row } = await supabase
          .from('menu_items')
          .select('price, net_price')
          .eq('id', req.params.id)
          .maybeSingle();
        if (!row) return res.status(404).json({ error: 'Menu item not found' });
        current = row;
      }
      const effPrice = hasPrice ? Number(b.price) : Number(current.price);
      const effNet = hasNet
        ? (b.net_price == null ? null : Number(b.net_price))
        : current.net_price == null ? null : Number(current.net_price);
      if (effNet != null && effNet > effPrice) {
        return res.status(400).json({ error: 'net_price must be <= price' });
      }
    }
    const { data, error } = await supabase
      .from('menu_items')
      .update(req.body)
      .eq('id', req.params.id)
      .select('id, name, price, net_price, is_available, size_options')
      .single();
    // 23514 = the net_price <= price CHECK — surface it as a clean 400, not a 404.
    if (error && error.code === '23514') {
      return res.status(400).json({ error: 'net_price must be <= price' });
    }
    if (error || !data) return res.status(404).json({ error: 'Menu item not found' });

    logAudit({
      actorId: req.adminId,
      action: 'admin_menu_item_moderated',
      resourceType: 'menu_item',
      resourceId: req.params.id,
      meta: req.body,
    });
    return res.json({ item: data });
  } catch (err) {
    console.error('moderateItem error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function removeItem(req, res) {
  try {
    const { error } = await supabase.from('menu_items').delete().eq('id', req.params.id);
    if (error) {
      console.error('admin removeItem error:', error);
      return res.status(500).json({ error: 'Could not delete the item' });
    }
    logAudit({
      actorId: req.adminId,
      action: 'admin_menu_item_deleted',
      resourceType: 'menu_item',
      resourceId: req.params.id,
    });
    return res.json({ deleted: true });
  } catch (err) {
    console.error('admin removeItem error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Orders + payment reconciliation ---------------------------------------
async function listOrders(req, res) {
  try {
    const paymentStatus = (req.query.payment_status || '').toString();
    const status = (req.query.status || '').toString();

    let query = supabase
      .from('orders')
      .select(
        'id, order_code, status, payment_status, payment_method, subtotal, delivery_fee, ' +
          'platform_margin_total, vat_amount, total, delivery_address, delivery_street, delivery_building, contact_phone, created_at, accepted_at, ' +
          'merchants ( id, name ), profiles!orders_customer_id_fkey ( full_name, mobile_number ), ' +
          'deliveries ( driver_id, status, pickup_photo_path, delivery_photo_path, profiles ( full_name ) ), ' +
          'order_items ( name_snapshot, size_snapshot, quantity, line_total )'
      )
      .order('created_at', { ascending: false })
      .limit(100);
    if (paymentStatus) query = query.eq('payment_status', paymentStatus);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      console.error('admin food listOrders error:', error);
      return res.status(500).json({ error: 'Could not load orders' });
    }

    // Fetch the proof references for awaiting STC payments in one shot.
    const awaitingIds = (data || [])
      .filter((o) => o.payment_status === 'awaiting')
      .map((o) => o.id);
    const { data: payments } = awaitingIds.length
      ? await supabase
          .from('order_payments')
          .select('order_id, gateway_transaction_id, gateway_raw, created_at')
          .in('order_id', awaitingIds)
          .eq('status', 'awaiting')
          .order('created_at', { ascending: false })
      : { data: [] };
    const latestPayment = new Map();
    for (const p of payments || []) {
      if (!latestPayment.has(p.order_id)) latestPayment.set(p.order_id, p);
    }

    // Short-lived signed download URLs so the admin can VIEW the uploaded
    // STC Pay screenshots (mirrors the rides implementation). Best-effort:
    // a broken path must not take the whole list down.
    const proofUrlByOrder = new Map();
    await Promise.all(
      [...latestPayment.entries()].map(async ([orderId, p]) => {
        const proofPath = p.gateway_raw && p.gateway_raw.proof_path;
        if (!proofPath) return;
        try {
          proofUrlByOrder.set(orderId, await createProofDownloadUrl(proofPath));
        } catch (urlErr) {
          console.error('food listOrders proof url error:', urlErr.message || urlErr);
        }
      })
    );

    logAudit({ actorId: req.adminId, action: 'admin_food_orders_read', resourceType: 'orders' });
    return res.json({
      orders: (data || []).map((o) => {
        const payment = latestPayment.get(o.id);
        const delivery = Array.isArray(o.deliveries) ? o.deliveries[0] : o.deliveries;
        return {
          orderCode: o.order_code,
          status: o.status,
          paymentStatus: o.payment_status,
          paymentMethod: o.payment_method,
          subtotal: o.subtotal,
          deliveryFee: o.delivery_fee,
          marginTotal: o.platform_margin_total,
          vatAmount: o.vat_amount,
          total: o.total,
          deliveryAddress: o.delivery_address,
          deliveryStreet: o.delivery_street,
          deliveryBuilding: o.delivery_building,
          merchantId: o.merchants ? o.merchants.id : null,
          merchantName: o.merchants ? o.merchants.name : null,
          customerName: o.profiles ? o.profiles.full_name : null,
          // Prefer the order's own (editable) contact number over the profile.
          customerMobile: o.contact_phone || (o.profiles ? o.profiles.mobile_number : null),
          items: o.order_items || [],
          riderName: delivery && delivery.profiles ? delivery.profiles.full_name : null,
          deliveryStatus: delivery ? delivery.status : null,
          hasPickupPhoto: !!(delivery && delivery.pickup_photo_path),
          hasDeliveryPhoto: !!(delivery && delivery.delivery_photo_path),
          paymentReference: payment ? payment.gateway_transaction_id : null,
          proofPath: payment && payment.gateway_raw ? payment.gateway_raw.proof_path : null,
          proofUrl: proofUrlByOrder.get(o.id) || null,
          createdAt: o.created_at,
          acceptedAt: o.accepted_at,
        };
      }),
    });
  } catch (err) {
    console.error('admin food listOrders error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function loadOrderByCode(code) {
  const { data } = await supabase.from('orders').select('*').eq('order_code', code).maybeSingle();
  return data;
}

// POST /api/admin/food/orders/:code/assign-driver { driver_id }
// Grab-style rider leg: attach an approved Pick & Drop driver to the food
// order. The customer's tracking page immediately shows the rider's name
// and call/WhatsApp contact (pushed over the fd-order channel).
async function assignDriver(req, res) {
  try {
    const order = await loadOrderByCode(req.params.code);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (['delivered', 'cancelled', 'rejected'].includes(order.status)) {
      return res.status(409).json({ error: `Cannot assign a rider to a ${order.status} order` });
    }

    const { data: driver } = await supabase
      .from('profiles')
      .select('id, role, full_name, whatsapp_number, mobile_number, driver_approved')
      .eq('id', req.body.driver_id)
      .maybeSingle();
    if (!driver || driver.role !== 'driver') {
      return res.status(404).json({ error: 'Driver not found' });
    }
    if (!driver.driver_approved) {
      return res.status(409).json({ error: 'This driver is not approved yet' });
    }

    const { error: upsertErr } = await supabase.from('deliveries').upsert(
      {
        order_id: order.id,
        driver_id: driver.id,
        fee: order.delivery_fee,
        status: 'assigned',
      },
      { onConflict: 'order_id' }
    );
    if (upsertErr) {
      console.error('food assignDriver upsert error:', upsertErr);
      return res.status(500).json({ error: 'Could not assign the rider' });
    }

    logAudit({
      actorId: req.adminId,
      action: 'admin_food_driver_assigned',
      resourceType: 'order',
      resourceId: order.order_code,
      meta: { driver_id: driver.id },
    });
    logNotification({
      userId: order.customer_id,
      orderId: order.id,
      type: 'food_rider_assigned',
      code: order.order_code,
      url: `/food/track/${order.order_code}`,
    });
    logNotification({
      userId: driver.id,
      orderId: order.id,
      type: 'food_delivery_assigned',
      code: order.order_code,
      url: '/driver',
    });
    // Live update for the customer's tracking page: safe rider fields only.
    pushFoodOrderStatus(order.order_code, {
      status: order.status,
      rider: {
        name: driver.full_name,
        whatsapp: driver.whatsapp_number,
        mobile: driver.mobile_number,
        status: 'assigned',
      },
    });
    pushMerchantFeed(order.merchant_id, 'order_update', {
      orderCode: order.order_code,
      riderAssigned: true,
    });
    pingFoodAdmin(order.order_code);

    return res.json({
      orderCode: order.order_code,
      rider: { id: driver.id, name: driver.full_name },
    });
  } catch (err) {
    console.error('food assignDriver error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function verifyPayment(req, res) {
  try {
    const order = await loadOrderByCode(req.params.code);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status === 'paid') {
      return res.status(409).json({ error: 'Payment is already verified' });
    }

    // Promote the awaiting proof row (if any) to paid, then mark the order.
    // When a proof row exists it becomes THE payment record, so tell
    // markOrderPaid not to insert a second (duplicate) paid row.
    const { data: promoted } = await supabase
      .from('order_payments')
      .update({ status: 'paid' })
      .eq('order_id', order.id)
      .eq('status', 'awaiting')
      .select('id');
    await markOrderPaid(order, {
      provider: order.payment_method,
      transactionId: order.gateway_transaction_id,
      actorId: req.adminId,
      skipPaymentRow: !!(promoted && promoted.length),
    });

    return res.json({ orderCode: order.order_code, paymentStatus: 'paid' });
  } catch (err) {
    console.error('food verifyPayment error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function rejectPayment(req, res) {
  try {
    const order = await loadOrderByCode(req.params.code);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status === 'paid') {
      return res.status(409).json({ error: 'Payment is already verified; refund instead' });
    }

    await supabase
      .from('order_payments')
      .update({ status: 'failed' })
      .eq('order_id', order.id)
      .eq('status', 'awaiting');
    await supabase.from('orders').update({ payment_status: 'failed' }).eq('id', order.id);

    logAudit({
      actorId: req.adminId,
      action: 'admin_food_payment_rejected',
      resourceType: 'order',
      resourceId: order.order_code,
      meta: { reason: (req.body && req.body.reason) || null },
    });
    pushFoodOrderStatus(order.order_code, { paymentStatus: 'failed' });
    pingFoodAdmin(order.order_code);
    logNotification({ userId: order.customer_id, type: 'food_payment_rejected' });

    return res.json({ orderCode: order.order_code, paymentStatus: 'failed' });
  } catch (err) {
    console.error('food rejectPayment error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Order operations (admin-run restaurants: no owner accounts exist, so
// admins accept/reject/advance orders on the restaurant's behalf) ----------

// POST /api/admin/food/orders/:code/accept — THE credit-gated action.
// HARD RULE (PRD §7): a restaurant whose credit_used has reached the 300 SAR
// limit cannot take new orders (403). Accepting charges the order's platform
// margin to the ledger; crossing 80% (240) alerts once; hitting the limit
// suspends the restaurant until reconciled.
async function acceptOrder(req, res) {
  try {
    const { httpStatus, body } = await acceptOrderCore({
      orderCode: req.params.code,
      actorId: req.adminId,
      actorRole: 'admin',
    });
    return res.status(httpStatus).json(body);
  } catch (err) {
    console.error('admin acceptOrder error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function rejectOrder(req, res) {
  try {
    const { httpStatus, body } = await rejectOrderCore({
      orderCode: req.params.code,
      actorId: req.adminId,
      actorRole: 'admin',
      reason: (req.body && req.body.reason) || null,
    });
    return res.status(httpStatus).json(body);
  } catch (err) {
    console.error('admin rejectOrder error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function advanceOrderStatus(req, res) {
  try {
    const { httpStatus, body } = await advanceOrderStatusCore({
      orderCode: req.params.code,
      actorId: req.adminId,
      actorRole: 'admin',
      status: req.body.status,
    });
    return res.status(httpStatus).json(body);
  } catch (err) {
    console.error('admin advanceOrderStatus error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// GET /api/admin/food/orders/:code/photos — short-lived signed URLs for the
// rider's mandatory pickup/delivery proof photos (private bucket).
async function getOrderPhotos(req, res) {
  try {
    const order = await loadOrderByCode(req.params.code);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { data: delivery } = await supabase
      .from('deliveries')
      .select('pickup_photo_path, delivery_photo_path')
      .eq('order_id', order.id)
      .maybeSingle();
    if (!delivery) return res.json({ pickup: null, delivery: null });

    const { createProofDownloadUrl } = require('../../lib/storage');
    const [pickup, deliveryPhoto] = await Promise.all([
      delivery.pickup_photo_path ? createProofDownloadUrl(delivery.pickup_photo_path) : null,
      delivery.delivery_photo_path ? createProofDownloadUrl(delivery.delivery_photo_path) : null,
    ]);

    logAudit({
      actorId: req.adminId,
      action: 'admin_food_delivery_photos_viewed',
      resourceType: 'order',
      resourceId: order.order_code,
    });
    return res.json({ pickup, delivery: deliveryPhoto });
  } catch (err) {
    console.error('getOrderPhotos error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// POST /api/admin/food/orders/:code/cancel — customer-support cancellation.
// If the order was already paid it enters the refund queue (the customer is
// told refunds take a few hours up to one day; /refund below closes it).
async function cancelOrder(req, res) {
  try {
    const order = await loadOrderByCode(req.params.code);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (['delivered', 'cancelled', 'rejected'].includes(order.status)) {
      return res.status(409).json({ error: `Order is already ${order.status}` });
    }

    const { data: rows } = await supabase
      .from('orders')
      .update({ status: 'cancelled', reject_reason: (req.body && req.body.reason) || null })
      .eq('id', order.id)
      .eq('status', order.status)
      .select('order_code');
    if (!rows || rows.length === 0) {
      return res.status(409).json({ error: 'Order changed — please refresh' });
    }

    // Withdraw any live rider offer for this order.
    await supabase
      .from('dispatch_offers')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .eq('order_id', order.id)
      .eq('status', 'pending');

    logAudit({
      actorId: req.adminId,
      action: 'admin_food_order_cancelled',
      resourceType: 'order',
      resourceId: order.order_code,
      meta: { reason: (req.body && req.body.reason) || null, was_paid: order.payment_status === 'paid' },
    });
    pushFoodOrderStatus(order.order_code, { status: 'cancelled' });
    pushMerchantFeed(order.merchant_id, 'order_update', { orderCode: order.order_code, status: 'cancelled' });
    pingFoodAdmin(order.order_code);
    logNotification({ userId: order.customer_id, type: 'food_order_cancelled' });

    return res.json({
      orderCode: order.order_code,
      status: 'cancelled',
      refundDue: order.payment_status === 'paid',
    });
  } catch (err) {
    console.error('food cancelOrder error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// POST /api/admin/food/orders/:code/refund — close the refund after the
// money was actually returned (policy: within a few hours up to one day).
async function refundPayment(req, res) {
  try {
    const order = await loadOrderByCode(req.params.code);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status !== 'paid') {
      return res.status(409).json({ error: `Payment is ${order.payment_status}; nothing to refund` });
    }
    if (!['cancelled', 'rejected'].includes(order.status)) {
      return res.status(409).json({ error: 'Only cancelled or rejected orders can be refunded' });
    }

    await supabase
      .from('order_payments')
      .update({ status: 'refunded' })
      .eq('order_id', order.id)
      .eq('status', 'paid');
    await supabase.from('orders').update({ payment_status: 'refunded' }).eq('id', order.id);

    logAudit({
      actorId: req.adminId,
      action: 'admin_food_payment_refunded',
      resourceType: 'order',
      resourceId: order.order_code,
      meta: { amount: Number(order.total) },
    });
    pushFoodOrderStatus(order.order_code, { paymentStatus: 'refunded' });
    pingFoodAdmin(order.order_code);
    logNotification({ userId: order.customer_id, type: 'food_payment_refunded' });

    return res.json({ orderCode: order.order_code, paymentStatus: 'refunded' });
  } catch (err) {
    console.error('food refundPayment error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Merchant images (logo + menu photos) ----------------------------------
// The browser uploads straight to the PUBLIC `merchant-images` bucket via a
// short-lived signed URL, then persists the returned publicUrl into
// merchants.logo_url / menu_items.image_url through the normal update endpoints.
//
// POST /api/admin/food/merchants/:id/image/signed-url
//   body: { kind: 'logo' | 'item', file_name, mime_type }
async function createMerchantImageUploadUrlHandler(req, res) {
  try {
    const { kind, file_name, mime_type } = req.body || {};
    if (!config.merchantImages.kinds.includes(kind)) {
      return res.status(400).json({
        error: `kind is required and must be one of: ${config.merchantImages.kinds.join(', ')}`,
      });
    }
    // Same rules the merchant portal uses: logos allow JPG/PNG/WebP, menu photos
    // are JPG/PNG only.
    const validate = kind === 'item' ? validateMenuImageFile : validateImageFile;
    const fileCheck = validate({ fileName: file_name, mimeType: mime_type });
    if (!fileCheck.ok) {
      return res.status(400).json({ error: fileCheck.error });
    }

    // The image lives under the merchant's id. Confirm the merchant exists so we
    // never leave orphaned objects for a bad id.
    const merchant = await loadMerchant(req.params.id);
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

    const path = buildMerchantImagePath(merchant.id, kind, file_name);
    const { token, signedUrl } = await createMerchantImageUploadUrl(path);

    return res.status(201).json({
      bucket: config.merchantImages.bucket,
      path,
      token,
      signedUrl,
      publicUrl: merchantImagePublicUrl(path),
      maxBytes: config.merchantImages.maxBytes,
    });
  } catch (err) {
    console.error('createMerchantImageUploadUrl error:', err);
    return res.status(500).json({ error: 'Could not create upload URL' });
  }
}

// --- Owner account provisioning (contract-signing step) ---------------------
// POST /api/admin/food/merchants/:id/owner
//   body: { email, password, full_name?, phone? }
//
// Restaurants are onboarded by admins: after the contract is signed the admin
// creates (or reuses) the owner's auth account, sets its password, grants it
// the `merchant` role, and links it to the restaurant. There is no
// self-service merchant signup.
//
// The password is CHOSEN BY THE ADMIN and permanent — the admin hands it over
// in person at contract signing. There is no generated temp value and no
// password-reset email (the platform sends no mail at all; every account is
// created with email_confirm). Recovery is setMerchantOwnerPassword below.
async function setMerchantOwner(req, res) {
  try {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email is required' });

    const password = String(b.password || '');
    const pwError = passwordError(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const merchant = await loadMerchant(req.params.id);
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
    if (merchant.owner_id) {
      return res.status(409).json({
        error: 'This restaurant already has an owner account linked. Unlink it first if you need to change it.',
      });
    }

    // Never point this flow at a staff account — see lib/merchantOwner.js.
    const { error: guardErr, status: guardStatus, profile: existingProfile } =
      await resolveOwnerProfile(email);
    if (guardErr) return res.status(guardStatus).json({ error: guardErr });

    // Create the auth user with a confirmed email (no confirmation mail). If
    // one already exists, reuse it (the person may already be a customer)
    // and apply the admin's password to it.
    let ownerId = null;
    let reusedExistingAccount = false;
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: b.full_name || null, mobile_number: b.phone || null },
    });
    if (createErr) {
      const msg = (createErr.message || '').toLowerCase();
      const alreadyExists = msg.includes('already') || createErr.status === 422;
      if (!alreadyExists) {
        console.error('setMerchantOwner createUser error:', createErr);
        return res.status(500).json({ error: 'Could not create the owner account' });
      }
      if (!existingProfile) {
        return res.status(409).json({
          error: 'An account with this email exists but could not be linked. Please check the address.',
        });
      }
      ownerId = existingProfile.id;
      reusedExistingAccount = true;
      // The admin typed a password; it must work regardless of which branch we
      // took, otherwise the owner is handed credentials that do not sign in.
      const { error: pwErr } = await supabase.auth.admin.updateUserById(ownerId, {
        password,
        email_confirm: true,
      });
      if (pwErr) {
        console.error('setMerchantOwner updateUserById error:', pwErr);
        return res.status(500).json({ error: 'Could not set the owner password' });
      }
    } else {
      ownerId = created.user.id;
    }

    const { error: profileErr } = await supabase
      .from('profiles')
      .upsert(
        {
          id: ownerId,
          role: 'merchant',
          email,
          full_name: b.full_name ?? null,
          mobile_number: b.phone ?? null,
        },
        { onConflict: 'id' }
      );
    if (profileErr) {
      console.error('setMerchantOwner profile upsert error:', profileErr);
      return res.status(500).json({ error: 'Could not set the merchant role' });
    }

    const { error: linkErr } = await supabase
      .from('merchants')
      .update({ owner_id: ownerId })
      .eq('id', merchant.id);
    if (linkErr) {
      console.error('setMerchantOwner link error:', linkErr);
      return res.status(500).json({ error: 'Could not link the owner to the restaurant' });
    }

    // Audit meta carries WHO was linked, never the password.
    logAudit({
      actorId: req.adminId,
      action: 'admin_merchant_owner_linked',
      resourceType: 'merchant',
      resourceId: merchant.id,
      meta: { owner_id: ownerId, email, reused_existing_account: reusedExistingAccount },
    });

    return res.status(201).json({
      ownerId,
      email,
      merchantId: merchant.id,
      reusedExistingAccount,
    });
  } catch (err) {
    console.error('setMerchantOwner error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// POST /api/admin/food/merchants/:id/owner/password
//   body: { password }
//
// Recovery path for a restaurant owner who lost their password. Admin-driven
// by design: there is no forgot-password email on this platform.
async function setMerchantOwnerPassword(req, res) {
  try {
    const password = String((req.body || {}).password || '');
    const pwError = passwordError(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const merchant = await loadMerchant(req.params.id);
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
    if (!merchant.owner_id) {
      return res.status(409).json({
        error: 'This restaurant has no owner account yet. Assign an owner first.',
      });
    }

    const { error: pwErr } = await supabase.auth.admin.updateUserById(merchant.owner_id, {
      password,
      email_confirm: true,
    });
    if (pwErr) {
      console.error('setMerchantOwnerPassword error:', pwErr);
      return res.status(500).json({ error: 'Could not update the owner password' });
    }

    logAudit({
      actorId: req.adminId,
      action: 'admin_merchant_owner_password_set',
      resourceType: 'merchant',
      resourceId: merchant.id,
      meta: { owner_id: merchant.owner_id },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('setMerchantOwnerPassword error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Settlement report ------------------------------------------------------
// Parse ?from=YYYY-MM-DD&to=YYYY-MM-DD into UTC day boundaries. 'to' is
// inclusive (we filter < the day AFTER it). Defaults: to = today, from = 30
// days before that.
function parseDateRange(query) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const toParam = (query.to || '').toString().trim();
  const fromParam = (query.from || '').toString().trim();

  const toDay = toParam ? new Date(`${toParam}T00:00:00.000Z`) : new Date(today);
  let fromDay;
  if (fromParam) {
    fromDay = new Date(`${fromParam}T00:00:00.000Z`);
  } else {
    fromDay = new Date(toDay);
    fromDay.setUTCDate(fromDay.getUTCDate() - 30);
  }

  // Exclusive upper bound = start of the day AFTER toDay, so toDay is included.
  const toExclusive = new Date(toDay);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  return {
    from: fromDay,
    toExclusive,
    fromLabel: Number.isNaN(fromDay.getTime()) ? null : fromDay.toISOString().slice(0, 10),
    toLabel: Number.isNaN(toDay.getTime()) ? null : toDay.toISOString().slice(0, 10),
  };
}

// GET /api/admin/food/settlement?from=YYYY-MM-DD&to=YYYY-MM-DD
// Per-order + per-restaurant view of what we owe each restaurant (their net
// payout = subtotal - markup) vs. the markup we keep (platform_margin_total),
// split by who collected the money:
//   * online (stcpay/tap) -> the PLATFORM holds the cash, we owe the restaurant
//   * cash                 -> the RIDER collected at the door
// Only fulfilled orders count (status not in pending/cancelled/rejected),
// matching getOverview's revenue definition. Only paid orders move money in
// the rollup; refunds are surfaced separately.
async function getSettlement(req, res) {
  try {
    const range = parseDateRange(req.query);
    if (Number.isNaN(range.from.getTime()) || Number.isNaN(range.toExclusive.getTime())) {
      return res.status(400).json({ error: 'Invalid from/to date (use YYYY-MM-DD)' });
    }
    // Guard the paging loop: an unbounded range would pull the whole table
    // into memory. ~13 months covers any real settlement period.
    const spanDays = (range.toExclusive - range.from) / 86400000;
    if (spanDays > 400) {
      return res.status(400).json({ error: 'Date range too large — export at most 400 days at a time' });
    }

    // Page past Supabase's ~1000-row cap so the export is COMPLETE (unlike
    // listOrders, which caps at 100).
    const PAGE = 1000;
    const MAX_ROWS = 50000;
    const raw = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from('orders')
        .select(
          'order_code, created_at, status, payment_status, payment_method, ' +
            'subtotal, delivery_fee, platform_margin_total, vat_amount, total, merchants ( id, name )'
        )
        .gte('created_at', range.from.toISOString())
        .lt('created_at', range.toExclusive.toISOString())
        // Fulfilled orders PLUS refunded ones. Refunds only exist on
        // cancelled/rejected orders (refundPayment gates on that), so a plain
        // "status not in (...)" filter would silently drop every refund from
        // the report — the refunded bucket must see those rows.
        .or('status.not.in.(pending,cancelled,rejected),payment_status.eq.refunded')
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) {
        console.error('food getSettlement error:', error);
        return res.status(500).json({ error: 'Could not build the settlement report' });
      }
      raw.push(...(data || []));
      if (!data || data.length < PAGE || raw.length >= MAX_ROWS) break;
    }

    const rows = raw.map((o) => {
      const subtotal = round2(Number(o.subtotal || 0));
      const markup = round2(Number(o.platform_margin_total || 0));
      return {
        orderCode: o.order_code,
        date: o.created_at,
        merchantId: o.merchants ? o.merchants.id : null,
        merchant: o.merchants ? o.merchants.name : null,
        subtotal,
        restaurantPayout: round2(subtotal - markup), // = sum of net prices
        platformMarkup: markup,
        deliveryFee: round2(Number(o.delivery_fee || 0)),
        // VAT is collected on the platform's behalf and owed onward to the
        // tax authority — never part of the restaurant payout or our markup.
        vat: round2(Number(o.vat_amount || 0)),
        total: round2(Number(o.total || 0)),
        paymentMethod: o.payment_method,
        paymentStatus: o.payment_status,
        collectedBy: o.payment_method === 'cash' ? 'cash_rider' : 'platform_online',
      };
    });

    // Per-merchant rollup. Only 'paid' orders have actually moved money.
    const byMerchantMap = new Map();
    const totals = {
      orders: 0,
      onlineOwedToRestaurant: 0, onlineMarkupKept: 0,
      cashCollectedByRider: 0, cashRestaurantPayout: 0, cashMarkup: 0,
      // VAT collected on paid orders — what we owe the tax authority for the
      // period, split the same way as the money it arrived with.
      vatCollected: 0, onlineVat: 0, cashVat: 0,
      refundedAmount: 0,
    };
    const blankBucket = (r) => ({
      merchantId: r.merchantId, merchant: r.merchant, orders: 0,
      onlineOwedToRestaurant: 0, onlineMarkupKept: 0,
      cashCollectedByRider: 0, cashRestaurantPayout: 0, cashMarkup: 0,
      vatCollected: 0,
      refundedAmount: 0,
    });
    for (const r of rows) {
      const key = r.merchantId || 'unknown';
      if (!byMerchantMap.has(key)) byMerchantMap.set(key, blankBucket(r));
      const m = byMerchantMap.get(key);
      m.orders += 1;
      totals.orders += 1;

      if (r.paymentStatus === 'refunded') {
        m.refundedAmount = round2(m.refundedAmount + r.total);
        totals.refundedAmount = round2(totals.refundedAmount + r.total);
        continue;
      }
      if (r.paymentStatus !== 'paid') continue; // awaiting/failed: not collected yet

      m.vatCollected = round2(m.vatCollected + r.vat);
      totals.vatCollected = round2(totals.vatCollected + r.vat);

      if (r.collectedBy === 'platform_online') {
        m.onlineOwedToRestaurant = round2(m.onlineOwedToRestaurant + r.restaurantPayout);
        m.onlineMarkupKept = round2(m.onlineMarkupKept + r.platformMarkup);
        totals.onlineOwedToRestaurant = round2(totals.onlineOwedToRestaurant + r.restaurantPayout);
        totals.onlineMarkupKept = round2(totals.onlineMarkupKept + r.platformMarkup);
        totals.onlineVat = round2(totals.onlineVat + r.vat);
      } else {
        m.cashCollectedByRider = round2(m.cashCollectedByRider + r.total);
        m.cashRestaurantPayout = round2(m.cashRestaurantPayout + r.restaurantPayout);
        m.cashMarkup = round2(m.cashMarkup + r.platformMarkup);
        totals.cashCollectedByRider = round2(totals.cashCollectedByRider + r.total);
        totals.cashRestaurantPayout = round2(totals.cashRestaurantPayout + r.restaurantPayout);
        totals.cashMarkup = round2(totals.cashMarkup + r.platformMarkup);
        totals.cashVat = round2(totals.cashVat + r.vat);
      }
    }

    logAudit({
      actorId: req.adminId,
      action: 'admin_food_settlement_read',
      resourceType: 'orders',
      meta: { from: range.fromLabel, to: range.toLabel, orders: totals.orders },
    });

    return res.json({
      from: range.fromLabel,
      to: range.toLabel,
      rows,
      byMerchant: Array.from(byMerchantMap.values()).sort((a, b) =>
        (a.merchant || '').localeCompare(b.merchant || '')
      ),
      totals,
    });
  } catch (err) {
    console.error('food getSettlement error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = {
  getOverview,
  getSettlement,
  listMerchants,
  createMerchant,
  updateMerchant,
  deleteMerchant,
  suspendMerchant,
  reactivateMerchant,
  replenishCredit,
  getMerchantMenu,
  addCategoryForMerchant,
  updateAnyCategory,
  deleteAnyCategory,
  addItemForMerchant,
  moderateItem,
  removeItem,
  listOrders,
  acceptOrder,
  rejectOrder,
  advanceOrderStatus,
  verifyPayment,
  rejectPayment,
  getOrderPhotos,
  cancelOrder,
  refundPayment,
  assignDriver,
  createMerchantImageUploadUrl: createMerchantImageUploadUrlHandler,
  setMerchantOwner,
  setMerchantOwnerPassword,
};
