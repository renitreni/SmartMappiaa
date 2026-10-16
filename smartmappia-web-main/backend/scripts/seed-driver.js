// Create or repair the local test driver account in PostgreSQL.
require('dotenv').config();
const { seedAccount } = require('./lib/seedAccount');

const email = String(process.env.DRIVER_SEED_EMAIL || 'driver123@smartmappia.com').toLowerCase();
const password = process.env.DRIVER_SEED_PASSWORD || 'driver123';

seedAccount({
  email, password,
  profile: {
    role: 'driver', full_name: 'Test Driver', whatsapp_number: '+966500000002', driver_approved: true,
  },
}).then(() => {
  console.log(`PostgreSQL test driver ready for ${email} (pre-approved).`);
}).catch((error) => {
  console.error('seed-driver failed:', error.message || error);
  process.exitCode = 1;
});
