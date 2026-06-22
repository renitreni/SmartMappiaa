// ---------------------------------------------------------------------
// Route guard. Redirects to /login when signed out; shows a friendly
// "wrong account type" screen when the role doesn't match.
// ---------------------------------------------------------------------
import { Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthProvider';
<<<<<<< HEAD
=======
import { useViewMode } from '../lib/ViewModeProvider';
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
import { roleHome } from '../lib/constants';
import { PortalShell, Card, Spinner, btnPrimary } from './ui';

function FullScreenSpinner() {
  return (
    <PortalShell title="Loading">
      <div className="flex justify-center py-24"><Spinner className="!w-8 !h-8" /></div>
    </PortalShell>
  );
}

function ProfileSyncError({ message, onRetry }) {
  return (
    <PortalShell title="Account setup">
      <div className="max-w-md mx-auto">
        <Card className="p-6 text-center">
          <p className="text-brand-dark font-bold mb-1">Could not load your account</p>
          <p className="text-sm text-brand-grey mb-4">{message}</p>
          <button type="button" onClick={onRetry} className={btnPrimary}>
            Try again
          </button>
        </Card>
      </div>
    </PortalShell>
  );
}

export default function RequireAuth({ role, redirectWrongRole = false, children }) {
  const { loading, session, role: userRole, profileLoading, profileError, refreshProfile } = useAuth();
<<<<<<< HEAD
=======
  const { previewRole } = useViewMode();
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
  const location = useLocation();

  if (loading) return <FullScreenSpinner />;

  if (!session) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  // Role-specific routes need the synced profile.
  if (role) {
    if (profileLoading) return <FullScreenSpinner />;

    if (profileError || !userRole) {
      return (
        <ProfileSyncError
          message={profileError || 'Your profile is still syncing. Please try again.'}
          onRetry={() => refreshProfile()}
        />
      );
    }

<<<<<<< HEAD
    if (userRole !== role) {
=======
    // An admin previewing as user/driver may enter that portal while keeping
    // their real admin role/JWT (see ViewModeProvider).
    const previewAllowed = userRole === 'admin' && previewRole === role;

    if (userRole !== role && !previewAllowed) {
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
      if (redirectWrongRole) {
        return <Navigate to={roleHome(userRole)} replace />;
      }
      return (
        <PortalShell title="Wrong account type">
          <div className="max-w-md mx-auto">
            <Card className="p-6 text-center">
              <p className="text-brand-dark font-bold mb-1">This area is for {role}s.</p>
              <p className="text-sm text-brand-grey mb-4">You are signed in as a {userRole}.</p>
              <Link to={roleHome(userRole)} className={btnPrimary}>Go to your dashboard</Link>
            </Card>
          </div>
        </PortalShell>
      );
    }
  }

  return children;
}
