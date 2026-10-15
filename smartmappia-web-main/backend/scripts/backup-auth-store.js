require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { getAuthStore } = require('../lib/authStore');

async function main() {
  const destination = process.argv[2];
  if (!destination || !path.isAbsolute(destination)) {
    throw new Error('Usage: npm run backup:sessions -- /absolute/path/to/new-backup.sqlite');
  }
  process.umask(0o077);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  // Refuse to replace any existing file, including the active database.
  fs.closeSync(fs.openSync(destination, 'wx', 0o600));
  const store = getAuthStore();
  try {
    await store.backup(destination);
    console.log(`Session database backed up to ${destination}`);
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
