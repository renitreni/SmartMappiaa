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
  hasProfileV2Columns,
  profileSelectColumns,
  buildProfileUpsert,
} = require('../lib/profileSchema');
const { buildAvatarPath, createAvatarUploadUrl, avatarPublicUrl } = require('../lib/storage');
const { opsError } = require('../lib/opsError');
const { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } = require('../lib/validate');

// The camelCase profile JSON every auth endpoint returns to the UI.
function profileJson(profile, merchant = null) {
  return {
    id: profile.id,
    role: profile.role,
    fullName: profile.full_name,
    whatsapp: profile.whatsapp_number,
    mobile: profile.mobile_number,
    email: profile.email,
    driverApproved: profile.driver_approved,
    serviceTypes: profile.service_types,
    avatarUrl: profile.avatar_url ?? null,
    address: profile.address ?? null,
    merchant,
  };
}

// Roles a user may pick for themselves at signup. Admin is env-list only.
// Merchant (restaurant owner) accounts are provisioned by admins after partnership
// approval — not via public self-registration (see adminFoodController.setMerchantOwner).
const SELF_ROLES = ['passenger', 'driver'];

// Basic email shape enforced at the public signup boundary. The password
// bounds live in lib/validate.js — the admin merchant-owner endpoints apply
// the same ones.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    if (!EMAIL_RE.test(email) || email.length > 200) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (String(password).length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` });
    }
    // Admin accounts are provisioned ONLY via the server-side seed scripts and
    // the ADMIN_EMAILS allow-list — never through public self-registration.
    // Without this guard an attacker could register an as-yet-unclaimed admin
    // email (createUser below auto-confirms it) and then be handed the admin
    // role by the auto-admin-by-email rule in syncProfile. Refuse outright.
    if (config.adminEmails.includes(email)) {
      return res.status(403).json({
        error: 'This email is reserved. Please contact Smart Mappia support.',
      });
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

    // PRIVILEGE ESCALATION GUARD.
    //
    // Admin is derived from the auth email matching ADMIN_EMAILS. POST /signup
    // refuses those addresses outright (control #3, handbook §13.3.4) — but a
    // user can also change their own auth email AFTER registering, straight
    // from the Profile page via supabase.auth.updateUser({ email }). Without
    // the check below that was a complete bypass:
    //
    //   register as a passenger
    //   -> updateUser({ email: '<a known admin address>' })
    //   -> POST /api/auth/sync
    //   -> role = 'admin', full /api/admin surface
    //
    // Supabase's "Secure email change" setting mitigates it by requiring
    // confirmation at the target address, but a dashboard toggle is not a
    // control we own. An admin-email claim arriving on an ALREADY EXISTING
    // non-admin profile is never legitimate: real admins are provisioned by
    // the seed scripts, which write the profile row with role 'admin' before
    // anyone signs in, so they match the `existing.role === 'admin'` branch.
    if (isAdminEmail && existing && existing.role !== 'admin') {
      console.error('[SECURITY] admin-email claim on an existing non-admin profile', {
        userId: id,
        email: emailLc,
        currentRole: existing.role,
      });
      return res.status(403).json({
        error: 'This email address is reserved. Please contact Smart Mappia support.',
      });
    }

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
    const v2 = await hasProfileV2Columns(supabase);
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
      .select(profileSelectColumns(extended, v2))
      .single();

    if (error) {
      console.error('syncProfile upsert error:', error);
      const schemaLooksIncomplete =
        (error.message || '').includes('date_of_birth') ||
        (error.message || '').includes('driver_approved') ||
        (error.message || '').includes('service_types');
      return res.status(500).json(
        opsError(
          req,
          'Could not sync your profile.',
          schemaLooksIncomplete
            ? 'Database migrations may be incomplete — run the SQL files in backend/migrations/ (0001, 0002, 0003, 0020) in the Supabase SQL Editor.'
            : null
        )
      );
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

    return res.json(profileJson(profile, merchant));
  } catch (err) {
    console.error('syncProfile error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// PATCH /api/auth/profile  (requireAuth)
// The Profile page: update name / phones / address / avatar. Email and
// password changes go through Supabase Auth on the client — never here.
async function updateProfile(req, res) {
  try {
    const b = req.body; // whitelisted by the route schema
    const v2 = await hasProfileV2Columns(supabase);

    const patch = {};
    for (const key of ['full_name', 'mobile_number', 'whatsapp_number']) {
      if (key in b) patch[key] = b[key] || null;
    }
    if (v2) {
      for (const key of ['address', 'avatar_url']) {
        if (key in b) patch[key] = b[key] || null;
      }
    } else if ('address' in b || 'avatar_url' in b) {
      return res.status(409).json(
        opsError(
          req,
          'Saved addresses and profile pictures are temporarily unavailable. Your other details were not changed.',
          'Run backend/migrations/0024_profile_and_contact.sql in the Supabase SQL Editor.'
        )
      );
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const extended = await hasExtendedProfileColumns(supabase);
    const { data: profile, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', req.userId)
      .select(profileSelectColumns(extended, v2))
      .single();
    if (error || !profile) {
      console.error('updateProfile error:', error);
      return res.status(500).json({ error: 'Could not update your profile' });
    }

    return res.json(profileJson(profile));
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// POST /api/auth/avatar/signed-url  (requireAuth)
// Signed upload for the PUBLIC avatars bucket; the client uploads then
// saves the returned publicUrl via PATCH /api/auth/profile.
async function createAvatarUploadUrlHandler(req, res) {
  try {
    const { file_name, mime_type } = req.body;
    if (!mime_type || !config.avatars.allowedMimeTypes.includes(mime_type)) {
      return res.status(400).json({
        error: `mime_type must be one of: ${config.avatars.allowedMimeTypes.join(', ')}`,
      });
    }

    const path = buildAvatarPath(req.userId, file_name);
    const { token, signedUrl } = await createAvatarUploadUrl(path);

    return res.status(201).json({
      bucket: config.avatars.bucket,
      path,
      token,
      signedUrl,
      publicUrl: avatarPublicUrl(path),
      maxBytes: config.avatars.maxBytes,
    });
  } catch (err) {
    console.error('createAvatarUploadUrl error:', err);
    return res.status(500).json({ error: 'Could not create upload URL' });
  }
}

module.exports = { signup, syncProfile, updateProfile, createAvatarUploadUrlHandler };
