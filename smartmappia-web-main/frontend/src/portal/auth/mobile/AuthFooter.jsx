export default function AuthFooter() {
  return (
    <div className="auth-footer">
      <div className="auth-footer__links">
        <a href="/privacy-policy">Privacy Policy</a>
        <a href="/terms-of-service">Terms of Service</a>
        <a href="/help-center">Help Center</a>
      </div>
      <div className="auth-footer__copyright">
        © {new Date().getFullYear()} AuthFlow Inc. All rights reserved.
      </div>
    </div>
  );
}
