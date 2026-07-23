// ---------------------------------------------------------------------
// Food Delivery — persistent cart (one per customer + merchant)
//   - getCart        : GET    /api/food/cart?merchant_id=
//   - addCartItem    : POST   /api/food/cart/items { menu_item_id, quantity }
//   - updateCartItem : PATCH  /api/food/cart/items/:id { quantity }
//   - removeCartItem : DELETE /api/food/cart/items/:id
//
// The server reads prices from menu_items itself — the client never
// sends money. The subtotal/minimum returned here is a DISPLAY HINT for
// the cart screen; checkout recomputes everything from scratch.
// ---------------------------------------------------------------------
const { supabase } = require('../../lib/supabase');
const { config } = require('../../lib/config');
const { round2 } = require('../../lib/foodMoney');
const { logFoodEvent } = require('../../lib/foodEvents');
const { hasEnabledSizes, findSizeOption } = require('../../lib/foodSizes');

const MAX_QTY = 50;

// Load a cart's lines (joined to the live menu) and total them up.
async function buildCartSummary(cart) {
  const { data: lines, error } = await supabase
    .from('cart_items')
    .select('id, quantity, unit_price, size, menu_item_id, menu_items ( id, name, price, image_url, is_available, item_type, size_options )')
    .eq('cart_id', cart.id)
    .order('created_at');
  if (error) throw error;

  const items = (lines || []).map((line) => {
    const menu = line.menu_items;
    // A sized line prices from its (still enabled) size option; if the admin
    // disabled that size since, the line shows as unavailable.
    const sizeOption = menu && line.size ? findSizeOption(menu.size_options, line.size) : null;
    const unitPrice = sizeOption
      ? Number(sizeOption.price)
      : menu ? Number(menu.price) : Number(line.unit_price);
    const sizeStillValid = !line.size || !!sizeOption;
    return {
      id: line.id,
      menuItemId: line.menu_item_id,
      name: menu ? menu.name : 'Removed item',
      imageUrl: menu ? menu.image_url : null,
      unitPrice,
      quantity: line.quantity,
      size: line.size || null,
      sizeLabel: sizeOption ? sizeOption.label : null,
      isAvailable: (menu ? menu.is_available : false) && sizeStillValid,
      lineTotal: round2(unitPrice * line.quantity),
    };
  });

  const subtotal = round2(items.reduce((sum, i) => sum + i.lineTotal, 0));
  const minOrder = config.food.minOrderSar;
  return {
    cartId: cart.id,
    merchantId: cart.merchant_id,
    items,
    subtotal,
    minOrder,
    meetsMinimum: subtotal >= minOrder,
    shortfall: subtotal >= minOrder ? 0 : round2(minOrder - subtotal),
    deliveryFee: config.food.deliveryFeeSar,
  };
}

async function loadOwnCart(userId, merchantId) {
  const { data, error } = await supabase
    .from('carts')
    .select('id, merchant_id')
    .eq('customer_id', userId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getCart(req, res) {
  try {
    const merchantId = (req.query.merchant_id || '').toString();
    if (!merchantId) {
      return res.status(400).json({ error: 'merchant_id query parameter is required' });
    }
    const cart = await loadOwnCart(req.userId, merchantId);
    if (!cart) {
      return res.json({
        cartId: null,
        merchantId,
        items: [],
        subtotal: 0,
        minOrder: config.food.minOrderSar,
        meetsMinimum: false,
        shortfall: config.food.minOrderSar,
        deliveryFee: config.food.deliveryFeeSar,
      });
    }
    return res.json(await buildCartSummary(cart));
  } catch (err) {
    console.error('getCart error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function addCartItem(req, res) {
  try {
    const { menu_item_id, quantity = 1 } = req.body;
    const size = req.body.size || null;

    // Server reads the item + restaurant state itself.
    const { data: item, error: itemErr } = await supabase
      .from('menu_items')
      .select('id, merchant_id, name, price, is_available, size_options, merchants ( is_active, status )')
      .eq('id', menu_item_id)
      .maybeSingle();
    if (itemErr) {
      console.error('addCartItem load error:', itemErr);
      return res.status(500).json({ error: 'Could not load the menu item' });
    }
    if (!item) return res.status(404).json({ error: 'Menu item not found' });
    if (!item.is_available) {
      return res.status(409).json({ error: 'This item is currently unavailable' });
    }
    if (!item.merchants || !item.merchants.is_active || item.merchants.status !== 'active') {
      return res.status(409).json({ error: 'This restaurant is not accepting orders right now' });
    }

    // Size handling: a sized item requires a valid ENABLED size; a size-less
    // item rejects any size the client sends. The size price becomes the
    // line's unit price (still only a display snapshot — checkout re-reads).
    let sizeOption = null;
    if (hasEnabledSizes(item.size_options)) {
      sizeOption = findSizeOption(item.size_options, size);
      if (!sizeOption) {
        return res.status(400).json({ error: 'Please pick a size for this item' });
      }
    } else if (size) {
      return res.status(400).json({ error: 'This item does not have size options' });
    }
    const unitPrice = sizeOption ? sizeOption.price : item.price;

    // Find or create the customer's cart for this restaurant.
    let cart = await loadOwnCart(req.userId, item.merchant_id);
    if (!cart) {
      const { data: created, error: cartErr } = await supabase
        .from('carts')
        .upsert(
          { customer_id: req.userId, merchant_id: item.merchant_id },
          { onConflict: 'customer_id,merchant_id' }
        )
        .select('id, merchant_id')
        .single();
      if (cartErr) {
        console.error('addCartItem cart create error:', cartErr);
        return res.status(500).json({ error: 'Could not create your cart' });
      }
      cart = created;
    }

    // Same item + same size again = bump the quantity (capped). A different
    // size is a separate line (unique index covers cart+item+size).
    let existingQuery = supabase
      .from('cart_items')
      .select('id, quantity')
      .eq('cart_id', cart.id)
      .eq('menu_item_id', item.id);
    existingQuery = sizeOption ? existingQuery.eq('size', sizeOption.id) : existingQuery.is('size', null);
    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      const nextQty = Math.min(existing.quantity + quantity, MAX_QTY);
      const { error: updErr } = await supabase
        .from('cart_items')
        .update({ quantity: nextQty, unit_price: unitPrice })
        .eq('id', existing.id);
      if (updErr) {
        console.error('addCartItem update error:', updErr);
        return res.status(500).json({ error: 'Could not update your cart' });
      }
    } else {
      const { error: insErr } = await supabase.from('cart_items').insert({
        cart_id: cart.id,
        menu_item_id: item.id,
        quantity: Math.min(quantity, MAX_QTY),
        size: sizeOption ? sizeOption.id : null,
        unit_price: unitPrice, // display snapshot; checkout re-reads live prices
      });
      if (insErr) {
        console.error('addCartItem insert error:', insErr);
        return res.status(500).json({ error: 'Could not add the item to your cart' });
      }
    }

    logFoodEvent({
      eventName: 'add_to_cart',
      userId: req.userId,
      merchantId: item.merchant_id,
      params: { item_id: item.id, price: Number(unitPrice), quantity, size: sizeOption ? sizeOption.id : null },
    });

    return res.status(201).json(await buildCartSummary(cart));
  } catch (err) {
    console.error('addCartItem error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// Load a cart line and verify it belongs to the caller. Returns null if not.
async function loadOwnCartLine(userId, lineId) {
  const { data, error } = await supabase
    .from('cart_items')
    .select('id, cart_id, carts ( id, customer_id, merchant_id )')
    .eq('id', lineId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.carts || data.carts.customer_id !== userId) return null;
  return data;
}

async function updateCartItem(req, res) {
  try {
    const { quantity } = req.body;
    const line = await loadOwnCartLine(req.userId, req.params.id);
    if (!line) return res.status(404).json({ error: 'Cart item not found' });

    if (quantity === 0) {
      await supabase.from('cart_items').delete().eq('id', line.id);
    } else {
      const { error } = await supabase
        .from('cart_items')
        .update({ quantity: Math.min(quantity, MAX_QTY) })
        .eq('id', line.id);
      if (error) {
        console.error('updateCartItem error:', error);
        return res.status(500).json({ error: 'Could not update the quantity' });
      }
    }
    return res.json(await buildCartSummary({ id: line.cart_id, merchant_id: line.carts.merchant_id }));
  } catch (err) {
    console.error('updateCartItem error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function removeCartItem(req, res) {
  try {
    const line = await loadOwnCartLine(req.userId, req.params.id);
    if (!line) return res.status(404).json({ error: 'Cart item not found' });

    await supabase.from('cart_items').delete().eq('id', line.id);
    return res.json(await buildCartSummary({ id: line.cart_id, merchant_id: line.carts.merchant_id }));
  } catch (err) {
    console.error('removeCartItem error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { getCart, addCartItem, updateCartItem, removeCartItem, buildCartSummary };
