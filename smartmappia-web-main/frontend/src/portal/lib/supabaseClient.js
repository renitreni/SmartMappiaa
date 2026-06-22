// ---------------------------------------------------------------------
// Supabase anon client (frontend).
//
// Used for two things only:
//   1. Subscribing to Realtime Broadcast channels (live updates).
//   2. Uploading a payment-proof file straight to private Storage via a
//      signed upload URL/token issued by the backend.
//
// If the env vars are absent the app still works — realtime falls back to
// polling and the proof-upload step shows a configuration hint.
// ---------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        // Persist the auth session to localStorage so a page refresh keeps the
        // user signed in (this is also the client AuthProvider logs in with),
        // and keep the access token fresh in the background.
        auth: { persistSession: true, autoRefreshToken: true },
        realtime: { params: { eventsPerSecond: 10 } },
      })
    : null;

export const realtimeEnabled = !!supabase;

// Upload a file to a backend-issued signed upload URL.
export async function uploadProofFile(bucket, path, token, file) {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }
  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file);
  if (error) throw error;
  return true;
}
