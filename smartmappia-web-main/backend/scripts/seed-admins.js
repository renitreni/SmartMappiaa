// Provision the named administrator accounts in the app-owned PostgreSQL store.
// Passwords are fixed (not generated) so the same script always repairs these
// two accounts to a known state; run it again after a credential change.
require('dotenv').config();
const { seedAccount } = require('./lib/seedAccount');

const ADMINS = [
  { email: 'ferdz@smartmappia.com', full_name: 'Ferdz', password: 'smartmappia2026Sabado' },
  { email: 'ruth@smartmappia.com', full_name: 'Ruth', password: 'smartmappia2026Ruth' },
];

(async () => {
  const results = [];
  for (const admin of ADMINS) {
    const { password, ...account } = admin;
    const result = await seedAccount({
      ...account, password,
      profile: { role: 'admin', full_name: admin.full_name, driver_approved: true },
    });
    results.push({ ...account, created: result.created });
  }
  for (const admin of results) {
    console.log(`${admin.full_name} (${admin.created ? 'created' : 'repaired'})`);
    console.log(`  email: ${admin.email}`);
  }
})().catch((error) => {
  console.error('seed-admins failed:', error.message || error);
  process.exitCode = 1;
});
