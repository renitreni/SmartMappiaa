// ---------------------------------------------------------------------
// /merchant — picks the right dashboard for this owner's vertical.
//
// merchants.owner_id is UNIQUE (migration 0009), so an owner maps to
// exactly one merchant and the choice is never ambiguous. The vertical
// comes from the SERVER (GET /api/merchant/profile) rather than from
// anything the client could influence.
//
// Both dashboards are heavy, so each is lazy-loaded: a restaurant owner
// never downloads the store bundle and vice versa.
// ---------------------------------------------------------------------
import { Suspense, lazy, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PortalShell, Card, Spinner, btnPrimary } from '../components/ui';

const MerchantDashboard = lazy(() => import('./MerchantDashboard'));
const ShopMerchantDashboard = lazy(() => import('./ShopMerchantDashboard'));

function FullScreenSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#eef1f6]">
      <Spinner className="!w-8 !h-8" />
    </div>
  );
}

export default function MerchantPortal() {
  const [vertical, setVertical] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .merchantProfile()
      .then((d) => {
        if (cancelled) return;
        // Default to food: every merchant that pre-dates migration 0026 is a
        // restaurant, and the column defaults to 'food' for exactly that reason.
        setVertical(d?.merchant?.vertical || 'food');
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <PortalShell title="Business portal">
        <Card className="p-8 text-center">
          <p className="font-bold text-brand-black">{error}</p>
          <p className="text-sm text-brand-grey mt-1">
            If you have just been given access, sign out and back in.
          </p>
          <button onClick={() => window.location.reload()} className={btnPrimary + ' mt-4'}>
            Try again
          </button>
        </Card>
      </PortalShell>
    );
  }

  if (!vertical) return <FullScreenSpinner />;

  return (
    <Suspense fallback={<FullScreenSpinner />}>
      {vertical === 'shop' ? <ShopMerchantDashboard /> : <MerchantDashboard />}
    </Suspense>
  );
}
