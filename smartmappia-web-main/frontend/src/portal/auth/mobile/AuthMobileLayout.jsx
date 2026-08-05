import './auth.css';
import AuthHeader from './AuthHeader';
import AuthFooter from './AuthFooter';

/**
 * Shared shell for every auth screen: back arrow + logo header,
 * a white rounded card that holds the screen content, and the
 * footer links. Each screen only needs to supply its own inner content.
 *
 * Usage:
 *   <AuthMobileLayout onBack={() => navigate(-1)}>
 *     ...screen-specific fields/buttons...
 *   </AuthMobileLayout>
 */
export default function AuthMobileLayout({ onBack, children, showBack = true }) {
  return (
    <div className="auth-mobile-layout">
      <div className="auth-mobile-content">
        <AuthHeader onBack={onBack} showBack={showBack} />
        <div className="auth-card">{children}</div>
      </div>
      <AuthFooter />
    </div>
  );
}
