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

function profileSelectColumns(extended, v2 = false) {
  let cols =
    'id, role, full_name, whatsapp_number, mobile_number, email, driver_approved, service_types';
  if (extended) cols += `, ${EXTENDED_FIELDS.join(', ')}`;
  if (v2) cols += `, ${V2_FIELDS.join(', ')}`;
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
  hasExtendedProfileColumns,
  hasProfileV2Columns,
  profileSelectColumns,
  buildProfileUpsert,
};
