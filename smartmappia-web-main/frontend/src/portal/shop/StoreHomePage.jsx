// ---------------------------------------------------------------------
// Ecommerce — discovery / home: /shop
// Search by store name, filter by category, browse listed stores.
// Public page (ordering itself requires sign-in).
// ---------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ShoppingBag, Bike, ReceiptText, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthProvider';
import { fmtSAR, SHOP_MIN_ORDER } from '../lib/constants';
import { PortalShell, Card, Badge, btnPrimary, inputClass } from '../components/ui';

function StoreCard({ store, deliveryFee }) {
  // A closed store stays on the grid — it is listed and will trade again —
  // but nothing about it is actionable. Rendered as a div rather than a Link
  // so there is no navigable target at all, not merely a suppressed click.
  const closed = store.isOpen === false;
  const Wrapper = closed ? 'div' : Link;
  const wrapperProps = closed
    ? { 'aria-disabled': true }
    : { to: `/shop/s/${store.id}` };

  return (
    <Wrapper
      {...wrapperProps}
      className={`block bg-white border border-brand-border rounded-2xl shadow-sm overflow-hidden transition-all ${
        closed ? 'opacity-60 cursor-not-allowed' : 'hover:border-brand-orange/40 hover:shadow-md'
      }`}
    >
      <div className="h-28 bg-gradient-to-br from-brand-orange/15 to-brand-red/10 flex items-center justify-center relative">
        {store.logo_url ? (
          <img
            src={store.logo_url}
            alt={store.name}
            className={`h-full w-full object-cover ${closed ? 'grayscale' : ''}`}
          />
        ) : (
          <ShoppingBag className="w-8 h-8 text-brand-orange/50" />
        )}
        {closed && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45">
            <span className="px-3 py-1 rounded-full bg-white text-brand-dark text-xs font-black">
              Closed
            </span>
          </span>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="font-black text-brand-black leading-tight">{store.name}</p>
          {store.badge && <Badge tone="amber">{store.badge.replace(/_/g, ' ')}</Badge>}
        </div>
        {store.cuisine_type && <p className="text-sm text-brand-grey mt-0.5">{store.cuisine_type}</p>}
        <div className="flex items-center gap-3 mt-3 text-xs text-brand-grey">
          <span className="inline-flex items-center gap-1">
            <Bike className="w-3.5 h-3.5" /> {fmtSAR(deliveryFee)}
          </span>
          {store.rating != null && (
            <span className="font-bold text-brand-dark">
              {store.rating.toFixed(1)} ({store.reviewCount})
            </span>
          )}
        </div>
        {store.address && (
          <p className="text-xs text-brand-grey mt-2 line-clamp-1">{store.address}</p>
        )}
      </div>
    </Wrapper>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white border border-brand-border rounded-2xl overflow-hidden animate-pulse">
      <div className="h-28 bg-brand-surface" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-brand-surface rounded w-2/3" />
        <div className="h-3 bg-brand-surface rounded w-1/3" />
        <div className="h-3 bg-brand-surface rounded w-1/2" />
      </div>
    </div>
  );
}

export default function StoreHomePage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const debounce = useRef(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (category) p.set('category', category);
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [q, category]);

  useEffect(() => {
    setLoading(true);
    clearTimeout(debounce.current);
    // 350 ms matches the food discovery page — long enough to stop a request
    // per keystroke, short enough that the list still feels live.
    debounce.current = setTimeout(() => {
      api
        .shopStores(query)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(debounce.current);
  }, [query]);

  // Closed stores stay on the grid but sink below the ones that can actually
  // take an order. The backend's featured/name ordering is preserved within
  // each group.
  const stores = [...(data?.stores || [])].sort(
    (a, b) => (a.isOpen === false ? 1 : 0) - (b.isOpen === false ? 1 : 0)
  );

  return (
    <PortalShell
      title="Shop"
      subtitle="Groceries, household and everyday essentials, delivered."
      right={
        session && (
          <button onClick={() => navigate('/shop/orders')} className="text-sm font-bold text-brand-orange">
            <ReceiptText className="w-4 h-4 inline mr-1 -mt-0.5" /> My orders
          </button>
        )
      }
      wide
    >
      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-grey" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search stores"
          className={inputClass + ' pl-10'}
        />
      </div>

      {(data?.categories || []).length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-3 mb-2 -mx-1 px-1">
          <button
            onClick={() => setCategory('')}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-bold border transition-colors ${
              category === ''
                ? 'bg-brand-orange text-white border-brand-orange'
                : 'bg-white text-brand-grey border-brand-border'
            }`}
          >
            All
          </button>
          {data.categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c === category ? '' : c)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-bold border transition-colors ${
                category === c
                  ? 'bg-brand-orange text-white border-brand-orange'
                  : 'bg-white text-brand-grey border-brand-border'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-brand-grey mb-4">
        Minimum order {fmtSAR(data?.minOrder ?? SHOP_MIN_ORDER)} · delivery{' '}
        {fmtSAR(data?.deliveryFee ?? 0)} within 15 km
      </p>

      {error && (
        <Card className="p-5 text-center">
          <p className="text-sm text-red-700 font-medium mb-3">{error}</p>
          <button onClick={() => setQ((v) => v)} className={btnPrimary}>
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </Card>
      )}

      {loading && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!loading && !error && stores.length === 0 && (
        <Card className="p-8 text-center">
          <ShoppingBag className="w-8 h-8 text-brand-grey/40 mx-auto mb-3" />
          <p className="font-bold text-brand-black">No stores found</p>
          <p className="text-sm text-brand-grey mt-1">
            {q || category ? 'Try a different search or category.' : 'Stores are being onboarded — check back soon.'}
          </p>
        </Card>
      )}

      {!loading && !error && stores.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((s) => (
            <StoreCard key={s.id} store={s} deliveryFee={data.deliveryFee} />
          ))}
        </div>
      )}
    </PortalShell>
  );
}
