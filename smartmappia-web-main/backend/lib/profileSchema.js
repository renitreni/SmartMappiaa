// ---------------------------------------------------------------------
// Detect whether migration 0003 (extended profile columns) has been run.
// Cached for the lifetime of the server process.
// ---------------------------------------------------------------------

let extendedProfileColumns = null;

const EXTENDED_FIELDS = [
  'date_of_birth',
  'gender',
  'national_id',
  'vehicle_type',
  'vehicle_plate',
];

async function hasExtendedProfileColumns(supabase) {
  if (extendedProfileColumns !== null) return extendedProfileColumns;
  const { error } = await supabase.from('profiles').select('date_of_birth').limit(0);
  extendedProfileColumns = !error;
  if (!extendedProfileColumns) {
    console.warn(
<<<<<<< HEAD
      '[profiles] Migration 0003_profile_registration_fields.sql is missing. ' +
=======
      '[profiles] Migration backend/migrations/0003_profile_registration_fields.sql is missing. ' +
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
        'Login still works, but signup extras (DOB, gender, vehicle, etc.) are skipped until you run it in Supabase SQL Editor.'
    );
  }
  return extendedProfileColumns;
}

function profileSelectColumns(extended) {
  const base =
    'id, role, full_name, whatsapp_number, mobile_number, email, driver_approved';
  if (!extended) return base;
  return `${base}, ${EXTENDED_FIELDS.join(', ')}`;
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
  hasExtendedProfileColumns,
  profileSelectColumns,
  buildProfileUpsert,
};
