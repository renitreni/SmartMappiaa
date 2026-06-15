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

const SELF_ROLES = ['passenger', 'driver'];

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

    // Admins are implicitly approved; otherwise keep current approval state.
    const driverApproved = role === 'admin' ? true : (existing ? existing.driver_approved : false);

    const { data: profile, error } = await supabase
      .from('profiles')
      .upsert(
        {
          id,
          role,
          email: email || null,
          full_name: b.full_name ?? (existing ? undefined : null),
          whatsapp_number: b.whatsapp_number ?? undefined,
          mobile_number: b.mobile_number ?? undefined,
          date_of_birth: b.date_of_birth ?? undefined,
          gender: b.gender ?? undefined,
          national_id: b.national_id ?? undefined,
          vehicle_type: b.vehicle_type ?? undefined,
          vehicle_plate: b.vehicle_plate ?? undefined,
          driver_approved: driverApproved,
        },
        { onConflict: 'id' }
      )
      .select('id, role, full_name, whatsapp_number, mobile_number, email, driver_approved, date_of_birth, gender, national_id, vehicle_type, vehicle_plate')
      .single();

    if (error) {
      console.error('syncProfile upsert error:', error);
      return res.status(500).json({ error: error.message });
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

module.exports = { syncProfile };
