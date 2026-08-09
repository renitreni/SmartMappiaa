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
import { compressImage } from './imageCompress';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          // Persist the auth session to localStorage so a page refresh keeps the
          // user signed in (this is also the client AuthProvider logs in with),
          // and keep the access token fresh in the background.
          persistSession: true,
          autoRefreshToken: true,

          // PKCE, not the library default of implicit.
          //
          // On the implicit flow a password-reset link lands as
          //   https://smartmappia.com/#access_token=eyJhbGci...&refresh_token=...
          // — a LIVE SESSION sitting in the address bar. The fragment never
          // reaches a server (browsers do not transmit it, and it is stripped
          // from Referer), so it stays out of our logs, but it is still visible
          // over the shoulder, kept in browser history until it expires, and
          // readable by any script on the page via window.location.hash.
          //
          // PKCE sends `?code=` instead. The code is single-use and worthless
          // without a verifier held in this browser's localStorage, which never
          // travels — so a screenshot of the URL gives an attacker nothing.
          //
          // TRADEOFF, and it is real: the reset must FINISH in the browser that
          // STARTED it, because that is where the verifier lives. Request on a
          // phone and open the mail on a laptop and the exchange fails.
          // ResetPasswordPage reports that as an expired link with a "request a
          // new one" path rather than a dead end.
          flowType: 'pkce',
        },
        realtime: { params: { eventsPerSecond: 10 } },
      })
    : null;

export const realtimeEnabled = !!supabase;

// Upload a file to a backend-issued signed upload URL.
//
// Every storage upload in the app goes through here, which makes it the one
// place worth downscaling: see imageCompress.js for why the 1 GB free tier
// makes that necessary. Non-images and already-small files pass through.
export async function uploadProofFile(bucket, path, token, file) {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }
  const payload = await compressImage(file);
  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, payload);
  if (error) throw error;
  return true;
}
