// ---------------------------------------------------------------------
// Business Owner portal controller.
// Every query is scoped to the signed-in owner via merchants.owner_id.
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { round2 } = require('../lib/foodMoney');
const { config } = require('../lib/config');
const {
  buildMerchantLogoPath,
  buildMenuItemImagePath,
  createMerchantMediaUploadUrl,
  getMerchantMediaPublicUrl,
} = require('../lib/storage');
const { validateImageFile, validateMenuImageFile } = require('../lib/uploadValidation');

const MERCHANT_SELECT =
  'id, name, cuisine_type, description, logo_url, address, lat, lng, ' +
  'is_active, status, credit_limit, credit_used, is_featured, badge, created_at';

async function loadOwnedMerchant(ownerId) {
  const { data, error } = await supabase
    .from('merchants')
    .select(MERCHANT_SELECT)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function merchantView(m) {
  if (!m) return null;
  return {
    id: m.id,
    name: m.name,
    cuisineType: m.cuisine_type,
    description: m.description,
    logoUrl: m.logo_url,
    address: m.address,
    lat: m.lat,
    lng: m.lng,
    isActive: m.is_active,
    status: m.status,
    creditLimit: Number(m.credit_limit),
    creditUsed: round2(Number(m.credit_used)),
    isFeatured: m.is_featured,
    badge: m.badge,
    createdAt: m.created_at,
  };
}

async function requireOwnedMerchant(req, res) {
  const merchant = await loadOwnedMerchant(req.merchantOwnerId);
  if (!merchant) {
    res.status(404).json({ error: 'No business profile is linked to this account' });
    return null;
  }
  return merchant;
}

async function getProfile(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;
    return res.json({ merchant: merchantView(merchant) });
  } catch (err) {
    console.error('merchant getProfile error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function updateProfile(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;

    // Location is mandatory: drivers navigate to this pin and the 15 km
    // delivery radius depends on it. The route rejects an explicit null, but
    // guard here too so a legacy unpinned merchant must set one to save.
    if (!Number.isFinite(req.body.lat) || !Number.isFinite(req.body.lng)) {
      return res.status(400).json({
        error: 'Set your restaurant location before saving',
        failure_reason: 'restaurant_location_required',
      });
    }

    const { data, error } = await supabase
      .from('merchants')
      .update({
        name: req.body.name,
        cuisine_type: req.body.cuisine_type ?? null,
        description: req.body.description ?? null,
        logo_url: req.body.logo_url ?? null,
        address: req.body.address ?? null,
        lat: req.body.lat,
        lng: req.body.lng,
      })
      .eq('id', merchant.id)
      .eq('owner_id', req.merchantOwnerId)
      .select(MERCHANT_SELECT)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Business profile not found' });
    return res.json({ merchant: merchantView(data) });
  } catch (err) {
    console.error('merchant updateProfile error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function createLogoUploadUrl(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;

    const { file_name, mime_type } = req.body || {};
    const fileCheck = validateImageFile({ fileName: file_name, mimeType: mime_type });
    if (!fileCheck.ok) {
      return res.status(400).json({ error: fileCheck.error });
    }

    const path = buildMerchantLogoPath(merchant.id, file_name);
    const { token, signedUrl } = await createMerchantMediaUploadUrl(path);
    const publicUrl = getMerchantMediaPublicUrl(path);

    return res.status(201).json({
      bucket: config.merchantImages.bucket,
      path,
      token,
      signedUrl,
      publicUrl,
      maxBytes: config.merchantImages.maxBytes,
    });
  } catch (err) {
    console.error('merchant createLogoUploadUrl error:', err);
    return res.status(500).json({ error: 'Could not create upload URL' });
  }
}

async function confirmLogoUpload(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;

    const path = req.body?.path;
    if (!path || !String(path).startsWith(`${merchant.id}/`)) {
      return res.status(400).json({ error: 'Invalid logo path' });
    }
    if (req.body.size_bytes != null && Number(req.body.size_bytes) > config.merchantImages.maxBytes) {
      return res.status(400).json({ error: `File exceeds max size of ${config.merchantImages.maxBytes} bytes` });
    }

    const logo_url = getMerchantMediaPublicUrl(path);
    const { data, error } = await supabase
      .from('merchants')
      .update({ logo_url })
      .eq('id', merchant.id)
      .eq('owner_id', req.merchantOwnerId)
      .select(MERCHANT_SELECT)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Business profile not found' });
    return res.json({ merchant: merchantView(data), logoUrl: logo_url });
  } catch (err) {
    console.error('merchant confirmLogoUpload error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function createMenuItemImageUploadUrl(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;

    const { file_name, mime_type } = req.body || {};
    const fileCheck = validateMenuImageFile({ fileName: file_name, mimeType: mime_type });
    if (!fileCheck.ok) {
      return res.status(400).json({ error: fileCheck.error });
    }

    const path = buildMenuItemImagePath(merchant.id, file_name);
    const { token, signedUrl } = await createMerchantMediaUploadUrl(path);
    const publicUrl = getMerchantMediaPublicUrl(path);

    return res.status(201).json({
      bucket: config.merchantImages.bucket,
      path,
      token,
      signedUrl,
      publicUrl,
      maxBytes: config.merchantImages.maxBytes,
    });
  } catch (err) {
    console.error('merchant createMenuItemImageUploadUrl error:', err);
    return res.status(500).json({ error: 'Could not create upload URL' });
  }
}

async function confirmMenuItemImageUpload(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;

    const path = req.body?.path;
    const prefix = `${merchant.id}/menu-items/`;
    if (!path || !String(path).startsWith(prefix)) {
      return res.status(400).json({ error: 'Invalid image path' });
    }
    if (req.body.size_bytes != null && Number(req.body.size_bytes) > config.merchantImages.maxBytes) {
      return res.status(400).json({ error: `File exceeds max size of ${config.merchantImages.maxBytes} bytes` });
    }

    return res.json({ imageUrl: getMerchantMediaPublicUrl(path) });
  } catch (err) {
    console.error('merchant confirmMenuItemImageUpload error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function getMenu(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;

    const [{ data: categories }, { data: items }] = await Promise.all([
      supabase
        .from('menu_categories')
        .select('id, name, sort_order, is_active')
        .eq('merchant_id', merchant.id)
        .order('sort_order'),
      supabase
        .from('menu_items')
        .select('id, category_id, name, description, price, item_type, image_url, is_available')
        .eq('merchant_id', merchant.id)
        .order('name'),
    ]);

    return res.json({ merchant: merchantView(merchant), categories: categories || [], items: items || [] });
  } catch (err) {
    console.error('merchant getMenu error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function addCategory(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;

    const { data, error } = await supabase
      .from('menu_categories')
      .insert({ merchant_id: merchant.id, ...req.body })
      .select('id, name, sort_order, is_active')
      .single();
    if (error) return res.status(500).json({ error: 'Could not create the category' });
    return res.status(201).json({ category: data });
  } catch (err) {
    console.error('merchant addCategory error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function updateCategory(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;

    const { data, error } = await supabase
      .from('menu_categories')
      .update(req.body)
      .eq('id', req.params.id)
      .eq('merchant_id', merchant.id)
      .select('id, name, sort_order, is_active')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Category not found' });
    return res.json({ category: data });
  } catch (err) {
    console.error('merchant updateCategory error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function deleteCategory(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;

    const { error } = await supabase
      .from('menu_categories')
      .delete()
      .eq('id', req.params.id)
      .eq('merchant_id', merchant.id);
    if (error) return res.status(500).json({ error: 'Could not delete the category' });
    return res.json({ deleted: true });
  } catch (err) {
    console.error('merchant deleteCategory error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function assertCategoryOwned(categoryId, merchantId) {
  if (!categoryId) return true;
  const { data } = await supabase
    .from('menu_categories')
    .select('id')
    .eq('id', categoryId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  return !!data;
}

async function addItem(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;
    if (!(await assertCategoryOwned(req.body.category_id, merchant.id))) {
      return res.status(400).json({ error: 'category_id does not belong to this business' });
    }

    const { data, error } = await supabase
      .from('menu_items')
      .insert({ merchant_id: merchant.id, ...req.body })
      .select('id, category_id, name, description, price, item_type, image_url, is_available')
      .single();
    if (error) return res.status(500).json({ error: 'Could not create the item' });
    return res.status(201).json({ item: data });
  } catch (err) {
    console.error('merchant addItem error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function updateItem(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;
    if (!(await assertCategoryOwned(req.body.category_id, merchant.id))) {
      return res.status(400).json({ error: 'category_id does not belong to this business' });
    }

    const { data, error } = await supabase
      .from('menu_items')
      .update(req.body)
      .eq('id', req.params.id)
      .eq('merchant_id', merchant.id)
      .select('id, category_id, name, description, price, item_type, image_url, is_available')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Menu item not found' });
    return res.json({ item: data });
  } catch (err) {
    console.error('merchant updateItem error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function getAnalytics(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: orders, error } = await supabase
      .from('orders')
      .select('status, payment_status, total, created_at')
      .eq('merchant_id', merchant.id);
    if (error) {
      console.error('merchant getAnalytics error:', error);
      return res.status(500).json({ error: 'Could not load analytics' });
    }

    const rows = orders || [];
    const statusCounts = {};
    for (const o of rows) {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    }

    const completed = rows.filter((o) => o.status === 'delivered');
    const active = rows.filter((o) =>
      ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'].includes(o.status)
    );
    const todayOrders = rows.filter((o) => new Date(o.created_at) >= todayStart);

    const menuItemCount = await itemsCount(merchant.id);

    return res.json({
      merchant: merchantView(merchant),
      menuItems: menuItemCount,
      summary: {
        totalOrders: rows.length,
        activeOrders: active.length,
        deliveredOrders: completed.length,
        pendingOrders: statusCounts.pending || 0,
        todayOrders: todayOrders.length,
        orderVolume: round2(completed.reduce((sum, o) => sum + Number(o.total || 0), 0)),
        creditUsed: round2(Number(merchant.credit_used)),
        creditLimit: Number(merchant.credit_limit),
        creditRemaining: round2(Math.max(0, Number(merchant.credit_limit) - Number(merchant.credit_used))),
      },
      statusBreakdown: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
    });
  } catch (err) {
    console.error('merchant getAnalytics error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function itemsCount(merchantId) {
  const { count } = await supabase
    .from('menu_items')
    .select('id', { count: 'exact', head: true })
    .eq('merchant_id', merchantId);
  return count || 0;
}

async function deleteItem(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;

    const { error } = await supabase
      .from('menu_items')
      .delete()
      .eq('id', req.params.id)
      .eq('merchant_id', merchant.id);
    if (error) return res.status(500).json({ error: 'Could not delete the item' });
    return res.json({ deleted: true });
  } catch (err) {
    console.error('merchant deleteItem error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = {
  getProfile,
  updateProfile,
  createLogoUploadUrl,
  confirmLogoUpload,
  createMenuItemImageUploadUrl,
  confirmMenuItemImageUpload,
  getAnalytics,
  getMenu,
  addCategory,
  updateCategory,
  deleteCategory,
  addItem,
  updateItem,
  deleteItem,
};
