// components/auth/screens/ForgotPasswordScreen.jsx
//
// NOT WIRED UP YET — and do not wire it up before reading this.
//
// This is a presentational shell: it collects an email and hands it to
// `onSubmit`. Nothing imports it, and there is no resetPasswordForEmail call
// anywhere in the app.
//
// BLOCKER: THE PLATFORM SENDS NO EMAIL AT ALL. Every account is created with
// `email_confirm: true` specifically to skip the mailer, and no custom SMTP is
// configured. Supabase's built-in mailer only delivers to project TEAM member
// addresses and is rate-limited to a couple per hour, so calling
// supabase.auth.resetPasswordForEmail() today would show the customer
// "check your email" and then deliver nothing, with no error to trace.
//
// To finish this you need, in order:
//   1. Custom SMTP configured in the Supabase dashboard (Auth -> SMTP).
//   2. The reset redirect URL allow-listed (Auth -> URL Configuration).
//   3. A /reset-password route in main.jsx that renders NewPasswordScreen
//      against the recovery session Supabase puts in the URL fragment.
//
// Merchant and admin accounts do NOT need this: their passwords are set by an
// admin in the Admin tab (POST /api/admin/food/merchants/:id/owner/password
// and its shop twin). This flow is for self-registered customers only.
// See docs/engineering/13-authentication-and-security.md §13.3.4.
import { useState } from 'react';
import AuthMobileLayout from '../AuthMobileLayout';
import AuthInput from '../AuthInput';
import AuthButton from '../AuthButton';
import { MailIcon, ArrowRightIcon } from '../icons';

export default function ForgotPasswordScreen({ onBack, onSubmit }) {
  const [email, setEmail] = useState('');

  return (
    <AuthMobileLayout onBack={onBack}>
      <h1 className="auth-title">Forgot Password?</h1>
      <p className="auth-subtitle">Enter your email to receive a reset code</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(email);
        }}
      >
        <AuthInput
          label="EMAIL ADDRESS"
          icon={<MailIcon />}
          type="email"
          placeholder="name@company.com"
          value={email}
          onChange={setEmail}
        />

        <AuthButton type="submit" icon={<ArrowRightIcon />}>
          Send Code
        </AuthButton>

        <button type="button" className="auth-link-center auth-back-link" onClick={onBack}>
          ← Back to Login
        </button>
      </form>
    </AuthMobileLayout>
  );
}