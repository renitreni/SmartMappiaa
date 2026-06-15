// =====================================================================
// DEMO-ONLY shared helpers.  ⚠️  NOT used by the real app.
//
// Everything under backend/scripts/demo/ exists purely to seed sample data
// for presentations. To strip all demo tooling, delete this whole folder
// and the "seed:demo / seed:pay / seed:request / seed:clean" npm scripts.
// (Run `npm run seed:clean` first to remove demo data from the database.)
//
// Every booking these scripts create is tagged with notes = DEMO_TAG so the
// cleanup script can find and remove exactly the demo rows and nothing else.
// =====================================================================
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

// Marker stamped on every demo booking (notes column). Cleanup keys off this.
const DEMO_TAG = '__DEMO__';

// The demo driver account (also removed by seed:clean).
const DEMO_DRIVER = {
  email: 'driver1@smartmappia.com',
  password: '***REMOVED***',
  full_name: 'Ahmed (Demo Driver)',
  whatsapp_number: '+966512345678',
};

// Riyadh coordinates used across the demo.
const PICKUP = { lat: 24.6913, lng: 46.6852, address: 'Al Olaya, Riyadh' };
const DROPOFF = { lat: 24.9576, lng: 46.7012, address: 'King Khalid Intl — Terminal 1' };
const DRIVER_AT = { lat: 24.72, lng: 46.69 }; // a few km out -> shows a live ETA

const frontendBase = () => process.env.DEMO_FRONTEND_URL || 'http://localhost:5173';

async function findUserByEmail(email) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = (data.users || []).find((x) => (x.email || '').toLowerCase() === email);
    if (u) return u;
    if (!data.users || data.users.length < 200) break;
  }
  return null;
}

// Create (or reuse) the approved demo driver; returns its id.
async function ensureDemoDriver() {
  let id;
  const { data: created, error } = await supabase.auth.admin.createUser({
    email: DEMO_DRIVER.email,
    password: DEMO_DRIVER.password,
    email_confirm: true,
  });
  if (error) {
    const existing = await findUserByEmail(DEMO_DRIVER.email);
    if (!existing) throw error;
    id = existing.id;
  } else {
    id = created.user.id;
  }
  await supabase.from('profiles').upsert(
    {
      id,
      role: 'driver',
      full_name: DEMO_DRIVER.full_name,
      whatsapp_number: DEMO_DRIVER.whatsapp_number,
      email: DEMO_DRIVER.email,
      driver_approved: true,
    },
    { onConflict: 'id' }
  );
  return id;
}

// Common booking fields (always tagged DEMO_TAG). Pass overrides to set status etc.
function demoBooking(overrides = {}) {
  return {
    trip_type: 'house_to_airport',
    airport_terminal: DROPOFF.address,
    pickup_address: PICKUP.address,
    pickup_lat: PICKUP.lat,
    pickup_lng: PICKUP.lng,
    dropoff_address: DROPOFF.address,
    dropoff_lat: DROPOFF.lat,
    dropoff_lng: DROPOFF.lng,
    pickup_datetime: new Date(Date.now() + 3600000).toISOString(),
    passenger_name: 'Sara (Demo Rider)',
    passenger_whatsapp: '+966555555555',
    fare_amount: 103.75,
    currency: 'SAR',
    notes: DEMO_TAG,
    ...overrides,
  };
}

module.exports = {
  supabase,
  DEMO_TAG,
  DEMO_DRIVER,
  PICKUP,
  DROPOFF,
  DRIVER_AT,
  frontendBase,
  findUserByEmail,
  ensureDemoDriver,
  demoBooking,
};
