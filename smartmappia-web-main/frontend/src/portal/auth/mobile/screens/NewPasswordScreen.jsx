// components/auth/screens/NewPasswordScreen.jsx
//
// NOT WIRED UP YET — the second half of the reset flow. See the blocker note
// in ForgotPasswordScreen.jsx before wiring either of them.
//
// When it is wired, `onSubmit` must call supabase.auth.updateUser({ password })
// while the RECOVERY session from the emailed link is active. Rendering this
// screen without that session lets someone submit a new password that silently
// applies to nobody (or, worse, to whoever happens to be signed in on the
// device). Gate the route on the recovery session, not on the URL alone.
//
// The rule below (8+, letters and digits) is STRICTER than the rest of the app:
// backend/lib/validate.js enforces 8 with no character-class requirement, and
// ProfilePage.jsx enforces only 6. Pick one before shipping this, or the same
// password will be accepted in one place and rejected in another.
import { useState } from 'react';
import AuthMobileLayout from '../AuthMobileLayout';
import AuthInput from '../AuthInput';
import AuthButton from '../AuthButton';
import { LockIcon, LockOpenIcon, InfoIcon, ArrowRightIcon } from '../icons';

export default function NewPasswordScreen({ onBack, onSubmit }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      setError('Password must be at least 8 characters long and include a mix of letters and numbers.');
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setError('');
    onSubmit(password);
  };

  return (
    <AuthMobileLayout onBack={onBack}>
      <h1 className="auth-title">New Password</h1>
      <p className="auth-subtitle">Create a strong password for your account</p>

      <form onSubmit={handleSubmit}>
        <AuthInput
          label="New Password"
          icon={<LockIcon />}
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={setPassword}
          showToggle
        />
        <AuthInput
          label="Confirm New Password"
          icon={<LockOpenIcon />}
          type="password"
          placeholder="••••••••"
          value={confirm}
          onChange={setConfirm}
        />

        {/* Static helper text from the mockup; swap to `error` styling if you want
            this box to also surface the validation message above instead of a
            separate error state — right now they're kept distinct. */}
        <div className="auth-info-box">
          <InfoIcon />
          <span>
            {error || 'Password must be at least 8 characters long and include a mix of letters and numbers.'}
          </span>
        </div>

        <AuthButton type="submit" icon={<ArrowRightIcon />}>
          Reset Password
        </AuthButton>

        <button type="button" className="auth-link-center auth-back-link" onClick={onBack}>
          Back to Login
        </button>
      </form>
    </AuthMobileLayout>
  );
}