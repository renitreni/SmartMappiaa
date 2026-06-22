// ---------------------------------------------------------------------
// Auth context backed by Supabase Auth.
//
// On any sign-in we call POST /api/auth/sync once, which upserts the
// profiles row (role + details) and applies the automatic-admin rule. The
// returned profile (role + driverApproved) is what the UI gates on.
// ---------------------------------------------------------------------
import { createContext, useContext, useEffect, useRef, useState } from 'react';
<<<<<<< HEAD
=======
import { useNavigate } from 'react-router-dom';
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
import { supabase } from './supabaseClient';
import { api } from './api';

const AuthCtx = createContext(null);
const PENDING_KEY = 'sm_pending_profile';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [loading, setLoading] = useState(true);
  const syncedFor = useRef(null);
<<<<<<< HEAD
=======
  const navigate = useNavigate();
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86

  async function loadProfile() {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      const pending = raw ? JSON.parse(raw) : {};
      const p = await api.authSync(pending);
      localStorage.removeItem(PENDING_KEY);
      setProfile(p);
      return p;
    } catch (err) {
      setProfile(null);
      setProfileError(err.message || 'Could not load your profile.');
      return null;
    } finally {
      setProfileLoading(false);
    }
  }

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Sync the profile once per signed-in user.
  useEffect(() => {
    const uid = session?.user?.id;
    if (uid && syncedFor.current !== uid) {
      syncedFor.current = uid;
      loadProfile();
    } else if (!uid) {
      syncedFor.current = null;
      setProfile(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  const value = {
    configured: !!supabase,
    session,
    user: session?.user || null,
    profile,
    profileLoading,
    profileError,
    role: profile?.role || null,
    driverApproved: !!profile?.driverApproved,
    loading,

    async signUp(email, password, details) {
      if (!supabase) throw new Error('Auth is not configured (set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
      // Create the account server-side (email pre-confirmed) so there's no
      // confirmation email, then sign in immediately.
      await api.authSignup({ email, password, ...(details || {}) });
      localStorage.setItem(PENDING_KEY, JSON.stringify(details || {}));
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        localStorage.removeItem(PENDING_KEY);
        throw error;
      }
      return { needsConfirmation: false };
    },

    async signIn(email, password) {
      if (!supabase) throw new Error('Auth is not configured (set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },

    async signOut() {
      if (supabase) await supabase.auth.signOut();
      setProfile(null);
<<<<<<< HEAD
=======
      syncedFor.current = null;
      // Leave any role-protected page so a stale URL can't become ?next=/admin
      // and bounce the next account into the wrong area.
      navigate('/', { replace: true });
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
    },

    refreshProfile: loadProfile,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
