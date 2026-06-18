// ---------------------------------------------------------------------
// Verify required Supabase migrations are applied.
//   npm run check:migrations
// ---------------------------------------------------------------------
require('dotenv').config();
const { supabase } = require('../lib/supabase');

const CHECKS = [
  {
    id: '0001',
    name: 'profiles table',
    run: async () => {
      const { error } = await supabase.from('profiles').select('id, role').limit(0);
      return error ? error.message : null;
    },
  },
  {
    id: '0002',
    name: 'driver_approved column',
    run: async () => {
      const { error } = await supabase.from('profiles').select('driver_approved').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0002_auth_driver_approval.sql',
  },
  {
    id: '0003',
    name: 'extended registration fields',
    run: async () => {
      const { error } = await supabase.from('profiles').select('date_of_birth').limit(0);
      return error ? error.message : null;
    },
    sqlFile: '0003_profile_registration_fields.sql',
  },
];

async function main() {
  console.log('Checking Smart Mappia database migrations...\n');
  let failed = 0;

  for (const check of CHECKS) {
    const err = await check.run();
    if (err) {
      failed += 1;
      console.log(`❌ ${check.id} ${check.name}`);
      console.log(`   ${err}`);
      if (check.sqlFile) {
        console.log(`   → Run backend/migrations/${check.sqlFile} in Supabase → SQL Editor\n`);
      } else {
        console.log('   → Run backend/migrations/0001_init_smart_mappia.sql first\n');
      }
    } else {
      console.log(`✅ ${check.id} ${check.name}`);
    }
  }

  if (failed) {
    console.log('\nFix the failed migrations, then run: npm run seed:admin');
    process.exit(1);
  }

  console.log('\nAll migrations look good.');
}

main().catch((err) => {
  console.error('check-migrations failed:', err.message || err);
  process.exit(1);
});
