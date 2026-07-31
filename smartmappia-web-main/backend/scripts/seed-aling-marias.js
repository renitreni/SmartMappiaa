// ---------------------------------------------------------------------
// Seed (or repair) Aling Maria's Specialties — listed restaurant with
// no menu yet (customers see a "menu coming soon" alert on the food home).
//
//   npm run seed:aling-marias
// ---------------------------------------------------------------------
require('dotenv').config();
const { supabase } = require('../lib/supabase');

const MERCHANT = {
  name: "Aling Maria's Specialties",
  cuisine_type: 'Filipino',
  description: '100% all natural, finest quality ingredients — food crafted, made with love.',
  logo_url: '/brands/aling-marias.png',
  address: 'Riyadh, Saudi Arabia',
  is_active: true,
  status: 'active',
  is_featured: true,
  badge: 'new',
  service_radius_km: 15,
};

async function run() {
  const { data: existing, error: findErr } = await supabase
    .from('merchants')
    .select('id, name')
    .ilike('name', "%aling maria%")
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;

  if (existing?.id) {
    const { error } = await supabase.from('merchants').update(MERCHANT).eq('id', existing.id);
    if (error) throw error;
    console.log(`✅ Updated Aling Maria's Specialties (${existing.id}) — no menu items (coming soon).`);
    return;
  }

  const { data: created, error } = await supabase
    .from('merchants')
    .insert(MERCHANT)
    .select('id, name')
    .single();
  if (error) throw error;
  console.log(`✅ Created Aling Maria's Specialties (${created.id}) — listed with empty menu.`);
}

run().catch((err) => {
  console.error('seed-aling-marias failed:', err.message || err);
  process.exit(1);
});
