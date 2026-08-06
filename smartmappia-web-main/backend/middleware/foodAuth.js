// ---------------------------------------------------------------------
// Food Delivery auth helpers.
//
//   optionalAuth -> attach req.userId if a valid token is present; never
//                   rejects. Used on public discovery/analytics endpoints
//                   so events can be tagged with a user when one exists.
//
// NOTE: this file only has optionalAuth. requireMerchant lives in
// middleware/auth.js and gates the merchant portal routes
// (routes/merchant.js, routes/merchantShop.js) — it's not needed here
// because admin-side food routes are locked down separately.
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');

async function optionalAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return next();
    const { data, error } = await supabase.auth.getUser(match[1]);
    if (!error && data && data.user) {
      req.authUser = { id: data.user.id, email: data.user.email };
      req.userId = data.user.id;
    }
    return next();
  } catch (err) {
    console.error('optionalAuth error:', err);
    return next(); // never block on optional auth
  }
}

module.exports = { optionalAuth };
