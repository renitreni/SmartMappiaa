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

const SELF_ROLES = ['passenger', 'driver'];

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

    return res.json({
      id: profile.id,
      role: profile.role,
      fullName: profile.full_name,
      whatsapp: profile.whatsapp_number,
      mobile: profile.mobile_number,
      email: profile.email,
      driverApproved: profile.driver_approved,
    });
  } catch (err) {
    console.error('syncProfile error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { signup, syncProfile };
