// Create or repair the local test passenger account in PostgreSQL.
require('dotenv').config();
const { seedAccount } = require('./lib/seedAccount');

const email = String(process.env.USER_SEED_EMAIL || 'user123@smartmappia.com').toLowerCase();
const password = process.env.USER_SEED_PASSWORD || 'user123';

seedAccount({
  email, password,
  profile: { role: 'passenger', full_name: 'Test User', whatsapp_number: '+966500000001' },
}).then(({ created }) => {
  console.log(`${created ? 'Created' : 'Repaired'} PostgreSQL test user for ${email}.`);
}).catch((error) => {
  console.error('seed-user failed:', error.message || error);
  process.exitCode = 1;
});
