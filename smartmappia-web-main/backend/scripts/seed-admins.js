// Provision the named administrator accounts in the app-owned PostgreSQL store.
require('dotenv').config();
const crypto = require('node:crypto');
const { seedAccount } = require('./lib/seedAccount');

const ADMINS = [
  { email: 'ruth@smartmappia.com', full_name: 'Ruth' },
  { email: 'nawaf@smartmappia.com', full_name: 'Nawaf' },
];
const strongPassword = () => crypto.randomBytes(15).toString('base64url');

(async () => {
  const results = [];
  for (const admin of ADMINS) {
    const password = strongPassword();
    const result = await seedAccount({
      ...admin, password,
      profile: { role: 'admin', full_name: admin.full_name, driver_approved: true },
    });
    results.push({ ...admin, password, created: result.created });
  }
  for (const admin of results) {
    console.log(`${admin.full_name} (${admin.created ? 'created' : 'password reset'})`);
    console.log(`  email: ${admin.email}\n  password: ${admin.password}`);
  }
  console.log('Deliver these temporary passwords privately and require a password change.');
})().catch((error) => {
  console.error('seed-admins failed:', error.message || error);
  process.exitCode = 1;
});
