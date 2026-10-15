const { AuthClient } = require('@supabase/auth-js');
const { fetchWithTimeout } = require('./httpTimeout');

// Authentication uses HTTP only. Constructing the full Supabase client here
// also initializes Realtime, which requires a WebSocket transport on Node 20.
function authClient(storage) {
  const url = new URL(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    auth: new AuthClient({
      url: `${url.href.replace(/\/$/, '')}/auth/v1`,
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      // Match supabase-js so in-flight PKCE recovery flows keep working.
      storageKey: `sb-${url.hostname.split('.')[0]}-auth-token`,
      persistSession: !!storage,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
      fetch: fetchWithTimeout(10000),
      ...(storage ? { storage } : {}),
    }),
  };
}

module.exports = { authClient };
