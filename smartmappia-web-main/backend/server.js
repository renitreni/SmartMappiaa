// ---------------------------------------------------------------------
// Local development server.
// Run with:  npm run dev   (auto-restart)  or  npm start
//
// On Vercel this file is NOT used — api/index.js is the entrypoint there.
// ---------------------------------------------------------------------
require('dotenv').config(); // load .env BEFORE anything reads process.env
const app = require('./app');
const { startDispatchSweeper } = require('./lib/dispatch');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Smart Mappia API running on http://localhost:${PORT}`);
  // Grab-style dispatch: expire 30s driver offers and cascade to the next
  // driver. Long-running server only (Hostinger VPS / local); on serverless
  // there is no interval — jobs still surface via the open-pool fallback.
  startDispatchSweeper();
});
