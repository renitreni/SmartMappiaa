// components/auth/screens/ForgotPasswordScreen.jsx
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