// ---------------------------------------------------------------------
// Supabase client (SERVER ONLY).
//
// This uses the SERVICE ROLE key, which bypasses Row-Level Security.
// That is exactly what we want on the backend (so the server can do
// trusted work like verifying payments and writing the ledger), but it
// also means this key must NEVER reach the browser/frontend.
// ---------------------------------------------------------------------
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Copy .env.example to .env and fill in your Supabase values.'
  );
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  // Node < 22 has no native WebSocket; `ws` is required for the Realtime client.
  realtime: { transport: WebSocket },
});

module.exports = { supabase };
