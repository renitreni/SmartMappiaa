// ---------------------------------------------------------------------
// Ecommerce — persistent cart (one per customer + store)
//   - getCart        : GET    /api/shop/cart?merchant_id=
//   - addCartItem    : POST   /api/shop/cart/items { product_id, variant_id, quantity }
//   - updateCartItem : PATCH  /api/shop/cart/items/:id { quantity }
//   - removeCartItem : DELETE /api/shop/cart/items/:id
//
// The server reads prices from products/product_variants itself — the
// client never sends money. The subtotal/minimum returned here is a
// DISPLAY HINT for the cart screen; checkout recomputes everything from
// scratch and re-checks stock atomically.
//
// Stock is NOT reserved by adding to a cart. Reservation happens once, at
// checkout, inside shop_place_order(). A cart line therefore shows a
// banded availability that can go stale, which is why checkout can still
// return 409 out_of_stock and the cart screen must handle it.
// ---------------------------------------------------------------------
const { supabase } = require('../../lib/supabase');
const { config } = require('../../lib/config');
const { vatFor } = require('../../lib/vat');
const { logShopEvent } = require('../../lib/foodEvents');
const { round2, resolveUnitPricing, availabilityBand, availableUnits } = require('../../lib/shopMoney');

const MAX_QTY = 50;

const CART_LINE_SELECT =
  'id, quantity, unit_price, product_id, variant_id, ' +
  'products ( id, name, price, net_price, image_url, is_available, unit, brand, ' +
  'track_stock, stock_quantity, low_stock_threshold ), ' +
  'product_variants ( id, label, sku, price, net_price, stock_quantity, is_available )';

// Load a cart's lines (joined to the live catalogue) and total them up.
async function buildCartSummary(cart) {
  const { data: lines, error } = await supabase
    .from('shop_cart_items')
    .select(CART_LINE_SELECT)
    .eq('cart_id', cart.id)
    .order('created_at');
  if (error) throw error;

  const items = (lines || []).map((line) => {
    const product = line.products;
    const variant = line.product_variants;
    if (!product) {
      return {
        id: line.id,
        productId: line.product_id,
        name: 'Removed product',
        unitPrice: Number(line.unit_price),
        quantity: line.quantity,
        isAvailable: false,
        availability: 'out',
        lineTotal: round2(Number(line.unit_price) * line.quantity),
      };
    }

    const { unitPrice } = resolveUnitPricing(product, variant);
    // A variant the store disabled since it went in the cart makes the line
    // unavailable rather than silently repricing to the base product.
    const variantStillValid = !line.variant_id || (variant && variant.is_available);
    const stockRow = variant
      ? { stock_quantity: variant.stock_quantity, low_stock_threshold: product.low_stock_threshold }
      : product;

    return {
      id: line.id,
      productId: line.product_id,
      variantId: line.variant_id || null,
      name: product.name,
      brand: product.brand,
      unit: product.unit,
      variantLabel: variant ? variant.label : null,
      sku: variant ? variant.sku : null,
      imageUrl: product.image_url,
      unitPrice,
      quantity: line.quantity,
      // Exact counts stay server-side. An earlier version also returned an
      // `exceedsStock` boolean, which was a free oracle: a client could
      // binary-search the exact stock level by PATCHing quantities and
      // watching the flag flip. That is precisely the sales-velocity
      // disclosure the 0029 column grants exist to prevent, handed back
      // through the API instead. The band is all the cart needs; checkout
      // is the authority and fails with a named 409 if a line is short.
      availability: availabilityBand(stockRow, product.track_stock),
      isAvailable: product.is_available && variantStillValid,
      lineTotal: round2(unitPrice * line.quantity),
    };
  });

  const subtotal = round2(items.reduce((sum, i) => sum + i.lineTotal, 0));
  const minOrder = config.shop.minOrderSar;
  // Mirrors priceShopOrder() in lib/shopMoney.js: VAT on top of goods +
  // delivery. The minimum-order gate stays on the EX-VAT subtotal.
  const deliveryFee = round2(config.shop.deliveryFeeSar);
  const { vatRate, vatAmount } = vatFor(subtotal + deliveryFee);

  return {
    cartId: cart.id,
    merchantId: cart.merchant_id,
    items,
    subtotal,
    minOrder,
    meetsMinimum: subtotal >= minOrder,
    shortfall: subtotal >= minOrder ? 0 : round2(minOrder - subtotal),
    // Blocks checkout client-side; the server re-checks atomically anyway.
    // Only 'out' and unavailability are surfaced — a 'low' line is still
    // orderable, and reporting anything finer would leak the count.
    hasBlockingLine: items.some((i) => !i.isAvailable || i.availability === 'out'),
    deliveryFee,
    vatRate,
    vatAmount,
    total: round2(subtotal + deliveryFee + vatAmount),
  };
}

async function loadOwnCart(userId, merchantId) {
  const { data, error } = await supabase
    .from('shop_carts')
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
        minOrder: config.shop.minOrderSar,
        meetsMinimum: false,
        shortfall: config.shop.minOrderSar,
        hasBlockingLine: false,
        deliveryFee: config.shop.deliveryFeeSar,
      });
    }
    return res.json(await buildCartSummary(cart));
  } catch (err) {
    console.error('shop getCart error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function addCartItem(req, res) {
  try {
    const { product_id, quantity = 1 } = req.body;
    const variantId = req.body.variant_id || null;

    // Server reads the product + store state itself.
    const { data: product, error: prodErr } = await supabase
      .from('products')
      .select(
        'id, merchant_id, name, price, net_price, is_available, track_stock, stock_quantity, ' +
          'merchants ( vertical, is_active, status )'
      )
      .eq('id', product_id)
      .maybeSingle();
    if (prodErr) {
      console.error('shop addCartItem load error:', prodErr);
      return res.status(500).json({ error: 'Could not load the product' });
    }
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (!product.is_available) {
      return res.status(409).json({ error: 'This product is currently unavailable' });
    }
    const store = product.merchants;
    if (!store || store.vertical !== 'shop' || !store.is_active || store.status !== 'active') {
      return res.status(409).json({ error: 'This store is not accepting orders right now' });
    }

    // Variant handling: a product WITH available variants requires one; a
    // product without them rejects any variant the client sends. Belongs to
    // this product only — a variant id from another product is a 400, not a
    // silent cross-product add.
    const { data: variants } = await supabase
      .from('product_variants')
      .select('id, label, price, net_price, stock_quantity, is_available')
      .eq('product_id', product.id)
      .eq('is_available', true);

    let variant = null;
    if ((variants || []).length > 0) {
      if (!variantId) return res.status(400).json({ error: 'Please pick an option for this product' });
      variant = (variants || []).find((v) => v.id === variantId) || null;
      if (!variant) return res.status(400).json({ error: 'That option is no longer available' });
    } else if (variantId) {
      return res.status(400).json({ error: 'This product does not have options' });
    }

    const { unitPrice } = resolveUnitPricing(product, variant);

    // Fail early on an obviously impossible quantity so the customer finds
    // out here rather than at checkout. This is a courtesy check only —
    // shop_place_order() is the authority and re-checks under a row lock.
    const available = availableUnits(product, variant);
    if (available != null && available <= 0) {
      logShopEvent({
        eventName: 'out_of_stock_block',
        userId: req.userId,
        merchantId: product.merchant_id,
        params: { product_id: product.id, requested: quantity, available: 0 },
      });
      return res.status(409).json({ error: 'This product is out of stock' });
    }

    // Find or create the customer's cart for this store.
    let cart = await loadOwnCart(req.userId, product.merchant_id);
    if (!cart) {
      const { data: created, error: cartErr } = await supabase
        .from('shop_carts')
        .upsert(
          { customer_id: req.userId, merchant_id: product.merchant_id },
          { onConflict: 'customer_id,merchant_id' }
        )
        .select('id, merchant_id')
        .single();
      if (cartErr) {
        console.error('shop addCartItem cart create error:', cartErr);
        return res.status(500).json({ error: 'Could not create your cart' });
      }
      cart = created;
    }

    // Same product + same variant again bumps the quantity (capped at
    // MAX_QTY). A different variant is a separate line — the unique index
    // covers cart + product + variant.
    let existingQuery = supabase
      .from('shop_cart_items')
      .select('id, quantity')
      .eq('cart_id', cart.id)
      .eq('product_id', product.id);
    existingQuery = variant
      ? existingQuery.eq('variant_id', variant.id)
      : existingQuery.is('variant_id', null);
    const { data: existing } = await existingQuery.maybeSingle();

    // Cap at MAX_QTY only — deliberately NOT at `available`. Clamping to the
    // stock level would echo the exact count straight back in the response
    // (`quantity` in the returned cart), which is the same disclosure the
    // 0029 grants close off at the database. An over-quantity line is caught
    // at checkout by the RPC, which is the authority anyway.
    const cap = (n) => Math.max(1, Math.min(n, MAX_QTY));

    if (existing) {
      const { error: updErr } = await supabase
        .from('shop_cart_items')
        .update({ quantity: cap(existing.quantity + quantity), unit_price: unitPrice })
        .eq('id', existing.id);
      if (updErr) {
        console.error('shop addCartItem update error:', updErr);
        return res.status(500).json({ error: 'Could not update your cart' });
      }
    } else {
      const { error: insErr } = await supabase.from('shop_cart_items').insert({
        cart_id: cart.id,
        product_id: product.id,
        variant_id: variant ? variant.id : null,
        quantity: cap(quantity),
        unit_price: unitPrice, // display snapshot; checkout re-reads live prices
      });
      if (insErr) {
        console.error('shop addCartItem insert error:', insErr);
        return res.status(500).json({ error: 'Could not add the product to your cart' });
      }
    }

    logShopEvent({
      eventName: 'add_to_cart',
      userId: req.userId,
      merchantId: product.merchant_id,
      params: {
        product_id: product.id,
        variant_id: variant ? variant.id : null,
        price: Number(unitPrice),
        quantity,
      },
    });

    return res.status(201).json(await buildCartSummary(cart));
  } catch (err) {
    console.error('shop addCartItem error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// Load a cart line and verify it belongs to the caller. Returns null if not.
async function loadOwnCartLine(userId, lineId) {
  const { data, error } = await supabase
    .from('shop_cart_items')
    .select('id, cart_id, shop_carts ( id, customer_id, merchant_id )')
    .eq('id', lineId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.shop_carts || data.shop_carts.customer_id !== userId) return null;
  return data;
}

async function updateCartItem(req, res) {
  try {
    const { quantity } = req.body;
    const line = await loadOwnCartLine(req.userId, req.params.id);
    if (!line) return res.status(404).json({ error: 'Cart item not found' });

    if (quantity === 0) {
      await supabase.from('shop_cart_items').delete().eq('id', line.id);
    } else {
      const { error } = await supabase
        .from('shop_cart_items')
        .update({ quantity: Math.min(quantity, MAX_QTY) })
        .eq('id', line.id);
      if (error) {
        console.error('shop updateCartItem error:', error);
        return res.status(500).json({ error: 'Could not update the quantity' });
      }
    }
    return res.json(
      await buildCartSummary({ id: line.cart_id, merchant_id: line.shop_carts.merchant_id })
    );
  } catch (err) {
    console.error('shop updateCartItem error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function removeCartItem(req, res) {
  try {
    const line = await loadOwnCartLine(req.userId, req.params.id);
    if (!line) return res.status(404).json({ error: 'Cart item not found' });

    await supabase.from('shop_cart_items').delete().eq('id', line.id);
    return res.json(
      await buildCartSummary({ id: line.cart_id, merchant_id: line.shop_carts.merchant_id })
    );
  } catch (err) {
    console.error('shop removeCartItem error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { getCart, addCartItem, updateCartItem, removeCartItem, buildCartSummary, CART_LINE_SELECT };
