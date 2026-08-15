// ---------------------------------------------------------------------
// Admin portal: review payment proofs (verify/reject) and approve drivers.
// Access is gated by RequireAuth role="admin"; identity from the session.
// ---------------------------------------------------------------------
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdminLayout, { ADMIN_NAV } from './AdminLayout';
import Dashboard from './Dashboard';
import BookingsView from './BookingsView';
import DriversView from './DriversView';
import RestaurantOrders from './RestaurantOrders';
import FoodAdmin from './FoodAdmin';
import ShopAdmin from './ShopAdmin';
import ReportsView from './ReportsView';

export default function AdminPage() {
  // Notifications deep-link to a tab with ?tab= (see portal/lib/notifications.js).
  // Validated against ADMIN_NAV so a stale or hand-typed value renders the
  // overview instead of an empty workspace. Read once on mount only — after
  // that the tab is local state, so clicking around does not rewrite the URL.
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const wanted = params.get('tab');
    return ADMIN_NAV.some((n) => n.id === wanted) ? wanted : 'overview';
  });
  const [tick, setTick] = useState(0);

  return (
    <AdminLayout
      activeTab={tab}
      onTabChange={setTab}
      onRefresh={() => setTick((t) => t + 1)}
    >
      {tab === 'overview' && <Dashboard key={`o${tick}`} onNavigate={setTab} />}
      {tab === 'bookings' && <BookingsView key={`b${tick}`} />}
      {tab === 'drivers' && <DriversView key={`d${tick}`} />}
      {tab === 'restaurant' && <RestaurantOrders key={`ro${tick}`} />}
      {tab === 'food' && <FoodAdmin key={`f${tick}`} />}
      {tab === 'shop' && <ShopAdmin key={`s${tick}`} />}
      {tab === 'reports' && <ReportsView key={`r${tick}`} />}
    </AdminLayout>
  );
}
