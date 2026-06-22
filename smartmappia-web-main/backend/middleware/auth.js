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
//   requireDriver         -> requireAuth + role 'driver'        (req.driverId)
//   requireApprovedDriver -> requireDriver + driver_approved = true
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');

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

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role, full_name, whatsapp_number, mobile_number, email, driver_approved')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      return res.status(403).json({ error: 'Profile not set up. Please complete registration.' });
    }
    req.profile = profile;
    req.role = profile.role;
    req.userId = profile.id;
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

function requireApprovedDriver(req, res, next) {
  requireDriver(req, res, () => {
    // Admin bypasses the approval gate (admins are implicitly approved).
    if (req.role !== 'admin' && !req.profile.driver_approved) {
      return res.status(403).json({ error: 'Your driver account is pending admin approval' });
    }
    return next();
  });
}

module.exports = { requireToken, requireAuth, requireAdmin, requireDriver, requireApprovedDriver };
