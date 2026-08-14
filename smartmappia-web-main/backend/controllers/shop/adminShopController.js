// ---------------------------------------------------------------------
// Admin — the Ecommerce (shop) vertical.
//
// Mirrors controllers/food/adminFoodController.js. The whole router sits
// behind requireAdmin, so nothing here re-checks the role.
//
// THIS IS THE ONLY PLACE net_price IS EVER WRITTEN. It is what the store
// keeps; price minus net_price is our markup. The store owner's portal has
// no such field and its route schemas reject it, migration 0029 hides the
// column from the public anon key, and 0030 revoked the direct-write grant.
// Admin is the single writer by design.
//
// Every merchants query filters vertical = 'shop': the table is shared with
// Food Delivery, and without the filter the Shop tab would list, suspend or
// credit restaurants.
// ---------------------------------------------------------------------
const { supabase } = require('../../lib/supabase');
const { config } = require('../../lib/config');
const { round2 } = require('../../lib/foodMoney');
const { logAudit } = require('../../lib/audit');
const { logNotification } = require('../../lib/notifications');
const { pushShopOrderStatus, pushMerchantFeed, pingShopAdmin } = require('../../lib/realtime');
const {
  acceptOrderCore,
  rejectOrderCore,
  advanceOrderStatusCore,
  cancelOrderCore,
  creditView,
} = require('../../lib/shopOrderActions');
const { releaseShopStock, lowStockProducts } = require('../../lib/stock');
const { markShopOrderPaid } = require('./ordersController');
const {
  buildMerchantLogoPath,
  buildMenuItemImagePath,
  createMerchantImageUploadUrl,
  merchantImagePublicUrl,
  createProofDownloadUrl,
} = require('../../lib/storage');
const { passwordError } = require('../../lib/validate');
const { resolveOwnerProfile } = require('../../lib/merchantOwner');

const STORE_SELECT =
  'id, name, vertical, cuisine_type, description, logo_url, address, street, building_number, lat, lng, is_active, status, ' +
  'accepting_orders, credit_limit, credit_used, is_featured, badge, owner_id, created_at';

// Admin sees net_price. Nobody else does.
const ADMIN_PRODUCT_SELECT =
  'id, merchant_id, category_id, name, description, brand, unit, weight_grams, barcode, ' +
  'price, net_price, image_url, stock_quantity, low_stock_threshold, track_stock, ' +
  'is_available, created_at';

const ADMIN_VARIANT_SELECT =
  'id, product_id, sku, label, price, net_price, stock_quantity, sort_order, is_available';

async function loadStore(id) {
  const { data } = await supabase
    .from('merchants')
    .select('*')
    .eq('id', id)
    .eq('vertical', 'shop')
    .maybeSingle();
  return data;
}

// --- Overview ---------------------------------------------------------
async function getOverview(req, res) {
  try {
    const [{ data: orders }, { data: stores }, { count: awaitingPayments }] = await Promise.all([
      supabase
        .from('shop_orders')
        .select('id, status, total, platform_margin_total, payment_status, created_at')
        .order('created_at', { ascending: false })
        .limit(2000),
      supabase.from('merchants').select('status, credit_used, credit_limit').eq('vertical', 'shop'),
      supabase
        .from('shop_orders')
        .select('id', { count: 'exact', head: true })
        .eq('payment_status', 'awaiting'),
    ]);

    const rows = orders || [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Platform revenue = the markup on orders that actually completed.
    const revenue = rows
      .filter((o) => o.status === 'delivered')
      .reduce((s, o) => s + Number(o.platform_margin_total || 0), 0);

    const { data: outOfStock } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('track_stock', true)
      .lte('stock_quantity', 0);

    return res.json({
      ordersToday: rows.filter((o) => new Date(o.created_at) >= startOfToday).length,
      totalOrders: rows.length,
      platformRevenue: round2(revenue),
      stores: (stores || []).length,
      suspended: (stores || []).filter((s) => s.status === 'suspended').length,
      paymentsToVerify: awaitingPayments || 0,
      outOfStockProducts: outOfStock ? outOfStock.length : 0,
    });
  } catch (err) {
    console.error('admin shop getOverview error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Stores -----------------------------------------------------------
async function listStores(req, res) {
  try {
    const { data, error } = await supabase
      .from('merchants')
      .select(STORE_SELECT)
      .eq('vertical', 'shop')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('admin listStores error:', error);
      return res.status(500).json({ error: 'Could not load stores' });
    }

    // Owner emails, so the admin can see which stores still need an account.
    const ownerIds = (data || []).map((m) => m.owner_id).filter(Boolean);
    const emails = new Map();
    if (ownerIds.length) {
      const { data: owners } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', ownerIds);
      for (const o of owners || []) emails.set(o.id, o.email);
    }

    return res.json({
      stores: (data || []).map((m) => ({
        ...m,
        ownerEmail: m.owner_id ? emails.get(m.owner_id) || null : null,
        credit: creditView(m),
      })),
    });
  } catch (err) {
    console.error('admin listStores error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function createStore(req, res) {
  try {
    const { data, error } = await supabase
      .from('merchants')
      // vertical is set HERE, not taken from the body: the route schema does
      // not declare it, so this endpoint can only ever mint a store.
      .insert({ ...req.body, vertical: 'shop' })
      .select(STORE_SELECT)
      .single();
    if (error) {
      console.error('admin createStore error:', error);
      return res.status(500).json({ error: 'Could not create the store' });
    }
    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_store_created',
      resourceType: 'merchant',
      resourceId: data.id,
      meta: { name: data.name },
    });
    return res.status(201).json({ store: data });
  } catch (err) {
    console.error('admin createStore error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function updateStore(req, res) {
  try {
    const { data, error } = await supabase
      .from('merchants')
      .update(req.body)
      .eq('id', req.params.id)
      .eq('vertical', 'shop')
      .select(STORE_SELECT)
      .maybeSingle();
    if (error) {
      console.error('admin updateStore error:', error);
      return res.status(500).json({ error: 'Could not update the store' });
    }
    if (!data) return res.status(404).json({ error: 'Store not found' });
    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_store_updated',
      resourceType: 'merchant',
      resourceId: data.id,
      meta: { fields: Object.keys(req.body) },
    });
    return res.json({ store: data });
  } catch (err) {
    console.error('admin updateStore error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function deleteStore(req, res) {
  try {
    const store = await loadStore(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const { error } = await supabase.from('merchants').delete().eq('id', req.params.id);
    if (error) {
      // shop_orders.merchant_id is ON DELETE RESTRICT — a store with order
      // history must be unlisted, not deleted, so the history stays truthful.
      return res.status(409).json({
        error: 'This store has order history and cannot be deleted. Unlist it instead.',
      });
    }
    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_store_deleted',
      resourceType: 'merchant',
      resourceId: req.params.id,
      meta: { name: store.name },
    });
    return res.json({ deleted: true });
  } catch (err) {
    console.error('admin deleteStore error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function suspendStore(req, res) {
  try {
    const store = await loadStore(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    await supabase.from('merchants').update({ status: 'suspended' }).eq('id', store.id);
    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_store_suspended',
      resourceType: 'merchant',
      resourceId: store.id,
      meta: { reason: req.body.reason || null },
    });
    return res.json({ suspended: true });
  } catch (err) {
    console.error('admin suspendStore error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function reactivateStore(req, res) {
  try {
    const store = await loadStore(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    await supabase.from('merchants').update({ status: 'active' }).eq('id', store.id);
    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_store_reactivated',
      resourceType: 'merchant',
      resourceId: store.id,
    });
    return res.json({ reactivated: true });
  } catch (err) {
    console.error('admin reactivateStore error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// Reconcile the credit line after the store settles what it owes.
async function replenishCredit(req, res) {
  try {
    const store = await loadStore(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const amount = round2(Number(req.body.amount));
    const before = round2(Number(store.credit_used));
    const after = round2(Math.max(0, before - amount));

    // Compare-and-swap so two admins reconciling at once cannot both apply.
    const { data: rows } = await supabase
      .from('merchants')
      .update({ credit_used: after, status: after < Number(store.credit_limit) ? 'active' : store.status })
      .eq('id', store.id)
      .eq('credit_used', store.credit_used)
      .select('id');
    if (!rows || rows.length === 0) {
      return res.status(409).json({ error: 'The credit balance changed — please retry' });
    }

    await supabase.from('merchant_credit_ledger').insert({
      merchant_id: store.id,
      type: 'replenish',
      amount,
      balance_after: after,
      note: req.body.note || 'Admin reconciliation',
      created_by: req.adminId,
    });
    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_credit_replenished',
      resourceType: 'merchant',
      resourceId: store.id,
      meta: { amount, before, after },
    });
    return res.json({ credit: creditView({ ...store, credit_used: after }) });
  } catch (err) {
    console.error('admin replenishCredit error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function createStoreImageUploadUrl(req, res) {
  try {
    const store = await loadStore(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const kind = req.body.kind === 'logo' ? 'logo' : 'item';
    const path = kind === 'logo'
      ? buildMerchantLogoPath(store.id, req.body.file_name)
      : buildMenuItemImagePath(store.id, req.body.file_name);
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
    console.error('admin createStoreImageUploadUrl error:', err);
    return res.status(500).json({ error: 'Could not create upload URL' });
  }
}

// Provision the owner account. Mirrors the food flow exactly, including the
// admin-chosen permanent password (see setMerchantOwner for the rationale).
async function setStoreOwner(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email is required' });

    const password = String(req.body.password || '');
    const pwError = passwordError(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const store = await loadStore(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    if (store.owner_id) {
      return res.status(409).json({
        error: 'This store already has an owner account linked. Unlink it first to change it.',
      });
    }

    // Never point this flow at a staff account — see lib/merchantOwner.js.
    const { error: guardErr, status: guardStatus, profile: existingProfile } =
      await resolveOwnerProfile(email);
    if (guardErr) return res.status(guardStatus).json({ error: guardErr });

    let ownerId = null;
    let reusedExistingAccount = false;
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: req.body.full_name || null, mobile_number: req.body.phone || null },
    });
    if (createErr) {
      const msg = (createErr.message || '').toLowerCase();
      const alreadyExists = msg.includes('already') || createErr.status === 422;
      if (!alreadyExists) {
        console.error('setStoreOwner createUser error:', createErr);
        return res.status(500).json({ error: 'Could not create the owner account' });
      }
      if (!existingProfile) {
        return res.status(409).json({
          error: 'An account with this email exists but could not be linked. Please check the address.',
        });
      }
      ownerId = existingProfile.id;
      reusedExistingAccount = true;
      const { error: pwErr } = await supabase.auth.admin.updateUserById(ownerId, {
        password,
        email_confirm: true,
      });
      if (pwErr) {
        console.error('setStoreOwner updateUserById error:', pwErr);
        return res.status(500).json({ error: 'Could not set the owner password' });
      }
    } else {
      ownerId = created.user.id;
    }

    // The merchant role is granted ONLY here and in its food twin — it is not
    // self-selectable at signup (handbook §13.3.4).
    await supabase.from('profiles').upsert({
      id: ownerId,
      role: 'merchant',
      email,
      full_name: req.body.full_name || null,
      mobile_number: req.body.phone || null,
    });
    await supabase.from('merchants').update({ owner_id: ownerId }).eq('id', store.id);

    // Audit meta carries WHO was linked, never the password.
    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_owner_linked',
      resourceType: 'merchant',
      resourceId: store.id,
      meta: { owner_id: ownerId, email, reused_existing_account: reusedExistingAccount },
    });

    return res.status(201).json({
      ownerId,
      email,
      storeId: store.id,
      reusedExistingAccount,
    });
  } catch (err) {
    console.error('admin setStoreOwner error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// POST /api/admin/shop/stores/:id/owner/password
//   body: { password }
//
// Recovery path for a store owner who lost their password. Twin of
// setMerchantOwnerPassword in the food controller.
async function setStoreOwnerPassword(req, res) {
  try {
    const password = String((req.body || {}).password || '');
    const pwError = passwordError(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const store = await loadStore(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    if (!store.owner_id) {
      return res.status(409).json({
        error: 'This store has no owner account yet. Assign an owner first.',
      });
    }

    const { error: pwErr } = await supabase.auth.admin.updateUserById(store.owner_id, {
      password,
      email_confirm: true,
    });
    if (pwErr) {
      console.error('setStoreOwnerPassword error:', pwErr);
      return res.status(500).json({ error: 'Could not update the owner password' });
    }

    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_owner_password_set',
      resourceType: 'merchant',
      resourceId: store.id,
      meta: { owner_id: store.owner_id },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('admin setStoreOwnerPassword error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Catalogue (the ONLY net_price writer) ----------------------------
async function getStoreCatalogue(req, res) {
  try {
    const store = await loadStore(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const [{ data: categories }, { data: products }] = await Promise.all([
      supabase
        .from('product_categories')
        .select('id, name, sort_order, is_active')
        .eq('merchant_id', store.id)
        .order('sort_order'),
      supabase
        .from('products')
        .select(`${ADMIN_PRODUCT_SELECT}, product_variants ( ${ADMIN_VARIANT_SELECT} )`)
        .eq('merchant_id', store.id)
        .order('name'),
    ]);
    return res.json({ store, categories: categories || [], products: products || [] });
  } catch (err) {
    console.error('admin getStoreCatalogue error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function addCategory(req, res) {
  try {
    const store = await loadStore(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const { data, error } = await supabase
      .from('product_categories')
      .insert({ ...req.body, merchant_id: store.id })
      .select('id, name, sort_order, is_active')
      .single();
    if (error) return res.status(500).json({ error: 'Could not add the category' });
    return res.status(201).json({ category: data });
  } catch (err) {
    console.error('admin addCategory error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function updateCategory(req, res) {
  try {
    const { data, error } = await supabase
      .from('product_categories')
      .update(req.body)
      .eq('id', req.params.id)
      .select('id, name, sort_order, is_active')
      .maybeSingle();
    if (error) return res.status(500).json({ error: 'Could not update the category' });
    if (!data) return res.status(404).json({ error: 'Category not found' });
    return res.json({ category: data });
  } catch (err) {
    console.error('admin updateCategory error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function deleteCategory(req, res) {
  try {
    const { error } = await supabase.from('product_categories').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: 'Could not delete the category' });
    return res.json({ deleted: true });
  } catch (err) {
    console.error('admin deleteCategory error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// net_price arrives here and NOWHERE else in the codebase.
async function addProduct(req, res) {
  try {
    const store = await loadStore(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const { data, error } = await supabase
      .from('products')
      .insert({ ...req.body, merchant_id: store.id })
      .select(ADMIN_PRODUCT_SELECT)
      .single();
    if (error) {
      // 23514 = products_net_price_range: net_price must be > 0 and <= price.
      if (error.code === '23514') {
        return res.status(422).json({
          error: 'The net price must be greater than zero and no more than the list price.',
        });
      }
      console.error('admin addProduct error:', error);
      return res.status(500).json({ error: 'Could not add the product' });
    }
    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_product_added',
      resourceType: 'product',
      resourceId: data.id,
      meta: { name: data.name, price: data.price, net_price: data.net_price },
    });
    return res.status(201).json({ product: data });
  } catch (err) {
    console.error('admin addProduct error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function updateProduct(req, res) {
  try {
    const { data, error } = await supabase
      .from('products')
      .update(req.body)
      .eq('id', req.params.id)
      .select(ADMIN_PRODUCT_SELECT)
      .maybeSingle();
    if (error) {
      if (error.code === '23514') {
        return res.status(422).json({
          error: 'The net price must be greater than zero and no more than the list price.',
        });
      }
      return res.status(500).json({ error: 'Could not update the product' });
    }
    if (!data) return res.status(404).json({ error: 'Product not found' });
    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_product_updated',
      resourceType: 'product',
      resourceId: data.id,
      meta: { fields: Object.keys(req.body) },
    });
    return res.json({ product: data });
  } catch (err) {
    console.error('admin updateProduct error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function deleteProduct(req, res) {
  try {
    const { error } = await supabase.from('products').delete().eq('id', req.params.id);
    if (error) {
      return res.status(409).json({
        error: 'This product could not be deleted. Mark it unavailable instead.',
      });
    }
    return res.json({ deleted: true });
  } catch (err) {
    console.error('admin deleteProduct error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function upsertVariant(req, res) {
  try {
    const body = { ...req.body, product_id: req.params.id };
    const q = req.params.variantId
      ? supabase.from('product_variants').update(req.body).eq('id', req.params.variantId).eq('product_id', req.params.id)
      : supabase.from('product_variants').insert(body);
    const { data, error } = await q.select(ADMIN_VARIANT_SELECT).maybeSingle();
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That SKU is already used by another option' });
      }
      if (error.code === '23514') {
        return res.status(422).json({
          error: 'An option with a net price must also set its own price, and the net price cannot exceed it.',
        });
      }
      console.error('admin upsertVariant error:', error);
      return res.status(500).json({ error: 'Could not save the option' });
    }
    if (!data) return res.status(404).json({ error: 'Option not found' });
    return res.json({ variant: data });
  } catch (err) {
    console.error('admin upsertVariant error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function deleteVariant(req, res) {
  try {
    const { error } = await supabase
      .from('product_variants')
      .delete()
      .eq('id', req.params.variantId)
      .eq('product_id', req.params.id);
    if (error) return res.status(409).json({ error: 'Could not delete the option' });
    return res.json({ deleted: true });
  } catch (err) {
    console.error('admin deleteVariant error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function getInventory(req, res) {
  try {
    const storeId = (req.query.merchant_id || '').toString();
    if (!storeId) return res.status(400).json({ error: 'merchant_id query parameter is required' });
    const low = await lowStockProducts(storeId, { limit: 200 });
    return res.json({ lowStock: low, threshold: config.shop.lowStockThreshold });
  } catch (err) {
    console.error('admin shop getInventory error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Orders -----------------------------------------------------------
const ADMIN_ORDER_SELECT =
  'id, order_code, status, subtotal, delivery_fee, platform_margin_total, vat_amount, vat_rate, ' +
  'total, distance_km, delivery_address, delivery_street, delivery_building, contact_phone, payment_status, payment_method, ' +
  'gateway_transaction_id, reject_reason, stock_reserved_at, stock_released_at, created_at, ' +
  'accepted_at, packed_at, ready_at, delivered_at, ' +
  'merchants ( id, name ), ' +
  'shop_order_items ( id, name_snapshot, variant_label_snapshot, sku_snapshot, unit_price, quantity, line_total, margin_total ), ' +
  'shop_deliveries ( status, driver_id, pickup_photo_path, delivery_photo_path ), ' +
  'profiles!shop_orders_customer_id_fkey ( full_name, mobile_number )';

async function listOrders(req, res) {
  try {
    let q = supabase
      .from('shop_orders')
      .select(ADMIN_ORDER_SELECT)
      .order('created_at', { ascending: false })
      .limit(200);
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.merchant_id) q = q.eq('merchant_id', req.query.merchant_id);

    const { data, error } = await q;
    if (error) {
      console.error('admin shop listOrders error:', error);
      return res.status(500).json({ error: 'Could not load orders' });
    }
    return res.json({ orders: data || [] });
  } catch (err) {
    console.error('admin shop listOrders error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// The admin fallback path. Delegates to the SAME core the store portal uses,
// so the credit gate and the ledger cannot diverge between the two.
async function acceptOrder(req, res) {
  const { httpStatus, body } = await acceptOrderCore({
    orderCode: req.params.code,
    actorId: req.adminId,
    actorRole: 'admin',
  });
  return res.status(httpStatus).json(body);
}

async function rejectOrder(req, res) {
  const { httpStatus, body } = await rejectOrderCore({
    orderCode: req.params.code,
    actorId: req.adminId,
    actorRole: 'admin',
    reason: req.body.reason || null,
  });
  return res.status(httpStatus).json(body);
}

// Admin gets the FULL ladder, including the rider-only steps, as a support
// fallback for when a rider's app fails mid-delivery.
async function advanceOrderStatus(req, res) {
  const { httpStatus, body } = await advanceOrderStatusCore({
    orderCode: req.params.code,
    status: req.body.status,
    actorId: req.adminId,
    actorRole: 'admin',
  });
  return res.status(httpStatus).json(body);
}

async function cancelOrder(req, res) {
  const { httpStatus, body } = await cancelOrderCore({
    orderCode: req.params.code,
    actorId: req.adminId,
    actorRole: 'admin',
    reason: req.body.reason || null,
  });
  return res.status(httpStatus).json(body);
}

async function loadOrderRow(code) {
  const { data } = await supabase
    .from('shop_orders')
    .select('id, order_code, customer_id, merchant_id, status, total, payment_status, payment_method')
    .eq('order_code', code)
    .maybeSingle();
  return data;
}

async function verifyPayment(req, res) {
  try {
    const order = await loadOrderRow(req.params.code);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status === 'paid') {
      return res.status(409).json({ error: 'This payment is already verified' });
    }

    // Promote the awaiting proof row rather than inserting a second one.
    const { data: pending } = await supabase
      .from('shop_order_payments')
      .select('id')
      .eq('order_id', order.id)
      .eq('status', 'awaiting')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pending) {
      await supabase.from('shop_order_payments').update({ status: 'paid' }).eq('id', pending.id);
    }

    const result = await markShopOrderPaid(order, {
      provider: order.payment_method,
      transactionId: req.body.reference || null,
      actorId: req.adminId,
      skipPaymentRow: !!pending,
    });
    if (result.alreadyPaid) return res.status(409).json({ error: 'This payment is already recorded' });

    return res.json({ orderCode: order.order_code, paymentStatus: 'paid' });
  } catch (err) {
    console.error('admin shop verifyPayment error:', err);
    return res.status(500).json({ error: 'Could not verify the payment' });
  }
}

async function rejectPayment(req, res) {
  try {
    const order = await loadOrderRow(req.params.code);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    await supabase.from('shop_orders').update({ payment_status: 'failed' }).eq('id', order.id);
    await supabase
      .from('shop_order_payments')
      .update({ status: 'failed' })
      .eq('order_id', order.id)
      .eq('status', 'awaiting');

    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_payment_rejected',
      resourceType: 'shop_order',
      resourceId: order.order_code,
      meta: { reason: req.body.reason || null },
    });
    logNotification({
      userId: order.customer_id,
      type: 'shop_payment_rejected',
      code: order.order_code,
      shopOrderId: order.id,
    });
    pushShopOrderStatus(order.order_code, { paymentStatus: 'failed' });
    pingShopAdmin(order.order_code);
    return res.json({ orderCode: order.order_code, paymentStatus: 'failed' });
  } catch (err) {
    console.error('admin shop rejectPayment error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// Refunding releases the stock too — the goods are coming back to the store.
async function refundPayment(req, res) {
  try {
    const order = await loadOrderRow(req.params.code);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status !== 'paid') {
      return res.status(409).json({ error: 'Only a paid order can be refunded' });
    }

    await supabase.from('shop_orders').update({ payment_status: 'refunded' }).eq('id', order.id);
    await supabase
      .from('shop_order_payments')
      .update({ status: 'refunded' })
      .eq('order_id', order.id)
      .eq('status', 'paid');

    const release = await releaseShopStock(order.id);

    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_payment_refunded',
      resourceType: 'shop_order',
      resourceId: order.order_code,
      meta: { amount: Number(order.total), stock_released: release.released },
    });
    pushShopOrderStatus(order.order_code, { paymentStatus: 'refunded' });
    pushMerchantFeed(order.merchant_id, 'payment_update', {
      orderCode: order.order_code,
      paymentStatus: 'refunded',
    });
    pingShopAdmin(order.order_code);
    return res.json({ orderCode: order.order_code, paymentStatus: 'refunded', stockReleased: release.released });
  } catch (err) {
    console.error('admin shop refundPayment error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// Manual rider assignment, for when the cascade cannot place a job.
async function assignDriver(req, res) {
  try {
    const order = await loadOrderRow(req.params.code);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { data: driver } = await supabase
      .from('profiles')
      .select('id, role, driver_approved, full_name')
      .eq('id', req.body.driver_id)
      .maybeSingle();
    if (!driver || driver.role !== 'driver') {
      return res.status(400).json({ error: 'That account is not a driver' });
    }
    if (!driver.driver_approved) {
      return res.status(400).json({ error: 'That driver is not approved yet' });
    }

    const { error } = await supabase
      .from('shop_deliveries')
      .upsert({ order_id: order.id, driver_id: driver.id, status: 'assigned' }, { onConflict: 'order_id' });
    if (error) {
      console.error('admin shop assignDriver error:', error);
      return res.status(500).json({ error: 'Could not assign the rider' });
    }

    logAudit({
      actorId: req.adminId,
      action: 'admin_shop_driver_assigned',
      resourceType: 'shop_order',
      resourceId: order.order_code,
      meta: { driver_id: driver.id },
    });
    logNotification({ userId: order.customer_id, type: 'shop_rider_assigned', code: order.order_code });
    logNotification({ userId: driver.id, type: 'shop_delivery_assigned', code: order.order_code });
    pushShopOrderStatus(order.order_code, { status: order.status, rider: { name: driver.full_name, status: 'assigned' } });
    pingShopAdmin(order.order_code);
    return res.json({ assigned: true, driverId: driver.id });
  } catch (err) {
    console.error('admin shop assignDriver error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// Short-lived signed URLs for the rider's proof photos (private bucket).
async function getOrderPhotos(req, res) {
  try {
    const order = await loadOrderRow(req.params.code);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const { data: delivery } = await supabase
      .from('shop_deliveries')
      .select('pickup_photo_path, delivery_photo_path')
      .eq('order_id', order.id)
      .maybeSingle();
    if (!delivery) return res.json({ pickupUrl: null, deliveryUrl: null });

    const [pickupUrl, deliveryUrl] = await Promise.all([
      delivery.pickup_photo_path ? createProofDownloadUrl(delivery.pickup_photo_path) : null,
      delivery.delivery_photo_path ? createProofDownloadUrl(delivery.delivery_photo_path) : null,
    ]);
    return res.json({ pickupUrl, deliveryUrl });
  } catch (err) {
    console.error('admin shop getOrderPhotos error:', err);
    return res.status(500).json({ error: 'Could not load the photos' });
  }
}

// --- Settlement -------------------------------------------------------
// Per order: store_payout = subtotal - platform_markup. Cash orders were
// collected by the rider; online orders are money we hold and owe the store.
// VAT is excluded from both sides — it belongs to the tax authority.
const PAGE = 1000;
const MAX_ROWS = 50000;

async function getSettlement(req, res) {
  try {
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }
    if ((to - from) / 86400000 > 400) {
      return res.status(422).json({ error: 'Please choose a range of 400 days or less' });
    }

    const rows = [];
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      const { data, error } = await supabase
        .from('shop_orders')
        .select(
          'order_code, created_at, subtotal, delivery_fee, platform_margin_total, vat_amount, ' +
            'total, payment_method, payment_status, merchants ( name )'
        )
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) {
        console.error('admin shop getSettlement error:', error);
        return res.status(500).json({ error: 'Could not build the settlement report' });
      }
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }

    const orders = rows.map((o) => {
      const subtotal = round2(Number(o.subtotal));
      const markup = round2(Number(o.platform_margin_total));
      return {
        orderCode: o.order_code,
        date: o.created_at,
        store: o.merchants ? o.merchants.name : null,
        subtotal,
        storePayout: round2(subtotal - markup),
        platformMarkup: markup,
        deliveryCharge: round2(Number(o.delivery_fee)),
        vat: round2(Number(o.vat_amount || 0)),
        total: round2(Number(o.total)),
        paymentMethod: o.payment_method,
        paymentStatus: o.payment_status,
        collectedBy: o.payment_method === 'cash' ? 'cash_rider' : 'platform_online',
      };
    });

    const totals = orders.reduce(
      (acc, o) => {
        if (o.paymentStatus === 'refunded') {
          acc.refundedAmount = round2(acc.refundedAmount + o.total);
          return acc;
        }
        if (o.collectedBy === 'cash_rider') {
          acc.cashCollectedByRider = round2(acc.cashCollectedByRider + o.total);
          acc.cashStorePayout = round2(acc.cashStorePayout + o.storePayout);
          acc.cashMarkup = round2(acc.cashMarkup + o.platformMarkup);
        } else {
          acc.onlineOwedToStore = round2(acc.onlineOwedToStore + o.storePayout);
          acc.onlineMarkupKept = round2(acc.onlineMarkupKept + o.platformMarkup);
        }
        acc.vatCollected = round2(acc.vatCollected + o.vat);
        return acc;
      },
      {
        onlineOwedToStore: 0,
        onlineMarkupKept: 0,
        cashCollectedByRider: 0,
        cashStorePayout: 0,
        cashMarkup: 0,
        vatCollected: 0,
        refundedAmount: 0,
      }
    );

    return res.json({ orders, totals, count: orders.length });
  } catch (err) {
    console.error('admin shop getSettlement error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = {
  getOverview,
  listStores,
  createStore,
  updateStore,
  deleteStore,
  suspendStore,
  reactivateStore,
  replenishCredit,
  createStoreImageUploadUrl,
  setStoreOwner,
  setStoreOwnerPassword,
  getStoreCatalogue,
  addCategory,
  updateCategory,
  deleteCategory,
  addProduct,
  updateProduct,
  deleteProduct,
  upsertVariant,
  deleteVariant,
  getInventory,
  listOrders,
  acceptOrder,
  rejectOrder,
  advanceOrderStatus,
  cancelOrder,
  verifyPayment,
  rejectPayment,
  refundPayment,
  assignDriver,
  getOrderPhotos,
  getSettlement,
};
