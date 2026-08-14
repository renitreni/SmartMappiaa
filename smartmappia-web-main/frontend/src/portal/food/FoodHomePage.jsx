// ---------------------------------------------------------------------
// Food Delivery — discovery / home: /food
// Search, cuisine filters, modern restaurant cards. Restaurants without
// a menu show a SweetAlert instead of opening an empty menu page.
// ---------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search,
  UtensilsCrossed,
  Bike,
  ReceiptText,
  RefreshCw,
  MapPin,
  Clock3,
  Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthProvider';
import { fmtSAR, FOOD_MIN_ORDER } from '../lib/constants';
import { notifyMenuUnavailable } from '../lib/notify';
import { PortalShell, Card, btnPrimary, inputClass } from '../components/ui';

const listVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 400, damping: 28 },
  },
};

function RestaurantCard({ restaurant, deliveryFee, onOpen }) {
  const comingSoon = restaurant.hasMenu === false;
  // Closed restaurants stay listed but are not openable — disabled on the
  // button itself, so keyboard and screen-reader users get the same answer
  // the dimming gives everyone else.
  const closed = restaurant.isOpen === false;

  return (
    <motion.button
      type="button"
      variants={cardVariants}
      disabled={closed}
      onClick={() => { if (!closed) onOpen(restaurant); }}
      whileHover={closed ? undefined : { y: -3 }}
      whileTap={closed ? undefined : { scale: 0.985 }}
      className={`group w-full text-left bg-white border border-brand-border rounded-3xl shadow-sm overflow-hidden transition-all ${
        closed
          ? 'opacity-60 cursor-not-allowed'
          : 'hover:border-brand-orange/35 hover:shadow-[0_14px_32px_-14px_rgba(255,126,33,0.4)] cursor-pointer'
      }`}
    >
      <div className="relative h-36 sm:h-40 bg-gradient-to-br from-brand-orange/15 to-brand-red/10 overflow-hidden">
        {restaurant.logo_url ? (
          <img
            src={restaurant.logo_url}
            alt=""
            className={`h-full w-full object-cover transition-transform duration-500 ${
              closed ? 'grayscale' : 'group-hover:scale-105'
            }`}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <UtensilsCrossed className="w-12 h-12 text-brand-orange/45" strokeWidth={1.6} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
        {closed && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45">
            <span className="px-3 py-1 rounded-full bg-white text-brand-dark text-xs font-black">
              Closed
            </span>
          </span>
        )}
        <span className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur px-2.5 py-1 text-[11px] font-black text-brand-orange shadow-sm">
          <Bike className="w-3.5 h-3.5" />
          {fmtSAR(deliveryFee)}
        </span>
        {comingSoon && (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-brand-black/85 text-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wider">
            <Sparkles className="w-3 h-3 text-brand-orange" />
            Menu soon
          </span>
        )}
        {restaurant.badge === 'new' && !comingSoon && (
          <span className="absolute bottom-3 left-3 rounded-full bg-green-500 text-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wider shadow-sm">
            New
          </span>
        )}
      </div>

      <div className="p-4 sm:p-5">
        <div className="min-w-0">
          <p className="font-black text-brand-black text-[15px] sm:text-base truncate tracking-tight">
            {restaurant.name}
          </p>
          {restaurant.cuisine_type && (
            <p className="text-xs text-brand-grey font-semibold mt-0.5">{restaurant.cuisine_type}</p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-brand-grey font-medium">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-surface px-2 py-1">
            <Clock3 className="w-3 h-3 text-brand-orange" />
            20–35 min
          </span>
          {restaurant.address && (
            <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
              <MapPin className="w-3 h-3 shrink-0 text-brand-orange" />
              <span className="truncate">{restaurant.address}</span>
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white border border-brand-border rounded-3xl overflow-hidden animate-pulse">
      <div className="h-36 sm:h-40 bg-brand-surface" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-brand-surface rounded w-2/3" />
        <div className="h-3 bg-brand-surface rounded w-1/3" />
        <div className="h-3 bg-brand-surface rounded w-1/2 mt-2" />
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
  useEffect(() => {
    load('', '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }
    const t = setTimeout(() => load(search, cuisine), 350);
    return () => clearTimeout(t);
  }, [search, cuisine]); // eslint-disable-line react-hooks/exhaustive-deps

  // Closed restaurants stay on the grid but sink below the ones that can
  // actually take an order, preserving the backend order within each group.
  const restaurants = useMemo(
    () =>
      [...(data?.restaurants || [])].sort(
        (a, b) => (a.isOpen === false ? 1 : 0) - (b.isOpen === false ? 1 : 0)
      ),
    [data]
  );

  function openRestaurant(restaurant) {
    if (restaurant.hasMenu === false) {
      notifyMenuUnavailable(restaurant.name);
      return;
    }
    navigate(`/food/r/${restaurant.id}`);
  }

  return (
    <PortalShell
      wide
      title="Food Delivery"
      subtitle={`Minimum order ${fmtSAR(FOOD_MIN_ORDER)}`}
      onBack={() => navigate('/')}
      right={
        session && (
          <Link
            to="/food/orders"
            title="My orders"
            className="p-2 rounded-lg hover:bg-brand-surface text-brand-grey"
          >
            <ReceiptText className="w-4 h-4" />
          </Link>
        )
      }
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-3xl border border-brand-border bg-white p-4 sm:p-5 shadow-sm overflow-hidden relative"
      >
        <div className="absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-brand-orange/8 to-transparent pointer-events-none" />
        <p className="text-[11px] font-black uppercase tracking-widest text-brand-orange mb-1">
          Order nearby
        </p>
        <h2 className="font-black text-brand-black text-xl sm:text-2xl tracking-tight">
          Restaurants near you
        </h2>
        <p className="text-sm text-brand-grey mt-1 max-w-xl">
          Browse partner kitchens, pick your favorites, and track delivery live.
        </p>
        <div className="relative mt-4">
          <Search className="w-4 h-4 text-brand-grey absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search restaurants by name"
            className={inputClass + ' !pl-10 !rounded-2xl !py-3'}
          />
        </div>
        {(data?.cuisines || []).length > 0 && (
          <div className="flex gap-2 overflow-x-auto pt-3 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setCuisine('')}
              className={`shrink-0 px-4 py-2 rounded-full text-xs font-black border whitespace-nowrap cursor-pointer transition-colors ${
                !cuisine
                  ? 'bg-brand-black text-white border-brand-black'
                  : 'bg-white text-brand-grey border-brand-border hover:border-brand-orange/40'
              }`}
            >
              All cuisines
            </button>
            {data.cuisines.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCuisine(c === cuisine ? '' : c)}
                className={`shrink-0 px-4 py-2 rounded-full text-xs font-black border whitespace-nowrap cursor-pointer transition-colors ${
                  cuisine === c
                    ? 'bg-brand-black text-white border-brand-black'
                    : 'bg-white text-brand-grey border-brand-border hover:border-brand-orange/40'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </motion.div>

      {error && (
        <Card className="p-6 text-center rounded-3xl">
          <p className="text-brand-dark font-bold mb-1">Could not load restaurants</p>
          <p className="text-sm text-brand-grey mb-4">{error}</p>
          <button type="button" onClick={() => load()} className={btnPrimary}>
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </Card>
      )}

      {loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!loading && !error && restaurants.length === 0 && (
        <Card className="p-10 text-center rounded-3xl">
          <UtensilsCrossed className="w-10 h-10 text-brand-grey/40 mx-auto mb-3" />
          <p className="font-bold text-brand-dark">No restaurants found</p>
          <p className="text-sm text-brand-grey mt-1">
            {search || cuisine
              ? 'Try a different name or cuisine.'
              : 'Restaurants are coming soon to your area.'}
          </p>
        </Card>
      )}

      {!loading && !error && restaurants.length > 0 && (
        <motion.div
          variants={listVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          {restaurants.map((r) => (
            <RestaurantCard
              key={r.id}
              restaurant={r}
              deliveryFee={data.deliveryFee}
              onOpen={openRestaurant}
            />
          ))}
        </motion.div>
      )}
    </PortalShell>
  );
}
