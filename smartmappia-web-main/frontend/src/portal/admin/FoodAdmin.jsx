// ---------------------------------------------------------------------
// Admin portal — Food Delivery tab.
//
// Restaurants contact SmartMappia and admins run everything from here —
//   * restaurant CRUD (create / edit / list-unlist / delete)
//   * menu import + editing (categories, items, prices, photos)
//   * order operations: accept (300 SAR credit-gated) / reject / advance,
//     STC payment verify/reject, rider assignment, cancel + refund
//   * credit monitoring with reconcile (replenish)
//   * owner account provisioning: the admin creates the account AND chooses
//     its password (handed over at contract signing), and re-issues that
//     password if the owner loses it. There is no self-service merchant
//     signup and no reset email.
// ---------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import {
  Store,
  ClipboardList,
  Wallet,
  Check,
  X,
  Bike,
  Pencil,
  Plus,
  Trash2,
  ShieldX,
  ShieldCheck,
  Eye,
  EyeOff,
  UtensilsCrossed,
  ChevronRight,
  Image as ImageIcon,
  UserPlus,
  UserCheck,
  Coins,
  Download,
  Clock,
  Search,
  Inbox,
  Sparkles,
  Banknote,
  Receipt,
  Undo2,
} from 'lucide-react';
import { api } from '../lib/api';
import { toCsv, downloadCsv } from '../lib/csv';
import { useBroadcast } from '../lib/useBroadcast';
import { formatAddressDetail } from '../lib/address';
import { realtimeEnabled } from '../lib/supabaseClient';
import { fmtSAR, foodStatusMeta, foodPaymentMeta } from '../lib/constants';
import { notifySuccess } from '../lib/notify';
import { Card, Badge, Field, Spinner, btnPrimary, btnGhost, inputClass } from '../components/ui';
import SharedImageUploadField from '../components/ImageUploadField';
import StoreHoursEditor from '../components/StoreHoursEditor';
import PasswordInput from '../components/PasswordInput';
import DatePicker from '../../components/DatePicker';
import MerchantForm from './MerchantForm';

// Owner passwords are chosen by the admin and handed over in person — keep this
// in step with MIN_PASSWORD_LENGTH in backend/lib/validate.js.
const MIN_OWNER_PASSWORD = 8;

// Restaurant logo / menu photo upload. The shared field does the work; food
// only supplies its own signed-URL endpoint.
function ImageUploadField({ merchantId, kind, value, onChange }) {
  return (
    <SharedImageUploadField
      kind={kind}
      value={value}
      onChange={onChange}
      ready={!!merchantId}
      notReadyHint={`Save the restaurant first, then edit it to upload ${
        kind === 'logo' ? 'a logo' : 'a photo'
      }.`}
      getSignedUrl={(body) => api.adminFoodMerchantImageSignedUrl(merchantId, body)}
    />
  );
}

// Item category. The platform markup now comes from the net price (below),
// not from this bucket — item_type only falls back to a flat margin (SAR 5 /
// SAR 3) for items left WITHOUT a net price.
const ITEM_TYPES = [
  { value: 'meal_package', label: 'Meal / package' },
  { value: 'drink_dessert_addon', label: 'Drink / dessert / add-on' },
];

const NEXT_STATUS = {
  accepted: { status: 'preparing', label: 'Start preparing' },
  preparing: { status: 'ready', label: 'Mark ready' },
  ready: { status: 'out_for_delivery', label: 'Out for delivery' },
  out_for_delivery: { status: 'delivered', label: 'Mark delivered' },
};

function Stat({ label, value, accent = false, icon: Icon, hint, onClick }) {
  const inner = (
    <>
      {Icon && (
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 ${
          accent ? 'bg-brand-orange/12 text-brand-orange' : 'bg-brand-muted text-brand-dark'
        }`}>
          <Icon className="w-4 h-4" />
        </span>
      )}
      <p className="text-[11px] font-bold text-brand-grey uppercase tracking-wider">{label}</p>
      <p className={`text-lg sm:text-xl font-black tabular-nums mt-1 break-words ${accent ? 'text-brand-orange' : 'text-brand-black'}`}>
        {value}
      </p>
      {hint && <p className="text-[11px] text-brand-grey mt-1">{hint}</p>}
    </>
  );
  const cls = 'p-4 min-w-0 text-left w-full h-full';
  if (onClick) {
    return (
      <Card className="overflow-hidden min-w-0">
        <button type="button" onClick={onClick} className={`${cls} cursor-pointer hover:bg-brand-muted/40`}>
          {inner}
        </button>
      </Card>
    );
  }
  return <Card className={cls}>{inner}</Card>;
}

// --- Menu item form ---------------------------------------------------------
const EMPTY_ITEM = { name: '', description: '', price: '', net_price: '', item_type: 'meal_package', category_id: '', image_url: '', size_options: null };

// Drink sizes appear for drink/dessert add-ons and drink-like categories
// (tea, coffee, milkshakes, PAMATAY UHAW, etc.).
function isDrinkCategory(category) {
  return /drink|tea|coffee|milk|shake|smoothie|uhaw|juice|beverage/i.test(category?.name || '');
}

function canHaveSizes(itemType, category) {
  return itemType === 'drink_dessert_addon' || isDrinkCategory(category);
}

const DEFAULT_SIZE_ROWS = [
  { id: 'medium', label: 'Medium', price: '', enabled: true },
  { id: 'large', label: 'Large', price: '', enabled: true },
];

// Live markup preview for the item form: list price - net price.
function markupHint(price, netPrice) {
  if (netPrice === '' || netPrice == null) {
    return { text: 'No net price — a flat SAR 5 / SAR 3 margin applies.', tone: 'muted' };
  }
  const p = Number(price);
  const n = Number(netPrice);
  if (!Number.isFinite(p) || !Number.isFinite(n)) return { text: '', tone: 'muted' };
  if (n > p) return { text: 'Net price cannot exceed the list price.', tone: 'error' };
  const markup = Math.round((p - n) * 100) / 100;
  return { text: `Our markup: SAR ${markup.toFixed(2)} per item.`, tone: 'ok' };
}

function ItemForm({ initial, categories, onSave, onCancel, busy, merchantId }) {
  const [form, setForm] = useState({ ...EMPTY_ITEM, ...initial });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const selectedCategory = categories.find((c) => c.id === form.category_id);
  const sizesAllowed = canHaveSizes(form.item_type, selectedCategory);
  const sizeRows = Array.isArray(form.size_options) ? form.size_options : null;
  const sizesOn = sizesAllowed && !!sizeRows && sizeRows.length > 0;

  function toggleSizes(on) {
    const medium = form.price || '';
    const large = medium === '' ? '' : String(Math.round((Number(medium) + 5) * 100) / 100);
    setForm((f) => ({
      ...f,
      size_options: on
        ? DEFAULT_SIZE_ROWS.map((s) => ({
            ...s,
            price: s.id === 'large' ? (s.price || large) : (s.price || medium),
          }))
        : null,
    }));
  }

  function setSizeRow(index, patch) {
    setForm((f) => ({
      ...f,
      size_options: f.size_options.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }

  function submit(e) {
    e.preventDefault();
    onSave({
      name: form.name.trim(),
      description: (form.description || '').trim() || null,
      price: Number(form.price),
      net_price: form.net_price === '' || form.net_price == null ? null : Number(form.net_price),
      item_type: form.item_type,
      category_id: form.category_id || null,
      image_url: (form.image_url || '').trim() || null,
      size_options: sizesOn
        ? sizeRows.map((s) => ({
            id: s.id,
            label: (s.label || '').trim(),
            price: Number(s.price),
            enabled: s.enabled !== false,
          }))
        : null,
    });
  }

  const hint = markupHint(form.price, form.net_price);

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Item name">
        <input value={form.name} onChange={set('name')} className={inputClass} required />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="List price (SAR) — shown to the customer">
          <input type="number" min="0.01" step="0.01" value={form.price} onChange={set('price')} className={inputClass} required />
        </Field>
        <Field label="Net price (SAR) — what the restaurant keeps">
          <input type="number" min="0.01" step="0.01" value={form.net_price ?? ''} onChange={set('net_price')} className={inputClass} placeholder="Optional" />
        </Field>
      </div>
      {hint.text && (
        <p className={`text-xs font-bold -mt-1 ${
          hint.tone === 'error' ? 'text-red-600' : hint.tone === 'ok' ? 'text-green-700' : 'text-brand-grey'
        }`}>
          {hint.text}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Category">
          <select value={form.category_id || ''} onChange={set('category_id')} className={inputClass}>
            <option value="">No category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select value={form.item_type} onChange={set('item_type')} className={inputClass}>
            {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
      </div>
      {/* Drink sizes — drink items / drink-like categories */}
      {sizesAllowed && (
        <div className="rounded-xl border border-brand-border bg-white p-3.5">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs font-bold text-brand-dark uppercase tracking-wider">
              Size options (Medium / Large)
            </span>
            <span className="relative inline-flex items-center">
              <input
                type="checkbox"
                checked={sizesOn}
                onChange={(e) => toggleSizes(e.target.checked)}
                className="peer sr-only"
              />
              <span className="w-9 h-5 rounded-full bg-brand-border peer-checked:bg-brand-orange transition-colors" />
              <span className="absolute left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
            </span>
          </label>
          {sizesOn && (
            <div className="mt-3 space-y-2">
              {sizeRows.map((s, i) => (
                <div key={s.id} className={`flex items-center gap-2 ${s.enabled === false ? 'opacity-50' : ''}`}>
                  <input
                    type="checkbox"
                    checked={s.enabled !== false}
                    onChange={(e) => setSizeRow(i, { enabled: e.target.checked })}
                    className="w-4 h-4 accent-orange-500 cursor-pointer shrink-0"
                    title={s.enabled !== false ? 'Disable this size' : 'Enable this size'}
                  />
                  <input
                    value={s.label}
                    onChange={(e) => setSizeRow(i, { label: e.target.value })}
                    className={inputClass + ' !py-2 flex-1'}
                    placeholder="Label"
                    maxLength={40}
                    required={s.enabled !== false}
                  />
                  <div className="relative w-32 shrink-0">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-brand-grey">SAR</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={s.price}
                      onChange={(e) => setSizeRow(i, { price: e.target.value })}
                      className={inputClass + ' !py-2 !pl-9'}
                      placeholder="Price"
                      required
                    />
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-brand-grey">
                Customers pick a size before adding; the size price replaces the list price.
                Untick a size to hide it without deleting it.
              </p>
            </div>
          )}
        </div>
      )}
      <Field label="Photo">
        <ImageUploadField
          merchantId={merchantId}
          kind="item"
          value={form.image_url || ''}
          onChange={(url) => setForm((f) => ({ ...f, image_url: url || '' }))}
        />
      </Field>
      <Field label="Description">
        <input value={form.description || ''} onChange={set('description')} className={inputClass} placeholder="Optional" />
      </Field>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={busy} className={btnPrimary + ' flex-1'}>
          {busy ? <Spinner className="!border-white/40 !border-t-white" /> : 'Save item'}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
      </div>
    </form>
  );
}

// --- Menu editor (import + CRUD for one restaurant) --------------------------
function MenuEditor({ merchant, onClose, onError }) {
  const [menu, setMenu] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editingItem, setEditingItem] = useState(null); // null | 'new' | item
  const [newCategory, setNewCategory] = useState('');

  const load = useCallback(async () => {
    try {
      setMenu(await api.adminFoodMerchantMenu(merchant.id));
    } catch (err) {
      onError(err.message);
    }
  }, [merchant.id, onError]);

  useEffect(() => { load(); }, [load]);

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const categories = menu?.categories || [];
  const items = menu?.items || [];

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="font-black text-brand-black">Menu — {merchant.name}</p>
        <button type="button" onClick={onClose} className={btnGhost + ' !py-2 !px-3.5 !text-xs'}>
          <X className="w-3.5 h-3.5" /> Close
        </button>
      </div>

      {!menu && <div className="flex justify-center py-8"><Spinner className="!w-6 !h-6" /></div>}

      {menu && (
        <div className="space-y-5">
          <div>
            <p className="text-xs font-bold text-brand-grey uppercase tracking-wider mb-2">Categories</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newCategory.trim()) return;
                run(() => api.adminFoodAddCategory(merchant.id, { name: newCategory.trim(), sort_order: categories.length }));
                setNewCategory('');
              }}
              className="flex gap-2 mb-2"
            >
              <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className={inputClass + ' flex-1 !py-2'} placeholder="New category" />
              <button type="submit" disabled={busy} className={btnPrimary + ' !px-3 !py-2'}><Plus className="w-4 h-4" /></button>
            </form>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <span key={cat.id} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full border border-brand-border text-xs font-bold text-brand-dark">
                  {cat.name}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete category "${cat.name}"? Items keep existing without it.`)) {
                        run(() => api.adminFoodDeleteCategory(cat.id));
                      }
                    }}
                    className="p-0.5 rounded-full text-brand-grey hover:text-red-600 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
              {categories.length === 0 && <span className="text-xs text-brand-grey">None yet — items can live without one.</span>}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-brand-grey uppercase tracking-wider">Items ({items.length})</p>
              <button type="button" onClick={() => setEditingItem('new')} className={btnPrimary + ' !py-1.5 !px-3 !text-xs'}>
                <Plus className="w-3.5 h-3.5" /> Add item
              </button>
            </div>

            {editingItem && (
              <div className="mb-3 p-4 rounded-xl border border-brand-orange/40 bg-brand-warm">
                <p className="font-bold text-brand-dark text-sm mb-3">
                  {editingItem === 'new' ? 'New item' : `Edit: ${editingItem.name}`}
                </p>
                <ItemForm
                  initial={
                    editingItem === 'new'
                      ? EMPTY_ITEM
                      : {
                          ...editingItem,
                          price: String(editingItem.price),
                          net_price: editingItem.net_price == null ? '' : String(editingItem.net_price),
                        }
                  }
                  categories={categories}
                  busy={busy}
                  merchantId={merchant.id}
                  onCancel={() => setEditingItem(null)}
                  onSave={(payload) =>
                    run(async () => {
                      if (editingItem === 'new') await api.adminFoodAddItem(merchant.id, payload);
                      else await api.adminFoodModerateItem(editingItem.id, payload);
                      setEditingItem(null);
                    })
                  }
                />
              </div>
            )}

            {items.length === 0 && !editingItem && (
              <p className="text-sm text-brand-grey py-4 text-center">
                No items yet — import the restaurant's menu here before listing it.
              </p>
            )}

            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl border border-brand-border">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-orange/15 to-brand-red/10 flex items-center justify-center overflow-hidden shrink-0">
                    {item.image_url ? (
                      <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <UtensilsCrossed className="w-4 h-4 text-brand-orange/50" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-brand-dark text-sm truncate">{item.name}</p>
                    <p className="text-xs text-brand-grey">
                      {fmtSAR(item.price)} · {item.item_type === 'meal_package' ? 'Meal' : 'Drink/add-on'}
                      {item.net_price != null && (
                        <span className="text-green-700 font-bold"> · +{fmtSAR(item.price - item.net_price)} markup</span>
                      )}
                      {Array.isArray(item.size_options) && item.size_options.length > 0 && (
                        <span className="text-brand-orange font-bold">
                          {' '}· {item.size_options.filter((s) => s.enabled !== false).map((s) => s.label).join('/')}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => api.adminFoodModerateItem(item.id, { is_available: !item.is_available }))}
                    className={`text-xs font-bold px-2.5 py-1.5 rounded-lg cursor-pointer shrink-0 ${
                      item.is_available ? 'bg-green-50 text-green-700' : 'bg-brand-surface text-brand-grey'
                    }`}
                  >
                    {item.is_available ? 'Available' : 'Hidden'}
                  </button>
                  <button type="button" onClick={() => setEditingItem(item)}
                    className="p-1.5 rounded-lg text-brand-grey hover:text-brand-dark hover:bg-brand-surface cursor-pointer shrink-0">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete "${item.name}"?`)) run(() => api.adminFoodDeleteItem(item.id));
                    }}
                    className="p-1.5 rounded-lg text-brand-grey hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// --- Merchants section --------------------------------------------------------
function MerchantsSection({ onError }) {
  const [merchants, setMerchants] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | merchant
  const [menuFor, setMenuFor] = useState(null); // merchant whose menu is open
  const [ownerFor, setOwnerFor] = useState(null); // merchant whose owner form is open
  const [hoursFor, setHoursFor] = useState(null); // merchant whose hours editor is open
  const [ownerForm, setOwnerForm] = useState({ email: '', password: '', full_name: '', phone: '' });
  const [ownerPassword, setOwnerPassword] = useState(''); // re-issue field for a linked owner
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      setMerchants((await api.adminFoodMerchants()).merchants || []);
    } catch (err) {
      onError(err.message);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  async function run(id, fn) {
    setBusyId(id);
    try {
      await fn();
      await load();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function reconcile(m) {
    const raw = window.prompt(
      `Reconcile ${m.name}: amount (SAR) the restaurant settled?\nCredit used: ${fmtSAR(m.creditUsed)} of ${fmtSAR(m.creditLimit)}.`
    );
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return onError('Please enter a valid positive amount.');
    run(m.id, () => api.adminFoodCredit(m.id, { amount }));
  }

  if (merchants === null) return <div className="flex justify-center py-12"><Spinner className="!w-7 !h-7" /></div>;

  const visible = merchants.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      m.name?.toLowerCase().includes(q) ||
      m.cuisineType?.toLowerCase().includes(q) ||
      m.address?.toLowerCase().includes(q)
    );
  });

  if (menuFor) {
    return <MenuEditor merchant={menuFor} onClose={() => setMenuFor(null)} onError={onError} />;
  }

  return (
    <div className="space-y-3">
      {editing ? (
        <Card className="p-5">
          <p className="font-black text-brand-black mb-4">
            {editing === 'new' ? 'Add restaurant' : `Edit: ${editing.name}`}
          </p>
          <MerchantForm
            noun="Restaurant"
            categoryLabel="Cuisine type"
            categoryPlaceholder="e.g. Lebanese"
            initial={
              editing === 'new'
                ? undefined
                : {
                    name: editing.name,
                    cuisine_type: editing.cuisineType,
                    description: editing.description,
                    address: editing.address,
                    street: editing.street || '',
                    building_number: editing.buildingNumber || '',
                    logo_url: editing.logoUrl,
                    lat: editing.lat,
                    lng: editing.lng,
                    is_active: editing.isActive,
                    is_featured: editing.isFeatured,
                    badge: editing.badge || '',
                  }
            }
            busy={busyId === 'form'}
            renderLogo={(value, onChange) => (
              <ImageUploadField
                merchantId={editing === 'new' ? null : editing.id}
                kind="logo"
                value={value}
                onChange={onChange}
              />
            )}
            onCancel={() => setEditing(null)}
            onSave={(payload) =>
              run('form', async () => {
                if (editing === 'new') await api.adminFoodCreateMerchant(payload);
                else await api.adminFoodUpdateMerchant(editing.id, payload);
                setEditing(null);
              })
            }
          />
        </Card>
      ) : (
        <button type="button" onClick={() => setEditing('new')} className={btnPrimary + ' w-full sm:w-auto !py-3'}>
          <Plus className="w-4 h-4" /> Add restaurant
        </button>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-grey" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search restaurants…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-brand-border bg-white text-sm focus:outline-none focus:border-brand-orange"
        />
      </div>

      <Card className="p-0 overflow-hidden min-w-0">
        <div className="px-3 sm:px-4 py-3 border-b border-brand-border flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-black text-brand-black text-sm">Restaurants</p>
            <p className="text-xs text-brand-grey">List, menus, owners, and credit</p>
          </div>
          <span className="text-xs font-bold text-brand-grey tabular-nums shrink-0">
            {visible.length}
          </span>
        </div>
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center px-5 py-12">
            <div className="w-14 h-14 rounded-2xl bg-brand-warm text-brand-orange flex items-center justify-center mb-4">
              {search.trim() ? <Search className="w-6 h-6" /> : <Store className="w-6 h-6" />}
            </div>
            <p className="font-black text-brand-black">{search.trim() ? 'No matches' : 'No restaurants yet'}</p>
            <p className="text-sm text-brand-grey mt-1.5 max-w-xs">
              {search.trim()
                ? `Nothing matches “${search.trim()}”.`
                : 'When a restaurant partners with SmartMappia, add it here and import its menu.'}
            </p>
          </div>
        )}
        <div className="divide-y divide-brand-border">
          {visible.map((m) => {
            const pct = Math.min(100, Math.round((m.creditUsed / m.creditLimit) * 100));
            const barColor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-orange';
            return (
              <div key={m.id} className="p-3 sm:p-4 min-w-0">
                <div className="flex items-start gap-3">
                  {m.logoUrl ? (
                    <img src={m.logoUrl} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 bg-brand-surface" />
                  ) : (
                    <span className="w-12 h-12 rounded-xl bg-brand-orange/12 text-brand-orange flex items-center justify-center shrink-0">
                      <Store className="w-5 h-5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-brand-black truncate">{m.name}</p>
                    <p className="text-xs text-brand-grey truncate mt-0.5">
                      {[m.cuisineType, m.address].filter(Boolean).join(' · ') || 'No address'}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-2">
                      <Badge tone={m.isActive ? 'green' : 'grey'} className="!px-2 !py-0.5 !text-[10px]">
                        {m.isActive ? 'Listed' : 'Unlisted'}
                      </Badge>
                      {m.status === 'suspended' && <Badge tone="red" className="!px-2 !py-0.5 !text-[10px]">Suspended</Badge>}
                      {m.acceptingOrders === false && <Badge tone="amber" className="!px-2 !py-0.5 !text-[10px]">Closed now</Badge>}
                      {(m.lat == null || m.lng == null) && <Badge tone="amber" className="!px-2 !py-0.5 !text-[10px]">No location pin</Badge>}
                      {m.isFeatured && <Badge tone="amber" className="!px-2 !py-0.5 !text-[10px]">Homepage</Badge>}
                      {m.isFeatured && !m.logoUrl && (
                        <Badge tone="red" className="!px-2 !py-0.5 !text-[10px]">No logo — hidden on homepage</Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="h-2 rounded-full bg-brand-surface overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[11px] text-brand-grey mt-1.5 tabular-nums">
                    Credit used {fmtSAR(m.creditUsed)} of {fmtSAR(m.creditLimit)} ({pct}%)
                  </p>
                </div>

                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  <button type="button" disabled={busyId === m.id} onClick={() => setMenuFor(m)}
                    className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}>
                    <UtensilsCrossed className="w-3.5 h-3.5" /> Menu
                  </button>
                  <button type="button" disabled={busyId === m.id} onClick={() => setEditing(m)}
                    className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}>
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button type="button" disabled={busyId === m.id}
                    onClick={() => setHoursFor(hoursFor === m.id ? null : m.id)}
                    className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}>
                    <Clock className="w-3.5 h-3.5" /> Hours
                  </button>
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => {
                      setOwnerFor(ownerFor === m.id ? null : m.id);
                      setOwnerForm({ email: '', password: '', full_name: '', phone: '' });
                      setOwnerPassword('');
                    }}
                    className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}
                    title={m.ownerEmail ? `Owner: ${m.ownerEmail}` : 'No owner account yet'}
                  >
                    {m.ownerId ? <UserCheck className="w-3.5 h-3.5 text-green-600" /> : <UserPlus className="w-3.5 h-3.5" />}
                    {m.ownerId ? 'Owner' : 'Assign'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => run(m.id, () => api.adminFoodUpdateMerchant(m.id, { is_active: !m.isActive }))}
                    className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}
                    title={m.isActive ? 'Hide from customers' : 'Make visible to customers'}
                  >
                    {m.isActive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {m.isActive ? 'Unlist' : 'List'}
                  </button>
                  <button type="button" disabled={busyId === m.id} onClick={() => reconcile(m)}
                    className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}>
                    <Wallet className="w-3.5 h-3.5" /> Reconcile
                  </button>
                  {m.status === 'suspended' ? (
                    <button type="button" disabled={busyId === m.id}
                      onClick={() => run(m.id, () => api.adminFoodReactivate(m.id))}
                      className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center !text-green-700 !border-green-200'}>
                      <ShieldCheck className="w-3.5 h-3.5" /> Reactivate
                    </button>
                  ) : (
                    <button type="button" disabled={busyId === m.id}
                      onClick={() => {
                        const reason = window.prompt(`Suspend ${m.name}? Reason (optional):`);
                        if (reason === null) return;
                        run(m.id, () => api.adminFoodSuspend(m.id, reason || undefined));
                      }}
                      className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center !text-red-600 !border-red-200'}>
                      <ShieldX className="w-3.5 h-3.5" /> Suspend
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => {
                      if (window.confirm(`Delete ${m.name}? Restaurants with order history can only be unlisted.`)) {
                        run(m.id, () => api.adminFoodDeleteMerchant(m.id));
                      }
                    }}
                    className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center !text-red-600 !border-red-200'}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>

                {hoursFor === m.id && (
                  <div className="mt-3 pt-3 border-t border-brand-border">
                    <StoreHoursEditor
                      load={() => api.adminFoodHours(m.id)}
                      save={(hours) => api.adminFoodSetHours(m.id, hours)}
                      setAccepting={async (accepting) => {
                        await api.adminFoodSetAccepting(m.id, accepting);
                        load(); // refresh the "Closed now" badge above
                      }}
                    />
                  </div>
                )}

                {ownerFor === m.id && (
                  <div className="mt-3 p-3 rounded-xl border border-brand-orange/40 bg-brand-warm space-y-2">
                    <p className="text-xs font-bold text-brand-dark">
                      {m.ownerEmail
                        ? `Owner account linked: ${m.ownerEmail}`
                        : 'Create the owner account (contract-signing step)'}
                    </p>
                    {!m.ownerId && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const email = ownerForm.email.trim();
                          if (!email) return onError('Owner email is required.');
                          if (ownerForm.password.length < MIN_OWNER_PASSWORD) {
                            return onError(`Password must be at least ${MIN_OWNER_PASSWORD} characters.`);
                          }
                          run(m.id, async () => {
                            const res = await api.adminFoodSetMerchantOwner(m.id, {
                              email,
                              password: ownerForm.password,
                              full_name: ownerForm.full_name.trim() || undefined,
                              phone: ownerForm.phone.trim() || undefined,
                            });
                            setOwnerFor(null);
                            setOwnerForm({ email: '', password: '', full_name: '', phone: '' });
                            notifySuccess(
                              res.reusedExistingAccount
                                ? 'Existing account linked as the restaurant owner, with the password you set.'
                                : 'Owner account created. Give the owner their email and password.'
                            );
                          });
                        }}
                        className="space-y-2"
                      >
                        <input
                          type="email"
                          required
                          value={ownerForm.email}
                          onChange={(e) => setOwnerForm((f) => ({ ...f, email: e.target.value }))}
                          className={inputClass + ' !py-2'}
                          placeholder="Owner email"
                        />
                        <PasswordInput
                          required
                          value={ownerForm.password}
                          onChange={(e) => setOwnerForm((f) => ({ ...f, password: e.target.value }))}
                          autoComplete="new-password"
                          placeholder={`Owner password (min ${MIN_OWNER_PASSWORD} characters)`}
                          className="!py-2 !text-sm"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            value={ownerForm.full_name}
                            onChange={(e) => setOwnerForm((f) => ({ ...f, full_name: e.target.value }))}
                            className={inputClass + ' !py-2'}
                            placeholder="Full name (optional)"
                          />
                          <input
                            value={ownerForm.phone}
                            onChange={(e) => setOwnerForm((f) => ({ ...f, phone: e.target.value }))}
                            className={inputClass + ' !py-2'}
                            placeholder="Phone (optional)"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button type="submit" disabled={busyId === m.id} className={btnPrimary + ' !py-2 !px-3.5 !text-xs'}>
                            <UserPlus className="w-3.5 h-3.5" /> Create &amp; link account
                          </button>
                          <button type="button" onClick={() => setOwnerFor(null)} className={btnGhost + ' !py-2 !px-3.5 !text-xs'}>
                            Cancel
                          </button>
                        </div>
                        <p className="text-[11px] text-brand-grey">
                          Creates a confirmed account with the merchant role and links it to this
                          restaurant. Give the owner this password in person — there is no reset email.
                        </p>
                      </form>
                    )}

                    {/* Recovery: an owner who lost their password gets a new one from an
                        admin. Same reason — the platform sends no mail. */}
                    {m.ownerId && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (ownerPassword.length < MIN_OWNER_PASSWORD) {
                            return onError(`Password must be at least ${MIN_OWNER_PASSWORD} characters.`);
                          }
                          run(m.id, async () => {
                            await api.adminFoodSetOwnerPassword(m.id, { password: ownerPassword });
                            setOwnerPassword('');
                            setOwnerFor(null);
                            notifySuccess('Owner password updated. Give the new one to the owner.');
                          });
                        }}
                        className="space-y-2"
                      >
                        <PasswordInput
                          required
                          value={ownerPassword}
                          onChange={(e) => setOwnerPassword(e.target.value)}
                          autoComplete="new-password"
                          placeholder={`New password (min ${MIN_OWNER_PASSWORD} characters)`}
                          className="!py-2 !text-sm"
                        />
                        <div className="flex gap-2">
                          <button type="submit" disabled={busyId === m.id} className={btnPrimary + ' !py-2 !px-3.5 !text-xs'}>
                            Set new password
                          </button>
                          <button type="button" onClick={() => setOwnerFor(null)} className={btnGhost + ' !py-2 !px-3.5 !text-xs'}>
                            Close
                          </button>
                        </div>
                        <p className="text-[11px] text-brand-grey">
                          Replaces the owner's password immediately. Their old one stops working.
                        </p>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// --- Orders section --------------------------------------------------------------
// STC Pay screenshot review status: awaiting = still needs a human eye.
function proofReviewMeta(paymentStatus) {
  if (paymentStatus === 'paid') return { label: 'Verified', tone: 'green' };
  if (paymentStatus === 'failed') return { label: 'Rejected', tone: 'red' };
  if (paymentStatus === 'refunded') return { label: 'Refunded', tone: 'grey' };
  return { label: 'Pending review', tone: 'amber' };
}

const DELIVERY_STATUS_LABEL = {
  assigned: 'Rider assigned',
  picked_up: 'Picked up',
  delivered: 'Delivered',
};

function OrdersSection({ onError }) {
  const [orders, setOrders] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [filter, setFilter] = useState('action');
  const [busyCode, setBusyCode] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [driverId, setDriverId] = useState('');
  const [proofView, setProofView] = useState(null); // full-size screenshot lightbox
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      setOrders((await api.adminFoodOrders()).orders || []);
    } catch (err) {
      onError(err.message);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.adminDrivers().then((r) => setDrivers((r.drivers || []).filter((d) => d.driver_approved))).catch(() => {});
  }, []);
  useBroadcast('admin-food', { changed: () => load() }, realtimeEnabled);

  async function run(code, fn) {
    setBusyCode(code);
    try {
      await fn();
      await load();
    } catch (err) {
      onError(err.message);
      await load(); // e.g. a 403 credit block — refresh the true state
    } finally {
      setBusyCode(null);
    }
  }

  const LIVE = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
  const needsAction = (o) =>
    o.paymentStatus === 'awaiting' ||
    o.status === 'pending' ||
    (o.paymentStatus === 'paid' && ['cancelled', 'rejected'].includes(o.status));
  const matchesSearch = (o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      o.orderCode?.toLowerCase().includes(q) ||
      o.customerName?.toLowerCase().includes(q) ||
      o.merchantName?.toLowerCase().includes(q)
    );
  };
  const actionCount = (orders || []).filter(needsAction).length;
  const liveCount = (orders || []).filter((o) => LIVE.includes(o.status)).length;
  const filtered = (orders || []).filter((o) => {
    if (!matchesSearch(o)) return false;
    if (filter === 'action') return needsAction(o);
    if (filter === 'live') return LIVE.includes(o.status);
    return true;
  });

  return (
    <div className="space-y-3 min-w-0">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="flex gap-2 overflow-x-auto overscroll-x-contain snap-x snap-mandatory pb-1 -mx-3 px-3 sm:-mx-5 sm:px-5 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8 xl:mx-0 xl:px-0 flex-1 no-scrollbar">
          {[
            { id: 'action', label: 'Needs action', short: 'Action', count: actionCount },
            { id: 'live', label: 'Live', short: 'Live', count: liveCount },
            { id: 'all', label: 'All', short: 'All', count: orders?.length ?? 0 },
          ].map((f) => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)}
              className={`snap-start shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold border transition-colors cursor-pointer ${
                filter === f.id ? 'bg-brand-black text-white border-brand-black' : 'bg-white text-brand-grey border-brand-border'
              }`}>
              <span className="sm:hidden">{f.short}</span>
              <span className="hidden sm:inline">{f.label}</span>
              <span className={`text-[11px] tabular-nums px-1.5 py-0.5 rounded-md ${filter === f.id ? 'bg-white/15' : 'bg-brand-surface'}`}>
                {f.count}
              </span>
            </button>
          ))}
        </div>
        <div className="relative w-full xl:w-64 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-grey" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Code, customer, or restaurant…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-brand-border bg-white text-sm focus:outline-none focus:border-brand-orange"
          />
        </div>
      </div>

      {orders === null && (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Spinner className="!w-7 !h-7" />
          <p className="text-sm text-brand-grey">Loading orders…</p>
        </div>
      )}
      {orders !== null && filtered.length === 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-col items-center justify-center text-center px-5 py-12">
            <div className="w-14 h-14 rounded-2xl bg-brand-warm text-brand-orange flex items-center justify-center mb-4">
              {search.trim() ? <Search className="w-6 h-6" /> : filter === 'action' ? <Sparkles className="w-6 h-6" /> : <Inbox className="w-6 h-6" />}
            </div>
            <p className="font-black text-brand-black">
              {search.trim()
                ? 'No matches'
                : filter === 'action'
                  ? 'Nothing needs you right now'
                  : filter === 'live'
                    ? 'No live orders'
                    : 'No orders yet'}
            </p>
            <p className="text-sm text-brand-grey mt-1.5 max-w-xs">
              {search.trim()
                ? `Nothing matches “${search.trim()}”.`
                : filter === 'action'
                  ? 'Payments to verify and new orders to accept will land here.'
                  : 'Food orders will show up here as customers place them.'}
            </p>
          </div>
        </Card>
      )}

      {filtered.map((o) => {
        const status = foodStatusMeta(o.status);
        const pay = foodPaymentMeta(o.paymentStatus);
        const next = NEXT_STATUS[o.status];
        const canAssignRider = o.paymentStatus === 'paid' && ['accepted', 'preparing', 'ready', 'out_for_delivery'].includes(o.status);
        const refundable = o.paymentStatus === 'paid' && ['cancelled', 'rejected'].includes(o.status);
        const cancellable = !['delivered', 'cancelled', 'rejected'].includes(o.status);
        const busy = busyCode === o.orderCode;
        return (
          <Card key={o.orderCode} className="p-3 sm:p-4 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-brand-black truncate">{o.customerName || 'Customer'}</p>
                <p className="text-xs text-brand-grey truncate mt-0.5">
                  {o.merchantName || 'Restaurant'} · <span className="font-mono font-bold">{o.orderCode}</span>
                </p>
                <p className="text-[11px] text-brand-grey mt-0.5">{new Date(o.createdAt).toLocaleString()}</p>
              </div>
              <p className="font-black text-brand-orange tabular-nums text-sm shrink-0">{fmtSAR(o.total)}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <Badge tone={status.tone} className="!px-2 !py-0.5 !text-[10px]">{status.label}</Badge>
              <Badge tone={pay.tone} className="!px-2 !py-0.5 !text-[10px]">{pay.label}</Badge>
              {o.paymentMethod === 'cash' && <Badge tone="grey" className="!px-2 !py-0.5 !text-[10px]">Cash</Badge>}
            </div>

            {(o.items || []).length > 0 && (
              <p className="text-xs text-brand-grey mt-2 leading-relaxed line-clamp-3">
                {o.items
                  .map((i) => `${i.quantity} × ${i.name_snapshot}${i.size_snapshot ? ` (${i.size_snapshot})` : ''}`)
                  .join(', ')}
              </p>
            )}
            {/* Where it is going. The API has always sent this and the row
                never showed it — a support screen that cannot say the
                delivery address sends someone to the database. */}
            <p className="text-xs text-brand-grey mt-1 truncate">
              {formatAddressDetail({
                street: o.deliveryStreet,
                building: o.deliveryBuilding,
                address: o.deliveryAddress,
              }) || 'No address'}
            </p>
            {o.customerMobile && (
              <p className="text-xs text-brand-grey mt-1">
                Contact: <span className="font-bold text-brand-dark">{o.customerMobile}</span>
              </p>
            )}
            {(o.riderName || o.acceptedAt || o.deliveryStatus) && (
              <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-brand-grey">
                {o.riderName && (
                  <span className="flex items-center gap-1">
                    <Bike className="w-3 h-3 text-brand-orange" /> Rider:{' '}
                    <span className="font-bold text-brand-dark">{o.riderName}</span>
                  </span>
                )}
                {o.acceptedAt && (
                  <span>
                    Accepted{' '}
                    <span className="font-bold text-brand-dark">
                      {new Date(o.acceptedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                )}
                {o.deliveryStatus && (
                  <Badge tone={o.deliveryStatus === 'delivered' ? 'green' : 'blue'}>
                    {DELIVERY_STATUS_LABEL[o.deliveryStatus] || o.deliveryStatus}
                  </Badge>
                )}
              </div>
            )}

            {/* STC Pay screenshot review — thumbnail, full-size lightbox, and
                Pending / Verified / Rejected badge next to it. */}
            {o.paymentMethod === 'stcpay' && (o.proofUrl || o.proofPath || o.paymentReference) && (
              <div className="mt-2 flex items-center gap-3 p-2.5 rounded-xl border border-brand-border bg-brand-surface/60">
                {o.proofUrl ? (
                  <button
                    type="button"
                    onClick={() => setProofView(o.proofUrl)}
                    className="shrink-0 cursor-pointer rounded-lg overflow-hidden border border-brand-border hover:ring-2 hover:ring-brand-orange/50 transition-shadow"
                    title="View full size"
                  >
                    <img src={o.proofUrl} alt="STC Pay payment screenshot" className="w-14 h-14 object-cover" />
                  </button>
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-white border border-brand-border flex items-center justify-center shrink-0">
                    <ImageIcon className="w-5 h-5 text-brand-grey/50" />
                  </div>
                )}
                <div className="min-w-0 text-xs">
                  <p className="font-bold text-brand-dark flex items-center gap-1.5 flex-wrap">
                    STC Pay screenshot
                    {(() => {
                      const review = proofReviewMeta(o.paymentStatus);
                      return <Badge tone={review.tone}>{review.label}</Badge>;
                    })()}
                  </p>
                  {o.paymentReference && <p className="text-brand-grey truncate">Ref: {o.paymentReference}</p>}
                  <p className="text-brand-grey">
                    {o.proofUrl ? 'Click the image to view it full size.' : 'No screenshot uploaded yet.'}
                  </p>
                </div>
              </div>
            )}
            {refundable && (
              <p className="text-xs font-bold text-amber-700 mt-2">
                Refund due — process it within a few hours (max one day), then mark refunded.
              </p>
            )}

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {o.paymentStatus === 'awaiting' && (
                <>
                  <button type="button" disabled={busy}
                    onClick={() => run(o.orderCode, () => api.adminFoodVerifyPayment(o.orderCode))}
                    className={btnPrimary + ' !py-2.5 !px-3.5 !text-xs justify-center w-full'}>
                    <Check className="w-3.5 h-3.5" /> Approve payment
                  </button>
                  <button type="button" disabled={busy}
                    onClick={() => {
                      const reason = window.prompt('Reason for rejecting this payment?');
                      if (!reason) return;
                      run(o.orderCode, () => api.adminFoodRejectPayment(o.orderCode, reason));
                    }}
                    className={btnGhost + ' !py-2.5 !px-3.5 !text-xs justify-center w-full !text-red-600 !border-red-200'}>
                    <X className="w-3.5 h-3.5" /> Reject payment
                  </button>
                </>
              )}

              {/* Restaurant-side ops (admins run the restaurants) */}
              {o.status === 'pending' && (
                <>
                  <button type="button" disabled={busy}
                    onClick={() => run(o.orderCode, () => api.adminFoodAcceptOrder(o.orderCode))}
                    className={btnPrimary + ' !py-2.5 !px-3.5 !text-xs justify-center w-full'}
                    title="Charges the order margin to the restaurant credit (blocked at 300 SAR)">
                    <Check className="w-3.5 h-3.5" /> Accept order
                  </button>
                  <button type="button" disabled={busy}
                    onClick={() => {
                      const reason = window.prompt('Reason for rejecting this order? (optional)');
                      if (reason === null) return;
                      run(o.orderCode, () => api.adminFoodRejectOrder(o.orderCode, reason || undefined));
                    }}
                    className={btnGhost + ' !py-2.5 !px-3.5 !text-xs justify-center w-full !text-red-600 !border-red-200'}>
                    <X className="w-3.5 h-3.5" /> Reject order
                  </button>
                </>
              )}
              {next && (
                <button type="button" disabled={busy}
                  onClick={() => run(o.orderCode, () => api.adminFoodOrderStatus(o.orderCode, next.status))}
                  className={btnGhost + ' !py-2.5 !px-3.5 !text-xs justify-center w-full'}>
                  {next.label} <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}

              {canAssignRider && assigning !== o.orderCode && (
                <button type="button" onClick={() => { setAssigning(o.orderCode); setDriverId(''); }}
                  className={btnGhost + ' !py-2.5 !px-3.5 !text-xs justify-center w-full'}>
                  <Bike className="w-3.5 h-3.5" /> {o.riderName ? 'Change rider' : 'Assign rider'}
                </button>
              )}

              {(o.hasPickupPhoto || o.hasDeliveryPhoto) && (
                <button type="button" disabled={busy}
                  onClick={() => run(o.orderCode, async () => {
                    const photos = await api.adminFoodOrderPhotos(o.orderCode);
                    if (photos.pickup) window.open(photos.pickup, '_blank', 'noopener');
                    if (photos.delivery) window.open(photos.delivery, '_blank', 'noopener');
                  })}
                  className={btnGhost + ' !py-2.5 !px-3.5 !text-xs justify-center w-full'}>
                  View proof photos
                </button>
              )}

              {cancellable && (
                <button type="button" disabled={busy}
                  onClick={() => {
                    const reason = window.prompt('Cancel this order? Reason (optional):');
                    if (reason === null) return;
                    run(o.orderCode, () => api.adminFoodCancelOrder(o.orderCode, reason || undefined));
                  }}
                  className={btnGhost + ' !py-2.5 !px-3.5 !text-xs justify-center w-full !text-red-600 !border-red-200'}>
                  Cancel order
                </button>
              )}
              {refundable && (
                <button type="button" disabled={busy}
                  onClick={() => {
                    if (window.confirm('Confirm the money was returned to the customer?')) {
                      run(o.orderCode, () => api.adminFoodRefund(o.orderCode));
                    }
                  }}
                  className={btnPrimary + ' !py-2.5 !px-3.5 !text-xs justify-center w-full'}>
                  Mark refunded
                </button>
              )}
              {busy && <Spinner className="!w-4 !h-4" />}
            </div>

            {assigning === o.orderCode && (
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={inputClass + ' flex-1 min-w-0 !py-2'}>
                  <option value="">Choose an approved driver</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.full_name || d.email}</option>
                  ))}
                </select>
                <button type="button" disabled={!driverId || busy}
                  onClick={() => run(o.orderCode, async () => {
                    await api.adminFoodAssignDriver(o.orderCode, driverId);
                    setAssigning(null);
                  })}
                  className={btnPrimary + ' !py-2 !px-3.5 !text-xs'}>
                  Assign
                </button>
                <button type="button" onClick={() => setAssigning(null)} className={btnGhost + ' !py-2 !px-3.5 !text-xs'}>
                  Cancel
                </button>
                {drivers.length === 0 && (
                  <p className="text-xs text-brand-grey w-full">
                    No approved drivers yet — riders are normally offered the job automatically; this is the manual fallback.
                  </p>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {proofView && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
          onClick={() => setProofView(null)}
        >
          <button
            type="button"
            onClick={() => setProofView(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={proofView}
            alt="STC Pay payment screenshot (full size)"
            className="max-w-full max-h-full rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// --- Settlement section ----------------------------------------------------
// Per-restaurant payout vs. our markup over a date range, split by who
// collected the money. Downloads a CSV (reuses the shared csv.js helpers).
function isoDay(d) {
  return d.toISOString().slice(0, 10);
}
function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: isoDay(from), to: isoDay(to) };
}

const SETTLEMENT_COLUMNS = [
  'order_code', 'date', 'merchant', 'subtotal', 'restaurant_payout', 'platform_markup',
  'delivery_charge', 'vat', 'total', 'payment_method', 'payment_status', 'collected_by',
].map((k) => ({ key: k, header: k }));

function toCsvRows(rows) {
  return (rows || []).map((r) => ({
    order_code: r.orderCode,
    date: r.date ? new Date(r.date).toISOString().slice(0, 10) : '',
    merchant: r.merchant,
    subtotal: r.subtotal,
    restaurant_payout: r.restaurantPayout,
    platform_markup: r.platformMarkup,
    delivery_charge: r.deliveryFee,
    vat: r.vat,
    total: r.total,
    payment_method: r.paymentMethod,
    payment_status: r.paymentStatus,
    collected_by: r.collectedBy,
  }));
}

function SettlementSection({ onError }) {
  const def = defaultRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function loadReport() {
    setLoading(true);
    try {
      const d = await api.adminFoodSettlement(from, to);
      setData(d);
      return d;
    } catch (err) {
      onError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function download() {
    const d = data || (await loadReport());
    if (!d) return;
    if (!d.rows || d.rows.length === 0) {
      onError('No orders in that date range to export.');
      return;
    }
    const csv = toCsv(toCsvRows(d.rows), SETTLEMENT_COLUMNS);
    downloadCsv(`smartmappia-settlement-${d.from}_${d.to}.csv`, csv);
  }

  const t = data?.totals;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Coins className="w-4 h-4 text-brand-orange" />
        <p className="font-black text-brand-black">Settlement</p>
      </div>
      <p className="text-xs text-brand-grey">
        What we owe each restaurant (their net payout) vs. the markup we keep, over a date range.
        Online orders are collected by us — we owe the restaurant; cash orders are collected by the rider.
        Only paid orders count; refunds are shown separately.
      </p>
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
        <div className="w-full sm:w-56 min-w-0">
          <Field label="From">
            <DatePicker
              value={from}
              onChange={(v) => { setFrom(v); setData(null); }}
              max={to || undefined}
              drawerTitle="From date"
            />
          </Field>
        </div>
        <div className="w-full sm:w-56 min-w-0">
          <Field label="To">
            <DatePicker
              value={to}
              onChange={(v) => { setTo(v); setData(null); }}
              min={from || undefined}
              drawerTitle="To date"
            />
          </Field>
        </div>
        <button type="button" onClick={loadReport} disabled={loading} className={btnGhost + ' !py-2.5 !px-3.5 !text-sm w-full sm:w-auto'}>
          {loading ? <Spinner className="!w-4 !h-4" /> : 'Preview'}
        </button>
        <button type="button" onClick={download} disabled={loading} className={btnPrimary + ' !py-2.5 !px-3.5 !text-sm w-full sm:w-auto sm:ml-auto'}>
          <Download className="w-3.5 h-3.5" /> Download CSV
        </button>
      </div>

      {t && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat label="Orders" value={t.orders} />
            <Stat label="Owe restaurants (online)" value={fmtSAR(t.onlineOwedToRestaurant)} />
            <Stat label="Markup (online)" value={fmtSAR(t.onlineMarkupKept)} accent />
            <Stat label="Cash collected (rider)" value={fmtSAR(t.cashCollectedByRider)} />
            <Stat label="Markup (cash)" value={fmtSAR(t.cashMarkup)} accent />
            <Stat label="Refunded" value={fmtSAR(t.refundedAmount)} />
          </div>

          {(data.byMerchant || []).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-brand-grey border-b border-brand-border">
                    <th className="py-2 pr-3 font-bold">Restaurant</th>
                    <th className="py-2 px-2 font-bold text-right">Orders</th>
                    <th className="py-2 px-2 font-bold text-right">Owe (online)</th>
                    <th className="py-2 px-2 font-bold text-right">Markup (online)</th>
                    <th className="py-2 px-2 font-bold text-right">Cash (rider)</th>
                    <th className="py-2 pl-2 font-bold text-right">Markup (cash)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byMerchant.map((m) => (
                    <tr key={m.merchantId || m.merchant} className="border-b border-brand-border/50">
                      <td className="py-2 pr-3 font-bold text-brand-dark">{m.merchant || 'Unknown'}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{m.orders}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtSAR(m.onlineOwedToRestaurant)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-green-700 font-bold">{fmtSAR(m.onlineMarkupKept)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtSAR(m.cashCollectedByRider)}</td>
                      <td className="py-2 pl-2 text-right tabular-nums text-green-700 font-bold">{fmtSAR(m.cashMarkup)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// --- Refunds owed ---------------------------------------------------------
// Cancelled or rejected orders that are still marked paid. Nothing here
// discovers anything the Orders panel could not — the point is that it cannot
// be MISSED. A refund only moves when someone presses the button, so it needs
// a list of its own rather than living inside a 200-row order feed.
function RefundsSection({ onError }) {
  const [refunds, setRefunds] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      setRefunds((await api.adminFoodRefunds()).refunds || []);
    } catch (err) {
      onError(err.message);
      setRefunds([]);
    }
  }, [onError]);

  // Deferred past the first paint rather than called in the effect body, the
  // same way ShopAdmin's loader does it — the sections above predate that and
  // still trip react-hooks/set-state-in-effect.
  useEffect(() => {
    const id = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function refund(code) {
    if (!window.confirm(`Mark ${code} refunded? Do this once the money has actually been returned.`)) {
      return;
    }
    setBusy(code);
    try {
      await api.adminFoodRefund(code);
      notifySuccess(`${code} marked refunded`);
      await load();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (refunds === null) {
    return <div className="flex justify-center py-8"><Spinner className="!w-7 !h-7" /></div>;
  }

  return (
    <Card className="p-4">
      <p className="font-black text-brand-black flex items-center gap-2 mb-3">
        <Undo2 className="w-4 h-4 text-brand-orange" /> Refunds owed ({refunds.length})
      </p>
      {refunds.length === 0 ? (
        <p className="text-sm text-brand-grey">
          Nothing owed. Paid orders that get cancelled or rejected appear here until the money is
          returned.
        </p>
      ) : (
        <div className="divide-y divide-brand-border">
          {refunds.map((r) => (
            <div key={r.orderCode} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono font-bold text-brand-dark text-sm">{r.orderCode}</p>
                <p className="text-xs text-brand-grey truncate">
                  {r.merchant || 'Restaurant'} ·{' '}
                  {r.status === 'rejected' ? 'Rejected' : 'Cancelled'}
                  {r.cancelledBy === 'merchant' ? ' by the restaurant' : ''}
                  {r.cancelledAt ? ` · ${new Date(r.cancelledAt).toLocaleString()}` : ''}
                </p>
                {r.reason && <p className="text-xs text-brand-grey mt-0.5">{r.reason}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-black text-brand-orange tabular-nums">{fmtSAR(r.total)}</p>
                <button
                  type="button"
                  disabled={busy === r.orderCode}
                  onClick={() => refund(r.orderCode)}
                  className={btnGhost + ' !py-1.5 !px-2.5 !text-xs mt-1'}
                >
                  <Undo2 className="w-3.5 h-3.5" /> Mark refunded
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// --- Tab root ------------------------------------------------------------------
export default function FoodAdmin() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [section, setSection] = useState('restaurants');
  const onError = useCallback((msg) => setError(msg), []);

  useEffect(() => {
    api.adminFoodOverview().then(setOverview).catch((e) => setError(e.message));
  }, []);

  const sections = [
    { id: 'restaurants', label: 'Restaurants', icon: Store },
    { id: 'orders', label: 'Orders', icon: ClipboardList },
    { id: 'refunds', label: 'Refunds', icon: Undo2 },
    { id: 'settlement', label: 'Payouts', icon: Coins },
  ];

  return (
    <div className="space-y-4 sm:space-y-5 min-w-0">
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center justify-between gap-3">
          <span className="min-w-0">{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}

      {!overview ? (
        <div className="flex justify-center py-8"><Spinner className="!w-7 !h-7" /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <Stat label="Orders today" value={overview.todayOrders} icon={ClipboardList} hint="Placed since midnight" />
          <Stat label="Total orders" value={overview.totalOrders} icon={Receipt} />
          <Stat label="Platform revenue" value={fmtSAR(overview.revenue)} accent icon={Banknote} />
          <Stat
            label="Restaurants"
            value={overview.merchants}
            icon={Store}
            onClick={() => setSection('restaurants')}
          />
          <Stat label="Suspended" value={overview.suspendedMerchants} icon={ShieldX} hint="Cannot take orders" />
          <Stat
            label="Payments to verify"
            value={overview.paymentsAwaitingReview}
            accent
            icon={Wallet}
            hint="STC Pay screenshots"
            onClick={() => setSection('orders')}
          />
          <Stat
            label="Refunds owed"
            value={overview.refundsOwed ?? 0}
            accent
            icon={Undo2}
            hint="Paid, then cancelled"
            onClick={() => setSection('refunds')}
          />
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto overscroll-x-contain snap-x snap-mandatory pb-1 -mx-3 px-3 sm:-mx-5 sm:px-5 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8 xl:mx-0 xl:px-0 no-scrollbar">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`snap-start shrink-0 inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-bold border cursor-pointer ${
              section === id
                ? 'bg-brand-orange text-white border-brand-orange'
                : 'bg-white text-brand-grey border-brand-border hover:text-brand-dark'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {section === 'restaurants' && <MerchantsSection onError={onError} />}
      {section === 'orders' && <OrdersSection onError={onError} />}
      {section === 'refunds' && <RefundsSection onError={onError} />}
      {section === 'settlement' && <SettlementSection onError={onError} />}
    </div>
  );
}
