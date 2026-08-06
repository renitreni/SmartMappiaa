// ---------------------------------------------------------------------
// Choose a new password from a reset link: /reset-password
//
// THE GATE IS THE POINT OF THIS FILE.
//
// supabaseClient leaves `detectSessionInUrl` at its default of true, so the
// SDK consumes a recovery link and establishes a session on whatever page it
// lands on. If this screen simply rendered a password form, then:
//
//   * someone already signed in on the device who happens to open
//     /reset-password directly would change THEIR OWN password believing
//     they were completing a reset for the link they were sent, and
//   * a stale or already-used link would show a working-looking form whose
//     submit silently applies to whoever the current session belongs to.
//
// So the form only renders once we have positively seen a PASSWORD_RECOVERY
// event (or, on a reload, a recovery session we recorded from one). An
// ordinary signed-in session is NOT sufficient and is refused.
//
// PKCE (see supabaseClient.js) adds one honest failure mode: the verifier
// lives in the localStorage of the browser that REQUESTED the reset, so
// opening the mail elsewhere cannot complete. That surfaces below as an
// expired link with a route back to request a fresh one, not a dead end.
// ---------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabaseClient';
import { getPasswordValidationError } from '../lib/passwordValidation';
import { btnPrimary, Spinner, Field } from '../components/ui';
import PasswordInput from '../components/PasswordInput';
import MobileNewPasswordScreen from './mobile/screens/NewPasswordScreen';

// Marks "this tab is mid-recovery", so a reload between arriving and
// submitting does not drop the user back to the invalid-link state. Cleared
// on success and on leaving. sessionStorage, not localStorage: it must not
// outlive the tab, or a later visit to /reset-password would inherit it.
const RECOVERY_FLAG = 'sm_password_recovery';

// How long to wait for the SDK to exchange the code before calling the link
// bad. Generous — a slow phone on hotel wifi is not an invalid link.
const EXCHANGE_TIMEOUT_MS = 12000;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  // 'verifying' -> 'ready' -> 'done', or 'invalid' at any point before 'done'.
  //
  // Both synchronously-knowable outcomes are resolved in the lazy initialiser
  // rather than in the effect: an unconfigured client, and a reload while the
  // form was already open. That leaves the effect handling only genuinely
  // asynchronous paths.
  const [phase, setPhase] = useState(() => {
    if (!supabase) return 'invalid';
    if (sessionStorage.getItem(RECOVERY_FLAG) === '1') return 'ready';
    return 'verifying';
  });
  const [error, setError] = useState(() =>
    supabase ? null : 'Sign-in is not configured. Please contact Smart Mappia support.'
  );
  const [busy, setBusy] = useState(false);
  const settled = useRef(phase !== 'verifying');

  const markReady = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    sessionStorage.setItem(RECOVERY_FLAG, '1');
    setPhase('ready');
  }, []);

  useEffect(() => {
    // Both already handled in the lazy initialiser above.
    if (!supabase || settled.current) return undefined;

    // The event we actually want. detectSessionInUrl may fire this before this
    // component mounts, which is what the getSession() race-check below covers.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') markReady();
    });

    // Race check: if the SDK already consumed the link, the event is gone but
    // the URL still tells us why we are here. Accept a session ONLY when the
    // URL carries recovery markers — never a bare pre-existing session, which
    // is exactly the case this gate exists to refuse.
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const cameFromRecoveryLink =
      url.searchParams.has('code') ||          // PKCE
      hash.get('type') === 'recovery' ||       // implicit, legacy links
      url.searchParams.get('type') === 'recovery';

    if (cameFromRecoveryLink) {
      supabase.auth.getSession().then(({ data }) => {
        if (data?.session) markReady();
      });
    }

    const timer = setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      setPhase('invalid');
    }, cameFromRecoveryLink ? EXCHANGE_TIMEOUT_MS : 0);

    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, [markReady]);

  async function submit(password) {
    const validationError = getPasswordValidationError(password);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      sessionStorage.removeItem(RECOVERY_FLAG);
      settled.current = true;
      setPhase('done');
    } catch (err) {
      setError(err.message || 'Could not update your password. Request a new link and try again.');
      setBusy(false);
      return;
    }

    // Sign out so the new password is actually used to get back in. The
    // recovery session is still live otherwise, and letting it through would
    // mean the user never proves they know what they just set.
    //
    // Deliberately outside the try above: the password IS already changed by
    // this point, and a failed sign-out is not something to alarm the user
    // about — surfacing it would contradict the success screen they can see.
    try {
      await supabase.auth.signOut();
    } catch {
      /* best effort */
    }
    setBusy(false);
  }

  // --- native -----------------------------------------------------------
  if (Capacitor.isNativePlatform()) {
    if (phase === 'ready') {
      return (
        <MobileNewPasswordScreen
          onBack={() => navigate('/login')}
          onSubmit={submit}
          serverError={error}
          busy={busy}
        />
      );
    }
    return (
      <div className="auth-mobile-layout">
        <div className="auth-mobile-content">
          <div className="auth-card">
            <Outcome phase={phase} error={error} onLogin={() => navigate('/login')} />
          </div>
        </div>
      </div>
    );
  }

  // --- web --------------------------------------------------------------
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-light px-4 py-10">
      <div className="w-full max-w-md">
        <Link
          to="/login"
          className="inline-flex items-center gap-2 text-sm font-bold text-brand-grey hover:text-brand-orange transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </Link>

        <div className="bg-white border border-brand-border rounded-2xl p-7 shadow-sm">
          {phase === 'ready' ? (
            <WebForm onSubmit={submit} busy={busy} error={error} />
          ) : (
            <Outcome phase={phase} error={error} onLogin={() => navigate('/login')} />
          )}
        </div>
      </div>
    </div>
  );
}

function WebForm({ onSubmit, busy, error }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState(null);

  return (
    <>
      <h1 className="text-2xl font-black text-brand-black tracking-tight">Choose a new password</h1>
      <p className="text-sm text-brand-grey mt-2 mb-6">
        You will use this to sign in from now on.
      </p>

      {(localError || error) && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
          {localError || error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (password !== confirm) {
            setLocalError('Passwords do not match.');
            return;
          }
          setLocalError(null);
          onSubmit(password);
        }}
      >
        <Field label="New password">
          <PasswordInput
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
        </Field>
        <Field label="Confirm new password">
          <PasswordInput
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            placeholder="Re-enter it"
          />
        </Field>
        <button type="submit" disabled={busy} className={btnPrimary + ' w-full mt-2'}>
          {busy ? <Spinner className="!w-4 !h-4" /> : 'Update password'}
        </button>
      </form>
    </>
  );
}

// Everything that is not the form: verifying, invalid link, and success.
function Outcome({ phase, error, onLogin }) {
  if (phase === 'verifying') {
    return (
      <div className="py-6 text-center">
        <Spinner className="!w-7 !h-7 mx-auto" />
        <p className="text-sm text-brand-grey mt-4">Checking your reset link…</p>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="text-center">
        <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-black text-brand-black tracking-tight">Password updated</h1>
        <p className="text-sm text-brand-grey mt-2 mb-6">
          Sign in with your new password.
        </p>
        <button type="button" onClick={onLogin} className={btnPrimary + ' w-full'}>
          Go to sign in
        </button>
      </div>
    );
  }

  // invalid
  return (
    <div className="text-center">
      <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <h1 className="text-2xl font-black text-brand-black tracking-tight">This link cannot be used</h1>
      <p className="text-sm text-brand-grey mt-2">
        {error || 'It may have expired, been used already, or been opened in a different browser from the one that requested it.'}
      </p>
      <p className="text-xs text-brand-grey mt-3 mb-6">
        Reset links last one hour and must be opened in the browser that requested them.
      </p>
      <Link to="/forgot-password" className={btnPrimary + ' w-full'}>
        Request a new link
      </Link>
      <button
        type="button"
        onClick={onLogin}
        className="w-full mt-3 text-sm font-bold text-brand-grey hover:text-brand-orange transition-colors cursor-pointer"
      >
        Back to sign in
      </button>
    </div>
  );
}
