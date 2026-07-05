// ---------------------------------------------------------------------
// Food Delivery — discovery / home: /food
// Search by restaurant name, filter by cuisine, browse active restaurants.
// Public page (ordering itself requires sign-in).
// ---------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, UtensilsCrossed, Bike, ReceiptText, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthProvider';
import { fmtSAR, FOOD_MIN_ORDER } from '../lib/constants';
import { PortalShell, Card, Badge, btnPrimary, inputClass } from '../components/ui';

function RestaurantCard({ restaurant, deliveryFee }) {
  return (
    <Link
      to={`/food/r/${restaurant.id}`}
      className="block bg-white border border-brand-border rounded-2xl shadow-sm overflow-hidden hover:border-brand-orange/40 hover:shadow-md transition-all"
    >
      <div className="h-28 bg-gradient-to-br from-brand-orange/15 to-brand-red/10 flex items-center justify-center">
        {restaurant.logo_url ? (
          <img src={restaurant.logo_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <UtensilsCrossed className="w-10 h-10 text-brand-orange/50" />
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-black text-brand-black truncate">{restaurant.name}</p>
            {restaurant.cuisine_type && (
              <p className="text-xs text-brand-grey font-medium mt-0.5">{restaurant.cuisine_type}</p>
            )}
          </div>
          <Badge tone="amber" className="shrink-0">
            <Bike className="w-3.5 h-3.5" /> {fmtSAR(deliveryFee)}
          </Badge>
        </div>
        {restaurant.address && (
          <p className="text-xs text-brand-grey mt-2 truncate">{restaurant.address}</p>
        )}
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white border border-brand-border rounded-2xl overflow-hidden animate-pulse">
      <div className="h-28 bg-brand-surface" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-brand-surface rounded w-2/3" />
        <div className="h-3 bg-brand-surface rounded w-1/3" />
      </div>
    </div>
  );
}

export default function FoodHomePage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cuisine, setCuisine] = useState('');

  async function load(q = search, c = cuisine) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (c) params.set('cuisine', c);
      const query = params.toString() ? `?${params.toString()}` : '';
      setData(await api.foodRestaurants(query));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const firstRender = useRef(true);
  useEffect(() => { load('', ''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce typing so we don't hammer the search endpoint (the mount
  // fetch above already covers the initial state).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }
    const t = setTimeout(() => load(search, cuisine), 350);
    return () => clearTimeout(t);
  }, [search, cuisine]); // eslint-disable-line react-hooks/exhaustive-deps

  const restaurants = useMemo(() => data?.restaurants || [], [data]);

  return (
    <PortalShell
      title="Food Delivery"
      subtitle={`Minimum order ${fmtSAR(FOOD_MIN_ORDER)}`}
      onBack={() => navigate('/')}
      right={
        session && (
          <Link to="/food/orders" title="My orders" className="p-2 rounded-lg hover:bg-brand-surface text-brand-grey">
            <ReceiptText className="w-4 h-4" />
          </Link>
        )
      }
    >
      {/* Search + cuisine chips */}
      <div className="mb-5 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-brand-grey absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search restaurants by name"
            className={inputClass + ' !pl-10'}
          />
        </div>
        {(data?.cuisines || []).length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setCuisine('')}
              className={`px-4 py-1.5 rounded-full text-xs font-bold border whitespace-nowrap cursor-pointer transition-colors ${
                !cuisine ? 'bg-brand-black text-white border-brand-black' : 'bg-white text-brand-grey border-brand-border'
              }`}
            >
              All cuisines
            </button>
            {data.cuisines.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCuisine(c === cuisine ? '' : c)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold border whitespace-nowrap cursor-pointer transition-colors ${
                  cuisine === c ? 'bg-brand-black text-white border-brand-black' : 'bg-white text-brand-grey border-brand-border'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error state */}
      {error && (
        <Card className="p-6 text-center">
          <p className="text-brand-dark font-bold mb-1">Could not load restaurants</p>
          <p className="text-sm text-brand-grey mb-4">{error}</p>
          <button type="button" onClick={() => load()} className={btnPrimary}>
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </Card>
      )}

      {/* Loading skeletons */}
      {loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && restaurants.length === 0 && (
        <Card className="p-10 text-center">
          <UtensilsCrossed className="w-10 h-10 text-brand-grey/40 mx-auto mb-3" />
          <p className="font-bold text-brand-dark">No restaurants found</p>
          <p className="text-sm text-brand-grey mt-1">
            {search || cuisine
              ? 'Try a different name or cuisine.'
              : 'Restaurants are coming soon to your area.'}
          </p>
        </Card>
      )}

      {/* Restaurant grid */}
      {!loading && !error && restaurants.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {restaurants.map((r) => (
            <RestaurantCard key={r.id} restaurant={r} deliveryFee={data.deliveryFee} />
          ))}
        </div>
      )}
    </PortalShell>
  );
}
