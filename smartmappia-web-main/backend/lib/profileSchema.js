// ---------------------------------------------------------------------
// Detect whether the optional profile migrations have been run.
//
// A POSITIVE result is cached forever — columns never disappear. A NEGATIVE
// result is only cached briefly: otherwise running the migration has no
// effect until someone restarts the API, which is exactly the trap that
// kept "run 0024" on screen after 0024 had already been applied.
// ---------------------------------------------------------------------

const MISSING_RECHECK_MS = 60 * 1000;

let extendedProfileColumns = null;
let extendedCheckedAt = 0;
let profileV2Columns = null;
let v2CheckedAt = 0;
let savedDeliveryColumns = null;
let savedDeliveryCheckedAt = 0;
let superAdminColumns = null;
let superAdminCheckedAt = 0;

// True when we can trust the cached answer: present columns are permanent,
// absent ones get re-probed once the backoff window expires.
function cacheFresh(value, checkedAt) {
  if (value === true) return true;
  if (value === null) return false;
  return Date.now() - checkedAt < MISSING_RECHECK_MS;
}

const EXTENDED_FIELDS = [
  'date_of_birth',
  'gender',
  'national_id',
  'vehicle_type',
  'vehicle_plate',
];

// Migration 0024: avatar_url + address (Profile page).
const V2_FIELDS = ['avatar_url', 'address'];
const SAVED_DELIVERY_FIELDS = [
  'delivery_lat',
  'delivery_lng',
  'delivery_street',
  'delivery_building',
];

async function hasExtendedProfileColumns(supabase) {
  if (cacheFresh(extendedProfileColumns, extendedCheckedAt)) return extendedProfileColumns;
  const { error } = await supabase.from('profiles').select('date_of_birth').limit(0);
  extendedProfileColumns = !error;
  extendedCheckedAt = Date.now();
  if (!extendedProfileColumns) {
    console.warn(
      '[profiles] Migration backend/migrations/0003_profile_registration_fields.sql is missing. ' +
        'Login still works, but signup extras (DOB, gender, vehicle, etc.) are skipped until you run it in Supabase SQL Editor.'
    );
  }
  return extendedProfileColumns;
}

async function hasProfileV2Columns(supabase) {
  if (cacheFresh(profileV2Columns, v2CheckedAt)) return profileV2Columns;
  const { error } = await supabase.from('profiles').select('avatar_url').limit(0);
  profileV2Columns = !error;
  v2CheckedAt = Date.now();
  if (!profileV2Columns) {
    console.warn(
      '[profiles] Migration backend/migrations/0024_profile_and_contact.sql is missing. ' +
        'Login still works, but profile pictures + saved addresses are disabled until you run it in Supabase SQL Editor.'
    );
  }
  return profileV2Columns;
}

// Migration 0045: the rest of a reusable delivery location. `address` was
// already present in 0024, but checkout also needs an exact pin plus the
// street/building details. Probe this independently so deploying the API
// before the migration cannot break sign-in for every account.
async function hasSavedDeliveryColumns(supabase) {
  if (cacheFresh(savedDeliveryColumns, savedDeliveryCheckedAt)) return savedDeliveryColumns;
  const { error } = await supabase.from('profiles').select('delivery_lat').limit(0);
  savedDeliveryColumns = !error;
  savedDeliveryCheckedAt = Date.now();
  if (!savedDeliveryColumns) {
    console.warn(
      '[profiles] Migration backend/migrations/0045_saved_delivery_location.sql is missing. ' +
        'Login still works, but delivery map pins cannot be saved until it is applied.'
    );
  }
  return savedDeliveryColumns;
}

// Migration 0043: is_super_admin + disabled_at.
//
// Probed rather than assumed because requireAuth selects these on EVERY
// authenticated request. Naming a column that does not exist fails the
// whole select, so shipping this code before the SQL is applied would 403
// every user on the platform, not just admins - the same shape as the
// outage 0019 caused. Until the migration lands the app behaves exactly as
// it did before: no super admins, nobody deactivated.
async function hasSuperAdminColumns(supabase) {
  if (cacheFresh(superAdminColumns, superAdminCheckedAt)) return superAdminColumns;
  const { error } = await supabase.from('profiles').select('is_super_admin').limit(0);
  superAdminColumns = !error;
  superAdminCheckedAt = Date.now();
  if (!superAdminColumns) {
    console.warn(
      '[profiles] Migration backend/migrations/0043_super_admin_settings_and_login_events.sql is missing. ' +
        'Login still works, but the super-admin tier and account deactivation are inert until you run it in Supabase SQL Editor.'
    );
  }
  return superAdminColumns;
}

// `tiered` is hasSuperAdminColumns(): the 0043 columns cannot be named
// before the migration is applied, or the whole select fails.
//
// Leaving them out was a real bug, not a cosmetic one. This list is what
// /api/auth/sync returns, profileJson maps is_super_admin off that row, and
// the portal decides whether to show the super-admin tabs from it — so a
// seeded, correctly flagged super admin still saw no tabs, and no error
// anywhere said why.
function profileSelectColumns(extended, v2 = false, tiered = false, savedDelivery = false) {
  let cols =
    'id, role, full_name, whatsapp_number, mobile_number, email, driver_approved, service_types';
  if (extended) cols += `, ${EXTENDED_FIELDS.join(', ')}`;
  if (v2) cols += `, ${V2_FIELDS.join(', ')}`;
  if (savedDelivery) cols += `, ${SAVED_DELIVERY_FIELDS.join(', ')}`;
  if (tiered) cols += ', is_super_admin, disabled_at';
  return cols;
}

function applyOptionalField(row, key, value) {
  if (value !== undefined) row[key] = value;
}

function buildProfileUpsert({ id, role, email, driverApproved, existing, body, extended }) {
  const row = {
    id,
    role,
    email: email || null,
    driver_approved: driverApproved,
  };

  if (body.full_name !== undefined) {
    row.full_name = body.full_name;
  } else if (!existing) {
    row.full_name = null;
  }

  applyOptionalField(row, 'whatsapp_number', body.whatsapp_number);
  applyOptionalField(row, 'mobile_number', body.mobile_number);

  if (extended) {
    for (const key of EXTENDED_FIELDS) {
      applyOptionalField(row, key, body[key]);
    }
  }

  return row;
}

module.exports = {
  EXTENDED_FIELDS,
  V2_FIELDS,
  SAVED_DELIVERY_FIELDS,
  hasExtendedProfileColumns,
  hasProfileV2Columns,
  hasSavedDeliveryColumns,
  hasSuperAdminColumns,
  profileSelectColumns,
  buildProfileUpsert,
};
