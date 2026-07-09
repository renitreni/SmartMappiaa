// ---------------------------------------------------------------------
// Auth controller
//   - syncProfile : POST /api/auth/sync   (requireToken)
//
// Called by the frontend right after signup/login. It upserts the caller's
// `profiles` row from their verified token + the role/details they chose,
// and applies the automatic-admin rule (email in ADMIN_EMAILS -> admin).
//
// Role can never be self-elevated to admin via the request body; admin is
// granted ONLY by the env allow-list. Existing admins stay admins.
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { config } = require('../lib/config');
const {
  hasExtendedProfileColumns,
  profileSelectColumns,
  buildProfileUpsert,
} = require('../lib/profileSchema');

// Roles a user may pick for themselves at signup. Admin is env-list only.
// Merchant (restaurant owner) accounts are provisioned by admins after partnership
// approval — not via public self-registration (see adminFoodController.setMerchantOwner).
const SELF_ROLES = ['passenger', 'driver'];

function merchantPayload(body, ownerId) {
  const name = String(body.business_name || body.merchant_name || '').trim();
  if (!name) return null;
  return {
    owner_id: ownerId,
    name,
    cuisine_type: body.cuisine_type || null,
    description: body.business_description || body.description || null,
    logo_url: body.logo_url || null,
    address: body.business_address || body.address || null,
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    is_active: false, // admin still controls public listing/vetting
  };
}

async function ensureMerchantForOwner(ownerId, body) {
  const payload = merchantPayload(body, ownerId);
  if (!payload) return null;

  const { data: existing, error: existingErr } = await supabase
    .from('merchants')
    .select('id')
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (existingErr) throw existingErr;

  const query = existing
    ? supabase.from('merchants').update(payload).eq('id', existing.id)
    : supabase.from('merchants').insert(payload);

  const { data, error } = await query
    .select('id, name, cuisine_type, description, logo_url, address, lat, lng, is_active, status')
    .single();
  if (error) throw error;
  return data;
}

// POST /api/auth/signup  (public)
// Creates the account server-side with its email ALREADY confirmed, so no
// confirmation email is ever needed. The frontend signs in right after, and
// /api/auth/sync then creates the profile with the chosen role.
async function signup(req, res) {
  try {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const password = b.password || '';

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (b.role === 'merchant') {
      return res.status(403).json({
        error: 'Restaurant owner accounts are created by Smart Mappia after partnership approval. Please contact us to get started.',
      });
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // <- skips the confirmation email entirely
      user_metadata: {
        full_name: b.full_name || null,
        whatsapp_number: b.whatsapp_number || null,
        mobile_number: b.mobile_number || null,
      },
    });

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('already') || error.status === 422) {
        return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
      }
      console.error('signup error:', error);
      return res.status(500).json({ error: 'Could not create the account. Please try again.' });
    }

    return res.status(201).json({ id: data.user.id, email: data.user.email });
  } catch (err) {
    console.error('signup error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function syncProfile(req, res) {
  try {
    const { id, email } = req.authUser;
    const b = req.body || {};
    const emailLc = (email || '').toLowerCase();
    const isAdminEmail = config.adminEmails.includes(emailLc);

    const { data: existing } = await supabase
      .from('profiles')
      .select('role, driver_approved')
      .eq('id', id)
      .maybeSingle();

    // Decide the role.
    let role;
    if (isAdminEmail || (existing && existing.role === 'admin')) {
      role = 'admin';
    } else if (b.role === 'merchant' && (!existing || existing.role !== 'merchant')) {
      // Block self-service merchant signup; admins provision owner accounts separately.
      return res.status(403).json({
        error: 'Restaurant owner accounts are created by Smart Mappia after partnership approval. Please contact us to get started.',
      });
    } else if (SELF_ROLES.includes(b.role)) {
      role = b.role;
    } else {
      role = (existing && existing.role) || 'passenger';
    }

    // Production policy: drivers must be verified by an admin (document-based,
    // see driver_documents) before they can carry passengers. New drivers start
    // UNAPPROVED and go through the verification flow; admins are implicitly
    // approved. Existing drivers keep whatever approval they already have.
    const driverApproved = role === 'admin' ? true : (existing ? existing.driver_approved : false);

    const extended = await hasExtendedProfileColumns(supabase);
    const upsertRow = buildProfileUpsert({
      id,
      role,
      email,
      driverApproved,
      existing,
      body: b,
      extended,
    });

    const { data: profile, error } = await supabase
      .from('profiles')
      .upsert(upsertRow, { onConflict: 'id' })
      .select(profileSelectColumns(extended))
      .single();

    if (error) {
      console.error('syncProfile upsert error:', error);
      const hint =
        (error.message || '').includes('date_of_birth') ||
        (error.message || '').includes('driver_approved')
          ? ' Database migrations may be incomplete — run the SQL files in backend/migrations/ (0001, 0002, 0003) in the Supabase SQL Editor.'
          : '';
      return res.status(500).json({ error: 'Could not sync your profile.' + hint });
    }

    let merchant = null;
    if (profile.role === 'merchant') {
      try {
        merchant = await ensureMerchantForOwner(profile.id, b);
      } catch (merchantErr) {
        console.error('syncProfile merchant setup error:', merchantErr);
        return res.status(500).json({ error: 'Account created, but business profile setup failed.' });
      }
    }

    return res.json({
      id: profile.id,
      role: profile.role,
      fullName: profile.full_name,
      whatsapp: profile.whatsapp_number,
      mobile: profile.mobile_number,
      email: profile.email,
      driverApproved: profile.driver_approved,
      merchant,
    });
  } catch (err) {
    console.error('syncProfile error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { signup, syncProfile };
