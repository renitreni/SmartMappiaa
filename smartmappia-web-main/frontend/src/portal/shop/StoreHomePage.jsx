// ---------------------------------------------------------------------
// Ecommerce — discovery / home: /shop
// Search by store name, filter by category, browse listed stores.
// Public page (ordering itself requires sign-in).
// ---------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ShoppingBag, ReceiptText, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthProvider';
import { deliveryFeeFromLabel, deliveryFeeNote } from '../lib/constants';
import ListingRow, { ListingRowSkeleton } from '../components/ListingRow';
import { PortalShell, Card, btnPrimary, inputClass } from '../components/ui';

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

  // `?? data?.deliveryFee` keeps a cached bundle working against an API that
  // predates the terms object; both helpers accept either shape.
  const deliveryTerms = data?.delivery ?? data?.deliveryFee ?? null;
  const deliveryLabel = deliveryFeeFromLabel(deliveryTerms);
  const deliveryNote = deliveryFeeNote(deliveryTerms);

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

      {/* The delivery rule, not the minimum order: the minimum is something
          you meet in the cart, which states it with a live shortfall, and
          the radius was hardcoded here while the real one lives in config. */}
      {deliveryNote && <p className="text-xs text-brand-grey mb-4">{deliveryNote}</p>}

      {error && (
        <Card className="p-5 text-center">
          <p className="font-bold text-brand-black mb-1">Stores could not be loaded</p>
          {/* The server's own sentence, not ours. "The shop is not open yet"
              is what /api/shop returns when the vertical is switched off
              (SHOP_ENABLED) — which is a very different problem from an empty
              catalogue, and used to be indistinguishable from one. */}
          <p className="text-sm text-brand-grey mb-3">{error}</p>
          <button onClick={() => setQ((v) => v)} className={btnPrimary}>
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </Card>
      )}

      {loading && !error && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ListingRowSkeleton key={i} />
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
        <div className="grid gap-3 sm:grid-cols-2">
          {stores.map((s) => (
            <ListingRow
              key={s.id}
              merchant={s}
              deliveryLabel={deliveryLabel}
              fallbackIcon={ShoppingBag}
              to={`/shop/s/${s.id}`}
            />
          ))}
        </div>
      )}
    </PortalShell>
  );
}
