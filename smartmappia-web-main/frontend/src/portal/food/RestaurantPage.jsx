// ---------------------------------------------------------------------
// Food Delivery — restaurant menu: /food/r/:id
// Professional order-picking UI: inline Medium/Large selection, live
// price, staggered motion, sticky categories, and a polished cart bar.
// ---------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  UtensilsCrossed,
  Plus,
  ShoppingCart,
  RefreshCw,
  MapPin,
  CupSoda,
  Check,
  Bike,
  ChevronRight,
  Clock3,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthProvider';
import { fmtSAR } from '../lib/constants';
import { notifyMenuUnavailable } from '../lib/notify';
import { reopensLabel, todayHoursLabel } from '../lib/storeHours';
import { PortalShell, Card, Spinner, btnPrimary } from '../components/ui';
import OpeningHoursCard from '../components/OpeningHours';

export function enabledSizes(item) {
  return (item?.size_options || []).filter((s) => s && s.enabled !== false);
}

function CategoryScroller({ categories, activeCat, onSelect }) {
  const scrollerRef = useRef(null);

  // Keep the active pill fully visible when it changes.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const active = el.querySelector(`[data-cat-id="${String(activeCat).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`);
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeCat]);

  return (
    <div className="sticky top-16 z-20 -mx-4 md:-mx-6 mb-4 py-2.5 bg-brand-muted/95 backdrop-blur-md border-b border-brand-border/60">
      <div className="px-4 md:px-6">
        <div
          ref={scrollerRef}
          className="flex gap-2 overflow-x-auto overscroll-x-contain touch-pan-x pb-1 scroll-smooth [scrollbar-width:thin] [scrollbar-color:rgba(255,126,33,0.55)_transparent] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-brand-orange/50 [&::-webkit-scrollbar-track]:bg-transparent"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {categories.map((cat) => {
            const active = activeCat === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                data-cat-id={cat.id}
                onClick={() => onSelect(cat.id)}
                className={`relative shrink-0 px-4 py-2 rounded-full text-xs font-black whitespace-nowrap cursor-pointer transition-colors ${
                  active
                    ? 'text-white'
                    : 'text-brand-grey bg-white border border-brand-border hover:border-brand-orange/40 hover:text-brand-dark'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="menu-cat-pill"
                    className="absolute inset-0 rounded-full bg-brand-black shadow-sm"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{cat.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const listVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.03 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 420, damping: 30 },
  },
};

function SizeSegment({ sizes, value, onChange, disabled }) {
  return (
    <div
      role="radiogroup"
      aria-label="Drink size"
      className="inline-flex w-full sm:w-auto rounded-xl bg-brand-surface p-1 gap-0.5"
    >
      {sizes.map((s) => {
        const active = value === s.id;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onChange(s.id);
            }}
            className={`relative flex-1 sm:flex-none min-w-[4.75rem] px-3 py-1.5 rounded-[0.65rem] text-[11px] font-black tracking-wide cursor-pointer transition-all duration-200 disabled:cursor-not-allowed ${
              active
                ? 'bg-white text-brand-black shadow-sm ring-1 ring-black/5'
                : 'text-brand-grey hover:text-brand-dark'
            }`}
          >
            <span className="inline-flex items-center justify-center gap-1">
              <CupSoda
                className={`w-3 h-3 ${active ? 'text-brand-orange' : ''} ${s.id === 'large' ? 'scale-110' : 'scale-90'}`}
                strokeWidth={2.4}
              />
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ItemCard({ item, onAdd, busy, closed = false }) {
  // Closed is a restaurant-level state, unavailable a per-item one — both
  // disable the button, and the backend rejects either way regardless.
  const unavailable = !item.is_available || closed;
  const sizes = enabledSizes(item);
  const hasSizes = sizes.length > 0;
  const isDrink = hasSizes || item.item_type === 'drink_dessert_addon';
  const [sizeId, setSizeId] = useState(sizes[0]?.id || null);
  const selected = sizes.find((s) => s.id === sizeId) || null;
  const displayPrice = hasSizes
    ? Number(selected?.price ?? sizes[0]?.price)
    : Number(item.price);

  useEffect(() => {
    if (!hasSizes) return;
    if (!sizes.some((s) => s.id === sizeId)) setSizeId(sizes[0].id);
  }, [hasSizes, sizes, sizeId]);

  function handleAdd() {
    if (hasSizes) onAdd(item, sizeId);
    else onAdd(item);
  }

  return (
    <motion.article
      variants={cardVariants}
      layout
      className={`group relative flex gap-3.5 sm:gap-4 rounded-2xl border bg-white p-3 sm:p-3.5 transition-all duration-300 ${
        unavailable
          ? 'opacity-50 border-brand-border'
          : 'border-brand-border hover:border-brand-orange/30 hover:shadow-[0_10px_30px_-12px_rgba(255,126,33,0.35)]'
      }`}
    >
      <div className="relative w-[5.25rem] h-[5.25rem] sm:w-28 sm:h-28 rounded-2xl overflow-hidden shrink-0 bg-brand-warm">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt=""
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-brand-orange/15 to-brand-red/10">
            {isDrink ? (
              <CupSoda className="w-9 h-9 text-brand-orange/50" strokeWidth={1.6} />
            ) : (
              <UtensilsCrossed className="w-9 h-9 text-brand-orange/50" strokeWidth={1.6} />
            )}
          </div>
        )}
        {unavailable && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <span className="text-[10px] font-black uppercase tracking-wider text-brand-grey bg-white px-2 py-1 rounded-full shadow-sm">
              Sold out
            </span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-black text-brand-black text-[13px] sm:text-[15px] leading-snug tracking-tight line-clamp-2">
              {item.name}
            </h3>
            {item.description && (
              <p className="text-[11px] sm:text-xs text-brand-grey mt-1 line-clamp-2 leading-relaxed">
                {item.description}
              </p>
            )}
          </div>
        </div>

        {hasSizes && (
          <div className="mt-2.5">
            <SizeSegment
              sizes={sizes}
              value={sizeId}
              onChange={setSizeId}
              disabled={unavailable || busy}
            />
          </div>
        )}

        <div className="mt-auto pt-3 flex items-center justify-between gap-3">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={`${item.id}-${sizeId || 'base'}-${displayPrice}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="font-black text-brand-orange text-[15px] sm:text-lg tabular-nums tracking-tight"
            >
              {fmtSAR(displayPrice)}
            </motion.p>
          </AnimatePresence>

          <motion.button
            type="button"
            disabled={unavailable || busy || (hasSizes && !sizeId)}
            onClick={handleAdd}
            whileHover={unavailable || busy ? undefined : { scale: 1.03 }}
            whileTap={unavailable || busy ? undefined : { scale: 0.94 }}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-orange px-4 py-2.5 text-xs font-black text-white shadow-md shadow-brand-orange/25 cursor-pointer transition-colors hover:bg-[#ff6a00] disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {busy ? (
              <Spinner className="!w-3.5 !h-3.5 !border-white/40 !border-t-white" />
            ) : (
              <Plus className="w-3.5 h-3.5" strokeWidth={3} />
            )}
            Add
          </motion.button>
        </div>
      </div>
    </motion.article>
  );
}

function AddedToast({ itemName, sizeLabel, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1600);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96 }}
      className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 max-w-[min(92vw,22rem)]"
    >
      <div className="flex items-center gap-2.5 rounded-2xl bg-brand-black text-white px-4 py-3 shadow-2xl">
        <span className="w-7 h-7 rounded-full bg-brand-orange flex items-center justify-center shrink-0">
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
        </span>
        <p className="text-sm font-bold leading-snug min-w-0">
          Added <span className="text-brand-orange">{itemName}</span>
          {sizeLabel ? ` · ${sizeLabel}` : ''}
        </p>
      </div>
    </motion.div>
  );
}

export default function RestaurantPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [cart, setCart] = useState(null);
  const [activeCat, setActiveCat] = useState('all');
  const [addingId, setAddingId] = useState(null);
  const [addError, setAddError] = useState(null);
  const [toast, setToast] = useState(null);

  async function load() {
    setError(null);
    try {
      const payload = await api.foodRestaurant(id);
      // Deep-link guard: empty menus bounce back with the same alert as discovery.
      if (!(payload?.items || []).length) {
        await notifyMenuUnavailable(payload?.restaurant?.name);
        if (location.key !== 'default') navigate(-1);
        else navigate('/food');
        return;
      }
      setData(payload);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!session) return;
    api.foodCart(id).then(setCart).catch(() => {});
  }, [id, session]);

  async function addToCart(item, size = null) {
    if (!session) {
      navigate(`/login?next=${encodeURIComponent(`/food/r/${id}`)}`);
      return;
    }
    // Sized drinks must pick a size on the card (inline). No separate sheet.
    if (enabledSizes(item).length > 0 && !size) return;

    setAddingId(item.id);
    setAddError(null);
    try {
      setCart(await api.foodCartAdd({ menu_item_id: item.id, quantity: 1, ...(size ? { size } : {}) }));
      const sizeLabel = size
        ? enabledSizes(item).find((s) => s.id === size)?.label
        : null;
      setToast({ id: Date.now(), name: item.name, sizeLabel });
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAddingId(null);
    }
  }

  const items = useMemo(() => {
    const all = data?.items || [];
    if (activeCat === 'all') return all;
    if (activeCat === 'other') return all.filter((i) => !i.category_id);
    return all.filter((i) => i.category_id === activeCat);
  }, [data, activeCat]);

  const hasUncategorized = (data?.items || []).some((i) => !i.category_id);
  const cartCount = (cart?.items || []).reduce((n, i) => n + i.quantity, 0);
  const categories = useMemo(() => {
    if (!data) return [];
    return [
      { id: 'all', name: 'All' },
      ...data.categories,
      ...(hasUncategorized && data.categories.length ? [{ id: 'other', name: 'Other' }] : []),
    ];
  }, [data, hasUncategorized]);

  return (
    <PortalShell
      wide
      title={data?.restaurant?.name || 'Restaurant'}
      subtitle={data?.restaurant?.cuisine_type || undefined}
      onBack={() => {
        if (location.key !== 'default') navigate(-1);
        else navigate('/');
      }}
    >
      {error && (
        <Card className="p-6 text-center">
          <p className="text-brand-dark font-bold mb-1">Could not load this restaurant</p>
          <p className="text-sm text-brand-grey mb-4">{error}</p>
          <button type="button" onClick={load} className={btnPrimary}>
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </Card>
      )}

      {!data && !error && (
        <div className="flex justify-center py-20">
          <Spinner className="!w-8 !h-8" />
        </div>
      )}

      {data && !error && (
        <div className="pb-28">
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className="mb-5 overflow-hidden rounded-3xl border border-brand-border bg-white shadow-sm"
          >
            <div className="h-24 sm:h-28 bg-gradient-to-br from-brand-orange via-[#ff9447] to-brand-red relative">
              <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_20%_20%,white,transparent_45%),radial-gradient(circle_at_80%_0%,white,transparent_40%)]" />
            </div>
            <div className="relative px-4 sm:px-5 pb-4 -mt-10 flex gap-3.5 sm:gap-4">
              <div className="w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-2xl bg-white p-1 shadow-lg ring-1 ring-black/5 shrink-0">
                <div className="w-full h-full rounded-[0.9rem] overflow-hidden bg-brand-warm flex items-center justify-center">
                  {data.restaurant.logo_url ? (
                    <img src={data.restaurant.logo_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <UtensilsCrossed className="w-8 h-8 text-brand-orange" />
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1 pt-10 sm:pt-11">
                <h2 className="font-black text-brand-black text-xl sm:text-2xl tracking-tight truncate">
                  {data.restaurant.name}
                </h2>
                {data.restaurant.description && (
                  <p className="text-sm text-brand-grey mt-1 line-clamp-2 leading-relaxed">
                    {data.restaurant.description}
                  </p>
                )}
                {/* The reopening time only appears when the schedule is what
                    closed them — a manual "closed now" has no known end. */}
                {data.restaurant.isOpen === false && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-black px-2.5 py-1">
                    {data.restaurant.opensNext
                      ? `Closed right now — ${reopensLabel(data.restaurant).toLowerCase()}`
                      : 'Closed right now — browse the menu, ordering reopens later'}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-warm text-brand-orange text-[11px] font-black px-2.5 py-1">
                    <Bike className="w-3.5 h-3.5" />
                    Delivery {fmtSAR(data.deliveryFee)}
                  </span>
                  {/* The restaurant's own hours, not a guessed ETA. */}
                  {todayHoursLabel(data.restaurant) && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-surface text-brand-dark text-[11px] font-bold px-2.5 py-1">
                      <Clock3 className="w-3.5 h-3.5 text-brand-orange" />
                      {todayHoursLabel(data.restaurant)}
                    </span>
                  )}
                  {data.restaurant.address && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-grey min-w-0 max-w-full">
                      <MapPin className="w-3.5 h-3.5 shrink-0 text-brand-orange" />
                      <span className="truncate">{data.restaurant.address}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.section>

          <OpeningHoursCard merchant={data.restaurant} />

          {addError && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium"
            >
              {addError}
            </motion.div>
          )}

          {categories.length > 1 && (
            <CategoryScroller
              categories={categories}
              activeCat={activeCat}
              onSelect={setActiveCat}
            />
          )}

          {items.length === 0 ? (
            <Card className="p-10 text-center rounded-3xl">
              <UtensilsCrossed className="w-10 h-10 text-brand-grey/40 mx-auto mb-3" />
              <p className="font-bold text-brand-dark">No items here yet</p>
              <p className="text-sm text-brand-grey mt-1">
                This restaurant has not added items to this section.
              </p>
            </Card>
          ) : (
            <motion.div
              key={activeCat}
              variants={listVariants}
              initial="hidden"
              animate="show"
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-3.5"
            >
              {items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onAdd={addToCart}
                  busy={addingId === item.id}
                  closed={data.restaurant.isOpen === false}
                />
              ))}
            </motion.div>
          )}
        </div>
      )}

      <AnimatePresence>
        {toast && (
          <AddedToast
            key={toast.id}
            itemName={toast.name}
            sizeLabel={toast.sizeLabel}
            onDone={() => setToast(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cartCount > 0 && (
          <motion.div
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="fixed bottom-0 inset-x-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            <div className="max-w-7xl mx-auto">
              <motion.button
                type="button"
                onClick={() => navigate(`/food/cart?m=${id}`)}
                whileTap={{ scale: 0.985 }}
                className="w-full flex items-center justify-between gap-3 rounded-2xl bg-brand-black text-white px-5 py-3.5 shadow-2xl shadow-black/25 cursor-pointer"
              >
                <span className="inline-flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-xl bg-brand-orange flex items-center justify-center shrink-0">
                    <ShoppingCart className="w-4 h-4" />
                  </span>
                  <span className="text-left min-w-0">
                    <span className="block text-[11px] font-bold text-white/60 uppercase tracking-wider">
                      Your cart
                    </span>
                    <span className="block text-sm font-black truncate">
                      {cartCount} {cartCount === 1 ? 'item' : 'items'} ready
                    </span>
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5 font-black tabular-nums shrink-0">
                  {fmtSAR(cart.subtotal)}
                  <ChevronRight className="w-4 h-4 text-brand-orange" />
                </span>
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </PortalShell>
  );
}
