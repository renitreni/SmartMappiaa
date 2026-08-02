// ---------------------------------------------------------------------
// Ecommerce ("shop") money math — the SINGLE source of truth (server-side).
//
// Every SAR amount on a shop order is computed here from DB catalogue
// prices at checkout and stored as a snapshot. Client-sent totals are
// ignored everywhere. The hard rules (ECOMMERCE_PLAN §2):
//   * subtotal = sum(unit_price x quantity), must be >= 50 SAR
//   * per-unit platform markup = list price - net price; with no net
//     price set, the flat config.shop.defaultMargin applies
//   * delivery fee: flat 15 SAR within 15 km; outside the radius
//     checkout is rejected
//   * VAT: 15% charged ON TOP of (subtotal + delivery_fee)
//   * total = subtotal + delivery_fee + vat (the markup is charged to the
//     STORE's credit on accept, not to the customer)
//
// Deliberately mirrors lib/foodMoney.js line for line so the two verticals
// cannot drift. round2 and creditAfterCharge are IMPORTED rather than
// copied — they are already vertical-neutral, and a second copy would be
// somewhere for the money models to diverge.
//
// The minimum-order test runs on the EX-VAT subtotal, and the store's
// payout/markup math never sees VAT — it is the platform's liability to
// the tax authority, not revenue to split.
// ---------------------------------------------------------------------
const { config } = require('./config');
const { vatFor } = require('./vat');
const { round2, creditAfterCharge } = require('./foodMoney');

// Markup the platform keeps on ONE unit.
//   * with a net price set: markup = list price - net price (varies per
//     product, exactly like the food net_price model from 0018)
//   * without one: the flat config.shop.defaultMargin
// The DB CHECK (migration 0026) guarantees net_price <= price, so the
// clamp below is only defence in depth.
function markupPerUnit({ unitPrice, netPrice }) {
  if (netPrice != null) {
    const markup = round2(Number(unitPrice) - Number(netPrice));
    return markup < 0 ? 0 : markup;
  }
  return config.shop.defaultMargin;
}

// A variant overrides the product's price and net price when it sets them;
// a null on the variant means "inherit". Kept in one place because cart
// display, checkout and the admin catalogue all need the same answer.
function resolveUnitPricing(product, variant) {
  const unitPrice = variant && variant.price != null ? Number(variant.price) : Number(product.price);
  const netPrice =
    variant && variant.net_price != null
      ? Number(variant.net_price)
      : product.net_price != null
        ? Number(product.net_price)
        : null;
  return { unitPrice: round2(unitPrice), netPrice };
}

// What the customer is allowed to know about stock.
//
// Exact counts are commercially sensitive — polled over time they reveal a
// store's precise sales velocity per SKU — so migration 0029 revokes
// stock_quantity from the client roles and the API serves this band
// instead. 'low' exists so the storefront can show urgency without
// publishing the number.
function availabilityBand(row, trackStock) {
  if (!trackStock) return 'in_stock';
  const qty = Number(row && row.stock_quantity) || 0;
  if (qty <= 0) return 'out';
  const threshold = Number(row && row.low_stock_threshold);
  const limit = Number.isFinite(threshold) ? threshold : config.shop.lowStockThreshold;
  return qty <= limit ? 'low' : 'in_stock';
}

// Available units for a line, or null when the product is not tracked.
function availableUnits(product, variant) {
  if (!product.track_stock) return null;
  return Number((variant ? variant.stock_quantity : product.stock_quantity)) || 0;
}

// Price a whole order from trusted inputs (fresh DB catalogue rows + a
// distance the server computed itself).
//
//   items: [{ productId, variantId, name, variantLabel, sku, unitPrice,
//             netPrice, quantity }]
//   distanceKm: haversine store -> delivery point, or null when either
//               side has no coordinates (fee stays at the flat rate).
//
// Returns { ok: true, subtotal, marginTotal, deliveryFee, vatRate,
//           vatAmount, total, lines }
// or      { ok: false, failureReason: 'min_order' | 'outside_radius', ... }
function priceShopOrder({ items, distanceKm }) {
  const lines = items.map((item) => {
    const quantity = Math.trunc(Number(item.quantity));
    const unitPrice = round2(item.unitPrice);
    const marginPerItem = markupPerUnit({ unitPrice, netPrice: item.netPrice ?? null });
    return {
      productId: item.productId,
      variantId: item.variantId ?? null,
      name: item.name,
      variantLabel: item.variantLabel ?? null,
      sku: item.sku ?? null,
      unitPrice,
      quantity,
      lineTotal: round2(unitPrice * quantity),
      marginPerItem,
      marginTotal: round2(marginPerItem * quantity),
    };
  });

  const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const marginTotal = round2(lines.reduce((sum, l) => sum + l.marginTotal, 0));

  if (subtotal < config.shop.minOrderSar) {
    return {
      ok: false,
      failureReason: 'min_order',
      subtotal,
      minOrder: config.shop.minOrderSar,
      shortfall: round2(config.shop.minOrderSar - subtotal),
    };
  }

  if (distanceKm != null && distanceKm > config.shop.radiusKm) {
    return {
      ok: false,
      failureReason: 'outside_radius',
      distanceKm: round2(distanceKm),
      radiusKm: config.shop.radiusKm,
    };
  }

  const deliveryFee = round2(config.shop.deliveryFeeSar);
  const { vatRate, vatAmount } = vatFor(subtotal + deliveryFee);
  const total = round2(subtotal + deliveryFee + vatAmount);

  return { ok: true, subtotal, marginTotal, deliveryFee, vatRate, vatAmount, total, lines };
}

module.exports = {
  round2,
  markupPerUnit,
  resolveUnitPricing,
  availabilityBand,
  availableUnits,
  priceShopOrder,
  creditAfterCharge,
};
