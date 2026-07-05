// ---------------------------------------------------------------------
// Food Delivery — restaurant menu: /food/r/:id
// Category tabs, item cards with add-to-cart, and a sticky cart bar
// showing the running count + subtotal. Browsing is public; the first
// "Add" while signed out bounces to /login with a return path.
// ---------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { UtensilsCrossed, Plus, ShoppingCart, RefreshCw, MapPin } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthProvider';
import { fmtSAR } from '../lib/constants';
import { PortalShell, Card, Badge, Spinner, btnPrimary } from '../components/ui';

function ItemCard({ item, onAdd, busy }) {
  const unavailable = !item.is_available;
  return (
    <Card className={`p-4 flex gap-3 ${unavailable ? 'opacity-60' : ''}`}>
      <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-brand-orange/15 to-brand-red/10 flex items-center justify-center shrink-0 overflow-hidden">
        {item.image_url ? (
          <img src={item.image_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <UtensilsCrossed className="w-7 h-7 text-brand-orange/50" />
        )}
      </div>
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <p className="font-bold text-brand-dark truncate">{item.name}</p>
          {unavailable && <Badge tone="grey">Unavailable</Badge>}
        </div>
        {item.description && (
          <p className="text-xs text-brand-grey mt-0.5 line-clamp-2">{item.description}</p>
        )}
        <div className="mt-auto pt-2 flex items-center justify-between gap-2">
          <span className="font-black text-brand-orange">{fmtSAR(item.price)}</span>
          <button
            type="button"
            disabled={unavailable || busy}
            onClick={() => onAdd(item)}
            className="inline-flex items-center gap-1 bg-brand-orange hover:bg-brand-orange/90 text-white text-xs font-black px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? <Spinner className="!w-3.5 !h-3.5 !border-white/40 !border-t-white" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </button>
        </div>
      </div>
    </Card>
  );
}

export default function RestaurantPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [cart, setCart] = useState(null);
  const [activeCat, setActiveCat] = useState('all');
  const [addingId, setAddingId] = useState(null);
  const [addError, setAddError] = useState(null);

  async function load() {
    setError(null);
    try {
      setData(await api.foodRestaurant(id));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The cart bar only exists for signed-in customers.
  useEffect(() => {
    if (!session) return;
    api.foodCart(id).then(setCart).catch(() => {});
  }, [id, session]);

  async function addToCart(item) {
    if (!session) {
      navigate(`/login?next=${encodeURIComponent(`/food/r/${id}`)}`);
      return;
    }
    setAddingId(item.id);
    setAddError(null);
    try {
      setCart(await api.foodCartAdd({ menu_item_id: item.id, quantity: 1 }));
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

  return (
    <PortalShell
      title={data?.restaurant?.name || 'Restaurant'}
      subtitle={data?.restaurant?.cuisine_type || undefined}
      onBack={() => navigate('/food')}
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
        <div className="flex justify-center py-20"><Spinner className="!w-8 !h-8" /></div>
      )}

      {data && !error && (
        <div className="pb-24">
          {/* Header card */}
          <Card className="p-5 mb-5 flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-orange to-brand-red flex items-center justify-center shrink-0 overflow-hidden">
              {data.restaurant.logo_url ? (
                <img src={data.restaurant.logo_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <UtensilsCrossed className="w-7 h-7 text-white" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-black text-brand-black text-lg truncate">{data.restaurant.name}</p>
              {data.restaurant.description && (
                <p className="text-sm text-brand-grey line-clamp-2">{data.restaurant.description}</p>
              )}
              {data.restaurant.address && (
                <p className="text-xs text-brand-grey mt-1 flex items-center gap-1 truncate">
                  <MapPin className="w-3 h-3 shrink-0" /> {data.restaurant.address}
                </p>
              )}
            </div>
            <Badge tone="amber" className="ml-auto shrink-0 hidden sm:inline-flex">
              Delivery {fmtSAR(data.deliveryFee)}
            </Badge>
          </Card>

          {addError && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              {addError}
            </div>
          )}

          {/* Category tabs */}
          {(data.categories.length > 0 || hasUncategorized) && (
            <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
              {[
                { id: 'all', name: 'All' },
                ...data.categories,
                ...(hasUncategorized && data.categories.length ? [{ id: 'other', name: 'Other' }] : []),
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCat(cat.id)}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold border whitespace-nowrap cursor-pointer transition-colors ${
                    activeCat === cat.id
                      ? 'bg-brand-black text-white border-brand-black'
                      : 'bg-white text-brand-grey border-brand-border'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}

          {/* Items */}
          {items.length === 0 ? (
            <Card className="p-10 text-center">
              <UtensilsCrossed className="w-10 h-10 text-brand-grey/40 mx-auto mb-3" />
              <p className="font-bold text-brand-dark">No items here yet</p>
              <p className="text-sm text-brand-grey mt-1">This restaurant has not added items to this section.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map((item) => (
                <ItemCard key={item.id} item={item} onAdd={addToCart} busy={addingId === item.id} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sticky cart bar */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 p-3 bg-white/95 backdrop-blur border-t border-brand-border">
          <div className="max-w-5xl mx-auto">
            <button
              type="button"
              onClick={() => navigate(`/food/cart?m=${id}`)}
              className={btnPrimary + ' w-full !py-3.5'}
            >
              <ShoppingCart className="w-4 h-4" />
              View cart · {cartCount} {cartCount === 1 ? 'item' : 'items'} · {fmtSAR(cart.subtotal)}
            </button>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
