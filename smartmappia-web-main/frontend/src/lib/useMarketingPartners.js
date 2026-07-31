// ---------------------------------------------------------------------
// Partners shown on the public marketing page (the logo marquee in
// sections/Logo.jsx and the "Most Loved Flavors" grid in
// sections/Restaurants.jsx).
//
// Admin-managed: any merchant the admin ticks "Feature on the homepage"
// (merchants.is_featured, migration 0015) shows up here with no code change,
// via the already-public GET /api/food/restaurants?featured=true.
//
// The curated list in data/restaurants.js stays as a SEED and is merged with
// whatever the API returns rather than replaced by it:
//   * with nothing featured yet, the page renders exactly as it always has —
//     no regression is possible, by construction rather than by luck;
//   * featuring a restaurant makes it appear immediately, ahead of the seeds;
//   * as real partners accumulate they crowd seeds off the tail one at a
//     time, so the page converges on being fully admin-driven with no cliff.
// To hand a seeded brand over to the database, delete its object from
// data/restaurants.js (but read the PhoneMockup warning in that file first).
//
// A merchant needs ALL of these to appear: is_featured, a logo, is_active,
// status 'active', and a lat/lng pin. is_featured defaults to false, so a
// half-configured or QA row can never leak onto the public homepage.
// ---------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { api } from '../portal/lib/api';
import { restaurants as curatedPartners } from '../data/restaurants';

// Delivery ETA is not a per-merchant column. The section headline already
// claims a platform-wide average, so reuse one honest figure rather than
// inventing a different number per restaurant.
export const MARKETING_ETA = '15-25 min';
export const MARKETING_ETA_SHORT = '15 min';

// The grid is 4-wide at xl; 12 keeps it to three clean rows.
export const MAX_GRID_CARDS = 12;

// merchants.badge is snake_case, constrained by the DB to these four values
// (0015_merchant_homepage_presentation.sql), echoed by the route whitelist in
// backend/routes/admin.js and the admin dropdown in portal/admin/FoodAdmin.jsx.
// The card's tagStyles map in sections/Restaurants.jsx is keyed by the labels
// below. Keep all four lists in step — an unmapped value renders no badge.
export const BADGE_LABELS = {
  top_rated: 'Top Rated',
  popular: 'Popular',
  new: 'New',
  trending: 'Trending',
};

// Compare names loosely so "Ka Inasal" and "ka-inasal" count as the same brand.
const normalizeName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// A featured merchant with no logo would render an empty card, which is worse
// than not appearing at all.
export function isMarketingEligible(merchant) {
  return !!(merchant && merchant.name && merchant.logo_url);
}

// Map an API merchant onto the shape the existing cards already consume.
// Fields with no database source are either a platform-wide default or, where
// they would be a claim about this specific restaurant (rating, review count),
// left null so the UI hides them. Never invent those.
export function mapMerchantToCard(merchant, deliveryFee) {
  const fee = Number(deliveryFee);
  return {
    id: `db:${merchant.id}`,
    name: merchant.name,
    cuisine: merchant.cuisine_type || null,
    rating: merchant.rating ?? null,
    reviews: merchant.reviewCount > 0 ? String(merchant.reviewCount) : null,
    time: MARKETING_ETA,
    timeShort: MARKETING_ETA_SHORT,
    fee: Number.isFinite(fee) && fee > 0 ? `SAR ${fee} delivery` : 'Free delivery',
    tag: BADGE_LABELS[merchant.badge] || null,
    logo: merchant.logo_url,
    image: merchant.logo_url,
    // An admin uploads a logo, not a cover photo: letterbox it on white and
    // never crop it.
    bg: '#FFFFFF',
    cover: false,
    tagline: merchant.description || merchant.cuisine_type || '',
  };
}

// Admin-featured partners first, then the curated seeds. A name collision
// keeps the seed, which preserves its hand-tuned card styling.
export function mergePartners(apiRestaurants, deliveryFee, curated = curatedPartners) {
  const seeded = new Set(curated.map((r) => normalizeName(r.name)));
  const fromDb = (apiRestaurants || [])
    .filter(isMarketingEligible)
    .filter((m) => !seeded.has(normalizeName(m.name)))
    .map((m) => mapMerchantToCard(m, deliveryFee));
  return [...fromDb, ...curated];
}

// One request per page load however many components call the hook, which also
// makes React StrictMode's double-effect harmless. The settled promise is
// cached, so a failure is not retried — a marketing page must not retry-storm.
// api.foodRestaurants already passes { silent: true }, so a failure here can
// never raise a popup on a visitor's screen.
let cachedRequest = null;
function loadFeaturedOnce() {
  if (!cachedRequest) {
    cachedRequest = api.foodRestaurants('?featured=true').catch(() => null);
  }
  return cachedRequest;
}

export function useMarketingPartners() {
  // Seeded synchronously from the bundle: first paint is immediate and there
  // is no skeleton state to design around.
  const [partners, setPartners] = useState(() => mergePartners(null));

  useEffect(() => {
    let alive = true;
    loadFeaturedOnce().then((data) => {
      if (!alive || !data) return;
      const merged = mergePartners(data.restaurants, data.deliveryFee);
      if (merged.length) setPartners(merged);
    });
    return () => {
      alive = false;
    };
  }, []);

  return partners;
}
