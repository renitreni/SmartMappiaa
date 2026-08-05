// ---------------------------------------------------------------------
// Food Delivery money math — the SINGLE source of truth (server-side).
//
// Every SAR amount on a food order is computed here from DB menu prices
// at checkout and stored as a snapshot. Client-sent totals are ignored
// everywhere. The hard rules (PRD §7 / §10):
//   * subtotal = Σ(unit_price × quantity), must be >= 30 SAR
//   * per-item platform margin: 5 SAR (meal_package),
//     3 SAR (drink_dessert_addon)
//   * delivery fee: flat 10 SAR within 15 km (3-month promo), plus
//     0.25 SAR per km beyond it; past 50 km checkout is rejected
//   * VAT: 15% charged ON TOP of (subtotal + delivery_fee) — both the food
//     and the delivery service are taxable supplies in KSA
//   * total = subtotal + delivery_fee + vat (the margin is charged to the
//     MERCHANT's credit on accept, not to the customer)
//
// The minimum-order test runs on the EX-VAT subtotal, and the merchant's
// payout/margin math never sees VAT — it is the platform's liability to
// the tax authority, not revenue to split.
// ---------------------------------------------------------------------
const { config } = require('./config');
const { vatFor } = require('./vat');
const { surchargeFor, exceedsMaxRadius } = require('./deliveryPricing');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Margin the platform earns on one unit of an item, by menu_items.item_type.
// This is the FALLBACK now: only used when an item has no explicit net price.
function marginForItemType(itemType) {
  const margin = config.food.margins[itemType];
  if (margin == null) {
    throw new Error(`Unknown item_type "${itemType}" — no platform margin defined`);
  }
  return margin;
}

// Markup the platform keeps on ONE unit of an item.
//   * with a net price set: markup = list price − net price (Ka Inasal
//     "X SAR (Y)" pattern — varies per item, 0..10+ SAR)
//   * without one (net price null): the flat config.food.margins by
//     item_type (back-compat for legacy / single-price menu rows)
// The DB CHECK (migration 0018) guarantees net_price <= price, so the
// clamp below is only defence in depth.
function markupPerUnit({ unitPrice, netPrice, itemType }) {
  if (netPrice != null) {
    const markup = round2(Number(unitPrice) - Number(netPrice));
    return markup < 0 ? 0 : markup;
  }
  return marginForItemType(itemType);
}

// Price a whole order from trusted inputs (fresh DB menu rows + a distance
// the server computed itself).
//
//   items: [{ menuItemId, name, unitPrice, quantity, itemType }]
//   distanceKm: haversine merchant -> delivery point, or null when either
//               side has no coordinates (fee stays at the flat promo rate,
//               with no surcharge — a null distance is never guessed at).
//
// Returns { ok: true, subtotal, marginTotal, baseDeliveryFee,
//           deliverySurcharge, deliveryFee, vatRate, vatAmount, total, lines }
// or      { ok: false, failureReason: 'min_order' | 'outside_radius', ... }.
function priceOrder({ items, distanceKm }) {
  const lines = items.map((item) => {
    const quantity = Math.trunc(Number(item.quantity));
    const unitPrice = round2(item.unitPrice);
    const marginPerItem = markupPerUnit({
      unitPrice,
      netPrice: item.netPrice ?? null,
      itemType: item.itemType,
    });
    return {
      menuItemId: item.menuItemId,
      name: item.name,
      size: item.size ?? null,
      sizeLabel: item.sizeLabel ?? null,
      unitPrice,
      quantity,
      lineTotal: round2(unitPrice * quantity),
      marginPerItem,
      marginTotal: round2(marginPerItem * quantity),
    };
  });

  const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const marginTotal = round2(lines.reduce((sum, l) => sum + l.marginTotal, 0));

  if (subtotal < config.food.minOrderSar) {
    return {
      ok: false,
      failureReason: 'min_order',
      subtotal,
      minOrder: config.food.minOrderSar,
      shortfall: round2(config.food.minOrderSar - subtotal),
    };
  }

  // The cut-off is the MAX radius, not the free one: past config.food.radiusKm
  // we still deliver, we just charge for the extra kilometres.
  if (exceedsMaxRadius(distanceKm)) {
    return {
      ok: false,
      failureReason: 'outside_radius',
      distanceKm: round2(distanceKm),
      maxRadiusKm: config.delivery.maxRadiusKm,
      // Kept for callers still reading the old field name.
      radiusKm: config.delivery.maxRadiusKm,
    };
  }

  const baseDeliveryFee = round2(config.food.deliveryFeeSar);
  const { surcharge: deliverySurcharge } = surchargeFor(distanceKm);
  const deliveryFee = round2(baseDeliveryFee + deliverySurcharge);

  // VAT covers the surcharge automatically: it is inside deliveryFee, and
  // the extra kilometres are part of the same taxable delivery service.
  const { vatRate, vatAmount } = vatFor(subtotal + deliveryFee);
  const total = round2(subtotal + deliveryFee + vatAmount);

  return {
    ok: true,
    subtotal,
    marginTotal,
    baseDeliveryFee,
    deliverySurcharge,
    deliveryFee,
    vatRate,
    vatAmount,
    total,
    lines,
  };
}

// Credit state after (hypothetically) charging `marginTotal` to a merchant.
// Used by the accept flow to decide charge / 80% alert / suspension.
function creditAfterCharge(merchant, marginTotal) {
  const limit = Number(merchant.credit_limit) || config.food.merchantCreditLimit;
  const before = round2(Number(merchant.credit_used) || 0);
  const after = round2(before + marginTotal);
  const alertAt = round2(limit * config.food.creditAlertPct);
  return {
    limit,
    before,
    after,
    alertAt,
    canAccept: before < limit, // at/over the limit the merchant cannot accept
    crossesAlert: before < alertAt && after >= alertAt,
    exhausted: after >= limit,
  };
}

module.exports = { round2, marginForItemType, markupPerUnit, priceOrder, creditAfterCharge };
