// ---------------------------------------------------------------------
// Auth middleware (Supabase JWT).
//
// The frontend authenticates with Supabase Auth and sends the access token
// as `Authorization: Bearer <jwt>`. We verify it with Supabase, then load
// the matching `profiles` row to get the app role + driver approval state.
//
//   requireToken          -> valid token only (profile may not exist yet)
//   requireAuth           -> valid token + an existing profile  (req.userId)
//   requireAdmin          -> requireAuth + role 'admin'         (req.adminId)
//   requireSuperAdmin     -> requireAdmin + is_super_admin      (req.superAdminId)
//   requireDriver         -> requireAuth + role 'driver'        (req.driverId)
//   requireMerchant       -> requireAuth + role 'merchant'      (req.merchantOwnerId)
//   requireMerchantVertical('food'|'shop')
//                         -> requireMerchant + that merchant's vertical (req.merchant)
//   requireApprovedDriver -> requireDriver + driver_approved = true
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { setContextUser } = require('../lib/requestContext');
const { hasSuperAdminColumns } = require('../lib/profileSchema');

function getBearer(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function authenticate(req) {
  const token = getBearer(req);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

async function requireToken(req, res, next) {
  try {
    const user = await authenticate(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    req.authUser = { id: user.id, email: user.email };
    return next();
  } catch (err) {
    console.error('requireToken error:', err);
    return res.status(500).json({ error: 'Auth check failed' });
  }
}

async function requireAuth(req, res, next) {
  try {
    const user = await authenticate(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    req.authUser = { id: user.id, email: user.email };

    // 0043 columns are probed, not assumed — see hasSuperAdminColumns.
    // This select runs on every authenticated request, so naming a column
    // that is not there yet would 403 the entire platform.
    const tiered = await hasSuperAdminColumns(supabase);
    const { data: profile } = await supabase
      .from('profiles')
      .select(
        'id, role, full_name, whatsapp_number, mobile_number, email, driver_approved, service_types' +
          (tiered ? ', is_super_admin, disabled_at' : '')
      )
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      return res.status(403).json({ error: 'Profile not set up. Please complete registration.' });
    }
    // Deactivated (0043). Banning the Supabase auth user is what stops a
    // NEW sign-in; this is what stops a session that was already issued —
    // without it a deactivated admin keeps full access until their JWT
    // expires, which is the window that matters when access is being
    // revoked in a hurry.
    if (profile.disabled_at) {
      return res.status(403).json({ error: 'This account has been deactivated.' });
    }
    req.profile = profile;
    req.role = profile.role;
    req.userId = profile.id;
    // Every other guard composes through this one, so this is what puts a
    // name against a row in the admin Errors page.
    setContextUser({ id: profile.id, email: user.email, role: profile.role });
    return next();
  } catch (err) {
    console.error('requireAuth error:', err);
    return res.status(500).json({ error: 'Auth check failed' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    req.adminId = req.userId;
    return next();
  });
}

// The tier above admin (0043): may create, edit, deactivate and reset the
// password of other admins, and may change app_settings.
//
// is_super_admin is a COLUMN, not a role — adding 'super_admin' to the
// user_role enum would have failed every `role !== 'admin'` check above
// and every is_admin() RLS policy, locking a super admin out of the very
// portal they administer. Composing through requireAdmin also means a
// super admin keeps the whole ordinary admin surface for free.
//
// Unlike requireDriver/requireMerchant there is NO bypass here: a plain
// admin is exactly who this is meant to keep out.
function requireSuperAdmin(req, res, next) {
  requireAdmin(req, res, () => {
    if (!req.profile.is_super_admin) {
      return res.status(403).json({ error: 'Super admin access required' });
    }
    req.superAdminId = req.userId;
    return next();
  });
}

function requireDriver(req, res, next) {
  requireAuth(req, res, () => {
    // Admins may exercise driver routes for testing (the admin "preview as
    // driver" view) — admin passes any role check; routes are not duplicated.
    if (req.role !== 'driver' && req.role !== 'admin') {
      return res.status(403).json({ error: 'Driver access required' });
    }
    req.driverId = req.userId;
    return next();
  });
}

function requireMerchant(req, res, next) {
  requireAuth(req, res, () => {
    if (req.role !== 'merchant' && req.role !== 'admin') {
      return res.status(403).json({ error: 'Business owner access required' });
    }
    req.merchantOwnerId = req.userId;
    return next();
  });
}

// Merchants are single-vertical: merchants.owner_id is UNIQUE, so an owner
// maps to exactly one merchant, and that row's `vertical` (migration 0026)
// decides which portal they get. This guard keeps a restaurant owner out of
// the store API and vice versa.
//
// It attaches req.merchant so the controller does not re-query, and it 403s
// rather than 404s: the caller IS a merchant, just not of this kind, and
// pretending the endpoint does not exist would be misleading to a real user.
// Admins bypass, consistent with every other guard here.
function requireMerchantVertical(vertical) {
  return function guard(req, res, next) {
    requireMerchant(req, res, async () => {
      // requireAuth invokes this callback without awaiting it, so an
      // unhandled rejection here would surface as a process-level crash on
      // Node >= 15. Everything below is wrapped.
      try {
        const { data, error } = await supabase
          .from('merchants')
          .select('id, name, vertical, is_active, status, credit_limit, credit_used')
          .eq('owner_id', req.merchantOwnerId)
          .maybeSingle();
        if (error) {
          console.error('requireMerchantVertical error:', error);
          return res.status(500).json({ error: 'Unexpected server error' });
        }
        // Admin bypass. It still runs the lookup first so req.merchant is
        // populated when the admin happens to own a merchant row — an
        // earlier version returned early and 404'd admins across the whole
        // portal, because every controller resolves the store from
        // req.merchantOwnerId.
        if (req.role === 'admin') {
          if (data) req.merchant = data;
          return next();
        }
        if (!data) {
          return res.status(404).json({ error: 'No business profile is linked to this account' });
        }
        if ((data.vertical || 'food') !== vertical) {
          return res.status(403).json({
            error:
              vertical === 'shop'
                ? 'This account manages a restaurant, not a store'
                : 'This account manages a store, not a restaurant',
          });
        }
        req.merchant = data;
        return next();
      } catch (err) {
        console.error('requireMerchantVertical error:', err);
        return res.status(500).json({ error: 'Unexpected server error' });
      }
    });
  };
}

function requireApprovedDriver(req, res, next) {
  requireDriver(req, res, () => {
    // Admin bypasses the approval gate (admins are implicitly approved).
    if (req.role !== 'admin' && !req.profile.driver_approved) {
      // Otherwise-invisible rejection (e.g. the driver's location pings just
      // vanish client-side) — log it so a revoked/pending approval shows up
      // in server logs instead of looking like a random dead GPS feed.
      console.warn('[auth] 403 not-approved-driver', { userId: req.userId, path: req.originalUrl });
      return res.status(403).json({ error: 'Your driver account is pending admin approval' });
    }
    return next();
  });
}

module.exports = {
  requireToken,
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  requireDriver,
  requireMerchant,
  requireMerchantVertical,
  requireApprovedDriver,
};
