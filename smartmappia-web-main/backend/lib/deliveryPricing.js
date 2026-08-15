// ---------------------------------------------------------------------
// Distance surcharge — the SINGLE source of truth, shared by all three
// services (food delivery, shop delivery, Pick & Drop rides).
//
//     first config.delivery.freeRadiusKm  -> no surcharge
//     every km beyond it                  -> config.delivery.surchargePerKm
//
// One module rather than three copies because foodMoney and shopMoney are
// already written to mirror each other line for line, and rides now join
// them. Three copies of a money rule is three places for it to drift.
//
// WHO KEEPS IT: the platform, on every service. For food and shop that is
// automatic — the surcharge is folded into delivery_fee, which was already
// platform revenue. For rides it is NOT automatic and must stay outside
// bookings.fare_amount; see lib/fare.js for why.
//
// Pure functions, no I/O. `distanceKm` is null whenever either endpoint
// has no coordinates, and a null distance always means NO surcharge —
// never a guess, and never a rejection.
// ---------------------------------------------------------------------
const { config } = require('./config');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// The surcharge for one leg.
//
// Returns { chargeableKm, surcharge, freeRadiusKm, perKm }. chargeableKm is
// the distance past the free band (0 inside it), rounded to 2dp BEFORE being
// multiplied so the money follows from a number a human can check on the
// receipt rather than from a full-precision float.
function surchargeFor(distanceKm) {
  const freeRadiusKm = config.delivery.freeRadiusKm;
  const perKm = config.delivery.surchargePerKm;
  const distance = Number(distanceKm);

  if (distanceKm == null || !Number.isFinite(distance) || distance <= freeRadiusKm) {
    return { chargeableKm: 0, surcharge: 0, freeRadiusKm, perKm };
  }

  const chargeableKm = round2(distance - freeRadiusKm);
  return {
    chargeableKm,
    surcharge: round2(chargeableKm * perKm),
    freeRadiusKm,
    perKm,
  };
}

// Is this leg too far to serve at all?
//
// DELIVERIES ONLY. Rides deliberately do not call this: an airport transfer
// past the cap is a legitimate booking, and refusing it would be a new
// restriction on a service that never had one. A null distance (no
// coordinates) is never "too far" — we cannot prove it either way, and
// refusing on missing data would break checkout for every merchant without
// a pin.
function exceedsMaxRadius(distanceKm) {
  const distance = Number(distanceKm);
  if (distanceKm == null || !Number.isFinite(distance)) return false;
  return distance > config.delivery.maxRadiusKm;
}

// The terms behind a quoted delivery fee, for the storefront to render.
//
// Discovery pages have no delivery address — the customer only supplies one
// at checkout — so the number they can honestly show is a FLOOR, not a fee.
// Shipping the base fee on its own made every card read as the final price
// while surchargeFor above was quietly adding per-km on top at checkout.
// Returning the terms alongside it lets the UI say "from SAR 10" and print
// the rule, rather than the frontend hardcoding a copy of these numbers.
function deliveryTerms(baseFeeSar) {
  return {
    baseFee: round2(baseFeeSar),
    freeRadiusKm: config.delivery.freeRadiusKm,
    surchargePerKm: config.delivery.surchargePerKm,
    maxRadiusKm: config.delivery.maxRadiusKm,
  };
}

module.exports = { surchargeFor, exceedsMaxRadius, round2, deliveryTerms };
