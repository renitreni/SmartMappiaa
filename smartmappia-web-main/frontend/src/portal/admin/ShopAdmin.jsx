// ---------------------------------------------------------------------
// Admin — the Ecommerce (shop) vertical. Mirrors FoodAdmin.jsx.
//
// This is the ONLY screen in the whole app with a net_price field. The
// store's own portal has no such input and the API rejects it, so the
// markup is set here or nowhere.
// ---------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Store,
  Package,
  ClipboardList,
  Boxes,
  Receipt,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  UserPlus,
  RefreshCw,
  Download,
  Clock,
  Search,
  Eye,
  EyeOff,
  ShieldX,
  ShieldCheck,
  Wallet,
  Banknote,
  Inbox,
  Sparkles,
  UserCheck,
  Undo2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useBroadcast } from '../lib/useBroadcast';
import { formatAddressDetail } from '../lib/address';
import {
  fmtSAR,
  shopStatusMeta,
  shopPaymentMeta,
  SHOP_PAYMENT_METHODS,
  TONE_CLASSES,
} from '../lib/constants';
import { notifySuccess, notifyError, confirmAction } from '../lib/notify';
import { toCsv, downloadCsv } from '../lib/csv';
import { Card, Field, Spinner, inputClass, btnPrimary, btnGhost } from '../components/ui';
import PasswordInput from '../components/PasswordInput';
import ImageUploadField from '../components/ImageUploadField';
import StoreHoursEditor from '../components/StoreHoursEditor';
import CustomDropdown from '../../components/CustomDropdown';
import DatePicker from '../../components/DatePicker';
import MerchantForm from './MerchantForm';

// Owner passwords are chosen by the admin and handed over in person — keep this
// in step with MIN_PASSWORD_LENGTH in backend/lib/validate.js.
const MIN_OWNER_PASSWORD = 8;

const SECTIONS = [
  { id: 'stores', label: 'Stores', icon: Store },
  { id: 'catalogue', label: 'Catalogue', icon: Package },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'refunds', label: 'Refunds', icon: Undo2 },
  { id: 'settlement', label: 'Settlement', icon: Receipt },
];

function Stat({ label, value, tone, icon: Icon, hint, onClick }) {
  const inner = (
    <>
      {Icon && (
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 ${
          tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-brand-muted text-brand-dark'
        }`}>
          <Icon className="w-4 h-4" />
        </span>
      )}
      <p className="text-[11px] font-bold text-brand-grey uppercase tracking-wider">{label}</p>
      <p className={`text-lg sm:text-xl font-black tabular-nums mt-1 break-words ${tone === 'red' ? 'text-red-600' : 'text-brand-black'}`}>
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

function Pill({ tone, children }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

// The live markup readout beside the two price inputs. Mirrors FoodAdmin's
// markupHint so both verticals explain the money the same way.
function markupHint(price, netPrice) {
  const p = Number(price);
  const n = Number(netPrice);
  if (netPrice === '' || netPrice == null) {
    return { text: `No net price — the flat fallback margin applies.`, tone: 'muted' };
  }
  if (!Number.isFinite(p) || !Number.isFinite(n)) return { text: '', tone: 'muted' };
  if (n <= 0) return { text: 'Net price must be greater than zero.', tone: 'error' };
  if (n > p) return { text: 'Net price cannot exceed the list price.', tone: 'error' };
  return { text: `Our markup: ${fmtSAR(p - n)} per unit.`, tone: 'ok' };
}

// --- Stores -----------------------------------------------------------
function StoresSection({ stores, failed, onChanged, onOpenCatalogue }) {
  // null | 'new' | store — same shape FoodAdmin uses, so the shared form is
  // driven identically on both screens.
  const [editing, setEditing] = useState(null);
  const [hoursFor, setHoursFor] = useState(null);
  const [ownerFor, setOwnerFor] = useState(null);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [pwFor, setPwFor] = useState(null); // store whose owner password is being re-issued
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.cuisine_type?.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q)
    );
  }, [stores, search]);

  async function save(payload) {
    setBusy(true);
    try {
      if (editing === 'new') await api.adminShopCreateStore(payload);
      else await api.adminShopUpdateStore(editing.id, payload);
      notifySuccess(editing === 'new' ? 'Store created (unlisted)' : 'Store updated');
      setEditing(null);
      onChanged();
    } catch {
      /* surfaced */
    } finally {
      setBusy(false);
    }
  }

  async function toggleListed(s) {
    try {
      await api.adminShopUpdateStore(s.id, { is_active: !s.is_active });
      onChanged();
    } catch {
      /* surfaced */
    }
  }

  // The admin chooses the owner's password and hands it over at contract
  // signing — the platform sends no mail, so there is no reset link to fall
  // back on. resetOwnerPassword below is the recovery path.
  async function linkOwner(e) {
    e.preventDefault();
    if (ownerPassword.length < MIN_OWNER_PASSWORD) {
      notifyError(`Password must be at least ${MIN_OWNER_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      const res = await api.adminShopSetOwner(ownerFor, {
        email: ownerEmail.trim(),
        password: ownerPassword,
      });
      notifySuccess(
        res.reusedExistingAccount
          ? 'Existing account linked as the store owner, with the password you set.'
          : 'Owner account created. Give the owner their email and password.'
      );
      setOwnerFor(null);
      setOwnerEmail('');
      setOwnerPassword('');
      onChanged();
    } catch {
      /* surfaced */
    } finally {
      setBusy(false);
    }
  }

  async function resetOwnerPassword(e) {
    e.preventDefault();
    if (newPassword.length < MIN_OWNER_PASSWORD) {
      notifyError(`Password must be at least ${MIN_OWNER_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      await api.adminShopSetOwnerPassword(pwFor, { password: newPassword });
      notifySuccess('Owner password updated. Give the new one to the owner.');
      setPwFor(null);
      setNewPassword('');
    } catch {
      /* surfaced */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-grey" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search stores…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-brand-border bg-white text-sm focus:outline-none focus:border-brand-orange"
          />
        </div>
        <button
          type="button"
          onClick={() => setEditing((v) => (v ? null : 'new'))}
          className={btnPrimary + ' w-full sm:w-auto justify-center'}
        >
          {editing ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {editing ? 'Close' : 'Add store'}
        </button>
      </div>

      {editing && (
        <Card className="p-5">
          <p className="font-black text-brand-black mb-4">
            {editing === 'new' ? 'Add store' : `Edit: ${editing.name}`}
          </p>
          <MerchantForm
            noun="Store"
            categoryLabel="Category"
            categoryPlaceholder="e.g. Groceries, Household"
            initial={
              editing === 'new'
                ? undefined
                : {
                    name: editing.name,
                    cuisine_type: editing.cuisine_type,
                    description: editing.description,
                    address: editing.address,
                    street: editing.street || '',
                    building_number: editing.building_number || '',
                    logo_url: editing.logo_url,
                    lat: editing.lat,
                    lng: editing.lng,
                    is_active: editing.is_active,
                    is_featured: editing.is_featured,
                    badge: editing.badge || '',
                  }
            }
            busy={busy}
            renderLogo={(value, onChange) => (
              <ImageUploadField
                kind="logo"
                value={value}
                onChange={onChange}
                ready={editing !== 'new'}
                notReadyHint="Save the store first, then edit it to upload a logo."
                getSignedUrl={(body) => api.adminShopStoreImageSignedUrl(editing.id, body)}
              />
            )}
            onCancel={() => setEditing(null)}
            onSave={save}
          />
          <p className="text-xs text-brand-grey mt-3">
            New stores start unlisted. Import the catalogue and set the net prices, then list it.
          </p>
        </Card>
      )}

      {failed ? (
        // Distinct from "no stores yet". Rendering the empty card for a failed
        // request is what made a broken store list look like an empty one.
        <Card className="overflow-hidden">
          <div className="flex flex-col items-center justify-center text-center px-5 py-12">
            <div className="w-14 h-14 rounded-2xl bg-brand-warm text-brand-orange flex items-center justify-center mb-4">
              <Store className="w-6 h-6" />
            </div>
            <p className="font-black text-brand-black">Stores could not be loaded</p>
            <p className="text-sm text-brand-grey mt-1.5 max-w-xs">
              The request failed — this is not an empty catalogue. Try again in a moment.
            </p>
            <button onClick={onChanged} className={btnGhost + ' mt-4 inline-flex'}>
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          </div>
        </Card>
      ) : visible.length === 0 ? (
        <Card className="overflow-hidden">
          <div className="flex flex-col items-center justify-center text-center px-5 py-12">
            <div className="w-14 h-14 rounded-2xl bg-brand-warm text-brand-orange flex items-center justify-center mb-4">
              {search.trim() ? <Search className="w-6 h-6" /> : <Store className="w-6 h-6" />}
            </div>
            <p className="font-black text-brand-black">{search.trim() ? 'No matches' : 'No stores yet'}</p>
            <p className="text-sm text-brand-grey mt-1.5 max-w-xs">
              {search.trim()
                ? `Nothing matches “${search.trim()}”.`
                : 'Add a partner store, import its catalogue, then list it for customers.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((s) => {
            const credit = s.credit || {};
            return (
              <Card key={s.id} className="p-4 min-w-0">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 shrink-0 rounded-lg bg-brand-surface overflow-hidden flex items-center justify-center">
                    {s.logo_url ? <img src={s.logo_url} alt="" className="w-full h-full object-cover" /> : <Store className="w-5 h-5 text-brand-grey/40" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-brand-black truncate">{s.name}</p>
                    <p className="text-xs text-brand-grey">{s.cuisine_type || 'No category'}</p>
                    {/* Where riders actually go. FoodAdmin has always shown
                        this; without it an admin could not tell a pinned
                        store from an unpinned one without opening the form. */}
                    <p className="text-xs text-brand-grey truncate">
                      {formatAddressDetail({
                        street: s.street,
                        building: s.building_number,
                        address: s.address,
                      }) || 'No address'}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Pill tone={s.is_active ? 'green' : 'grey'}>{s.is_active ? 'Listed' : 'Unlisted'}</Pill>
                      {s.status === 'suspended' && <Pill tone="red">Suspended</Pill>}
                      {/* Closed is not Unlisted: still on the storefront, just
                          not taking orders. Only the manual switch is visible
                          here — the schedule is per-store, behind Hours. */}
                      {s.accepting_orders === false && <Pill tone="amber">Closed now</Pill>}
                      {!s.logo_url && <Pill tone="amber">No logo</Pill>}
                      {(s.lat == null || s.lng == null) && <Pill tone="red">No map pin</Pill>}
                      {s.ownerEmail ? (
                        <Pill tone="blue">
                          <span className="max-w-[11rem] truncate inline-block align-bottom">{s.ownerEmail}</span>
                        </Pill>
                      ) : (
                        <Pill tone="amber">No owner</Pill>
                      )}
                    </div>
                    <div className="mt-3">
                      <div className="h-2 rounded-full bg-brand-surface overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            (credit.creditUsed / (credit.creditLimit || 1)) >= 1 ? 'bg-red-500'
                              : (credit.creditUsed / (credit.creditLimit || 1)) >= 0.8 ? 'bg-amber-500' : 'bg-brand-orange'
                          }`}
                          style={{ width: `${Math.min(100, Math.round(((credit.creditUsed || 0) / (credit.creditLimit || 1)) * 100))}%` }}
                        />
                      </div>
                      <p className="text-xs text-brand-grey mt-1.5 tabular-nums">
                        Credit used {fmtSAR(credit.creditUsed)} of {fmtSAR(credit.creditLimit)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  <button type="button" onClick={() => onOpenCatalogue(s)} className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}>
                    <Package className="w-4 h-4" /> Catalogue
                  </button>
                  <button type="button" onClick={() => toggleListed(s)} className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}>
                    {s.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    {s.is_active ? 'Unlist' : 'List'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHoursFor(hoursFor === s.id ? null : s.id)}
                    className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}
                  >
                    <Clock className="w-4 h-4" /> Hours
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(s)}
                    className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}
                  >
                    <Pencil className="w-4 h-4" /> Edit
                  </button>
                  {!s.ownerEmail ? (
                    <button
                      type="button"
                      onClick={() => { setOwnerFor(s.id); setOwnerEmail(''); setOwnerPassword(''); }}
                      className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}
                    >
                      <UserPlus className="w-4 h-4" /> Assign
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setPwFor(pwFor === s.id ? null : s.id); setNewPassword(''); }}
                      className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}
                      title={`Owner: ${s.ownerEmail}`}
                    >
                      <UserCheck className="w-4 h-4" /> Owner
                    </button>
                  )}
                  {s.status === 'suspended' ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await api.adminShopReactivate(s.id);
                        onChanged();
                      }}
                      className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center !text-green-700 !border-green-200'}
                    >
                      <ShieldCheck className="w-4 h-4" /> Reactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!(await confirmAction(`Suspend ${s.name}?`, 'It will stop accepting orders.'))) return;
                        await api.adminShopSuspend(s.id, null);
                        onChanged();
                      }}
                      className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center !text-red-600 !border-red-200'}
                    >
                      <ShieldX className="w-4 h-4" /> Suspend
                    </button>
                  )}
                  {credit.creditUsed > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!(await confirmAction(`Reconcile ${fmtSAR(credit.creditUsed)}?`, 'Records that the store has settled.'))) return;
                        await api.adminShopCredit(s.id, { amount: credit.creditUsed, note: 'Admin reconciliation' });
                        onChanged();
                      }}
                      className={btnGhost + ' !py-2.5 !px-2 !text-xs justify-center'}
                    >
                      <Wallet className="w-4 h-4" /> Reconcile
                    </button>
                  )}
                </div>

                {hoursFor === s.id && (
                  <div className="mt-3 pt-3 border-t border-brand-border overflow-x-auto min-w-0">
                    <StoreHoursEditor
                      load={() => api.adminShopHours(s.id)}
                      save={(hours) => api.adminShopSetHours(s.id, hours)}
                      setAccepting={async (accepting) => {
                        await api.adminShopSetAccepting(s.id, accepting);
                        onChanged(); // refresh the "Closed now" pill above
                      }}
                    />
                  </div>
                )}

                {ownerFor === s.id && (
                  <form onSubmit={linkOwner} className="mt-3 pt-3 border-t border-brand-border space-y-2">
                    <input
                      type="email"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      placeholder="owner@example.com"
                      required
                      className={inputClass + ' w-full'}
                    />
                    <PasswordInput
                      required
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder={`Owner password (min ${MIN_OWNER_PASSWORD} characters)`}
                    />
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button disabled={busy} className={btnPrimary + ' w-full sm:w-auto justify-center'}>Link</button>
                      <button type="button" onClick={() => setOwnerFor(null)} className={btnGhost + ' w-full sm:w-auto justify-center'}>Cancel</button>
                    </div>
                    <p className="text-xs text-brand-grey">
                      Give the owner this password in person — there is no reset email.
                    </p>
                  </form>
                )}

                {pwFor === s.id && (
                  <form onSubmit={resetOwnerPassword} className="mt-3 pt-3 border-t border-brand-border space-y-2">
                    <p className="text-xs font-bold text-brand-dark break-all">Owner account: {s.ownerEmail}</p>
                    <PasswordInput
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder={`New password (min ${MIN_OWNER_PASSWORD} characters)`}
                    />
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button disabled={busy} className={btnPrimary + ' w-full sm:w-auto justify-center'}>Set new password</button>
                      <button type="button" onClick={() => setPwFor(null)} className={btnGhost + ' w-full sm:w-auto justify-center'}>Cancel</button>
                    </div>
                    <p className="text-xs text-brand-grey">
                      Replaces the owner's password immediately. Their old one stops working.
                    </p>
                  </form>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Catalogue (net_price lives here) ---------------------------------
const emptyProduct = {
  name: '', description: '', brand: '', unit: '', category_id: '',
  price: '', net_price: '', image_url: '', stock_quantity: 0,
  low_stock_threshold: 5, track_stock: true, is_available: true,
};

function CatalogueSection({ stores, selectedStore, onSelectStore }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyProduct);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [catName, setCatName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!selectedStore) return;
    setLoading(true);
    try {
      setData(await api.adminShopCatalogue(selectedStore));
    } catch {
      /* surfaced */
    } finally {
      setLoading(false);
    }
  }, [selectedStore]);

  useEffect(() => {
    const id = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const hint = markupHint(form.price, form.net_price);

  async function saveProduct(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        ...form,
        price: Number(form.price),
        net_price: form.net_price === '' ? null : Number(form.net_price),
        stock_quantity: Number(form.stock_quantity),
        low_stock_threshold: Number(form.low_stock_threshold),
        category_id: form.category_id || null,
        description: form.description || null,
        brand: form.brand || null,
        unit: form.unit || null,
        image_url: form.image_url || null,
      };
      if (editingId) await api.adminShopUpdateProduct(editingId, body);
      else await api.adminShopAddProduct(selectedStore, body);
      notifySuccess('Product saved');
      setShowForm(false);
      setEditingId(null);
      setForm(emptyProduct);
      load();
    } catch {
      /* surfaced */
    } finally {
      setBusy(false);
    }
  }

  if (stores.length === 0) {
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center justify-center text-center px-5 py-12">
          <div className="w-14 h-14 rounded-2xl bg-brand-warm text-brand-orange flex items-center justify-center mb-4">
            <Store className="w-6 h-6" />
          </div>
          <p className="font-black text-brand-black">Add a store first</p>
          <p className="text-sm text-brand-grey mt-1.5 max-w-xs">Catalogue and net prices live on a store. Create one, then come back here.</p>
        </div>
      </Card>
    );
  }

  if (!selectedStore) {
    return (
      <Card className="p-5">
        <Field label="Choose a store">
          <CustomDropdown
            value=""
            onChange={onSelectStore}
            options={stores.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="Select a store…"
            drawerTitle="Choose a store"
            className="w-full"
          />
        </Field>
      </Card>
    );
  }

  return (
    <div className="space-y-4 min-w-0">
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <CustomDropdown
            value={selectedStore}
            onChange={onSelectStore}
            options={stores.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="Select a store…"
            drawerTitle="Choose a store"
            className="flex-1 min-w-0 w-full"
          />
          <button type="button" onClick={load} className={btnGhost + ' !py-2.5 justify-center w-full sm:w-auto'}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <p className="font-black text-brand-black mb-3">Categories</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!catName.trim()) return;
            await api.adminShopAddCategory(selectedStore, { name: catName.trim(), sort_order: (data?.categories || []).length });
            setCatName('');
            load();
          }}
          className="flex flex-col sm:flex-row gap-2 mb-3"
        >
          <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="New category" className={inputClass + ' flex-1 min-w-0'} />
          <button className={btnPrimary + ' justify-center w-full sm:w-auto'}><Plus className="w-4 h-4" /> Add</button>
        </form>
        {(data?.categories || []).length === 0 ? (
          <p className="text-sm text-brand-grey">No categories yet — add one so products can be grouped.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(data?.categories || []).map((c) => (
              <span key={c.id} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-surface text-sm font-medium max-w-full">
                <span className="truncate">{c.name}</span>
                <button
                  type="button"
                  onClick={async () => {
                    if (!(await confirmAction(`Delete "${c.name}"?`))) return;
                    await api.adminShopDeleteCategory(c.id);
                    load();
                  }}
                  className="text-brand-grey hover:text-red-600 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <p className="font-black text-brand-black flex-1">Products</p>
          <button
            type="button"
            onClick={() => {
              setForm(emptyProduct);
              setEditingId(null);
              setShowForm((v) => !v);
            }}
            className={btnPrimary + ' !py-2.5 !px-3 text-sm justify-center w-full sm:w-auto'}
          >
            {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showForm ? 'Close' : 'Add product'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={saveProduct} className="mb-5 p-4 rounded-xl bg-brand-warm border border-brand-border space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputClass} />
              </Field>
              <Field label="Category">
                <CustomDropdown
                  value={form.category_id || ''}
                  onChange={(v) => setForm({ ...form, category_id: v })}
                  options={[
                    { value: '', label: 'Uncategorised' },
                    ...(data?.categories || []).map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  placeholder="Uncategorised"
                  drawerTitle="Category"
                  className="w-full"
                />
              </Field>
              <Field label="Brand">
                <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Unit">
                <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="1 kg" className={inputClass} />
              </Field>

              {/* THE markup control. */}
              <Field label="List price (SAR) — shown to the customer">
                <input type="number" step="0.01" min="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required className={inputClass} />
              </Field>
              <Field label="Net price (SAR) — what the store keeps">
                <input type="number" step="0.01" min="0.01" value={form.net_price} onChange={(e) => setForm({ ...form, net_price: e.target.value })} className={inputClass} />
              </Field>

              <Field label="Stock quantity">
                <input type="number" min="0" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Low-stock warning at">
                <input type="number" min="0" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Product photo">
                <ImageUploadField
                  kind="item"
                  value={form.image_url}
                  onChange={(url) => setForm({ ...form, image_url: url || '' })}
                  getSignedUrl={(body) => api.adminShopStoreImageSignedUrl(selectedStore, body)}
                />
              </Field>
            </div>

            {hint.text && (
              <p className={`text-sm font-bold ${hint.tone === 'error' ? 'text-red-700' : hint.tone === 'ok' ? 'text-green-700' : 'text-brand-grey'}`}>
                {hint.text}
              </p>
            )}

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={form.is_available} onChange={(e) => setForm({ ...form, is_available: e.target.checked })} />
                Available
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={form.track_stock} onChange={(e) => setForm({ ...form, track_stock: e.target.checked })} />
                Track stock
              </label>
            </div>
            <button disabled={busy || hint.tone === 'error'} className={btnPrimary + ' w-full disabled:opacity-50'}>
              {busy ? <Spinner className="!border-white/40 !border-t-white" /> : 'Save product'}
            </button>
          </form>
        )}

        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (data?.products || []).length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-4 py-10">
            <div className="w-14 h-14 rounded-2xl bg-brand-warm text-brand-orange flex items-center justify-center mb-4">
              <Package className="w-6 h-6" />
            </div>
            <p className="font-black text-brand-black">No products yet</p>
            <p className="text-sm text-brand-grey mt-1.5 max-w-xs">Add a product and set its net price so the platform markup is recorded.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(data?.products || []).map((p) => (
              <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-brand-border min-w-0">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-brand-black truncate">{p.name}</p>
                  <p className="text-xs text-brand-grey break-words">
                    List {fmtSAR(p.price)} · Net {p.net_price != null ? fmtSAR(p.net_price) : 'not set'} ·{' '}
                    <span className="font-bold text-brand-dark">
                      markup {p.net_price != null ? fmtSAR(p.price - p.net_price) : 'fallback'}
                    </span>
                  </p>
                  <p className="text-xs text-brand-grey mt-0.5">
                    Stock {p.stock_quantity}
                    {(p.product_variants || []).length > 0 && ` · ${p.product_variants.length} options`}
                    {p.is_available === false && ' · Hidden'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setForm({
                        name: p.name || '', description: p.description || '', brand: p.brand || '',
                        unit: p.unit || '', category_id: p.category_id || '', price: p.price ?? '',
                        net_price: p.net_price ?? '', image_url: p.image_url || '',
                        stock_quantity: p.stock_quantity ?? 0, low_stock_threshold: p.low_stock_threshold ?? 5,
                        track_stock: p.track_stock !== false, is_available: p.is_available !== false,
                      });
                      setEditingId(p.id);
                      setShowForm(true);
                    }}
                    className={btnGhost + ' !py-2.5 !px-3 !text-xs justify-center'}
                  >
                    <Pencil className="w-4 h-4" /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!(await confirmAction(`Delete "${p.name}"?`))) return;
                      await api.adminShopDeleteProduct(p.id);
                      load();
                    }}
                    className={btnGhost + ' !py-2.5 !px-3 !text-xs justify-center !text-red-600 !border-red-200'}
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// --- Orders -----------------------------------------------------------
function OrdersSection({ onChanged }) {
  const [orders, setOrders] = useState(null);
  const [filter, setFilter] = useState('action');
  const [busy, setBusy] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.adminShopOrders();
      setOrders(d.orders || []);
    } catch {
      /* surfaced */
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  useBroadcast('admin-shop', { changed: () => load() });

  const LIVE = ['pending', 'accepted', 'packing', 'ready', 'out_for_delivery'];
  const needsAction = (o) => o.status === 'pending' || o.payment_status === 'awaiting';
  const q = search.trim().toLowerCase();
  const matchesSearch = (o) => {
    if (!q) return true;
    return (
      o.order_code?.toLowerCase().includes(q) ||
      o.merchants?.name?.toLowerCase().includes(q) ||
      o.profiles?.full_name?.toLowerCase().includes(q) ||
      o.contact_phone?.includes(search.trim())
    );
  };
  const actionCount = (orders || []).filter(needsAction).length;
  const liveCount = (orders || []).filter((o) => LIVE.includes(o.status)).length;
  const visible = (orders || []).filter((o) => {
    if (!matchesSearch(o)) return false;
    if (filter === 'action') return needsAction(o);
    if (filter === 'live') return LIVE.includes(o.status);
    return true;
  });

  async function act(code, fn) {
    setBusy(code);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch {
      /* surfaced */
    } finally {
      setBusy(null);
    }
  }

  if (!orders) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <Spinner className="!w-7 !h-7" />
        <p className="text-sm text-brand-grey">Loading orders…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 min-w-0">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="flex gap-2 overflow-x-auto overscroll-x-contain snap-x snap-mandatory pb-1 -mx-3 px-3 sm:-mx-5 sm:px-5 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8 xl:mx-0 xl:px-0 flex-1 no-scrollbar">
          {[
            { id: 'action', label: 'Needs action', short: 'Action', count: actionCount },
            { id: 'live', label: 'Live', short: 'Live', count: liveCount },
            { id: 'all', label: 'All', short: 'All', count: orders.length },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`snap-start shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold border cursor-pointer ${
                filter === f.id ? 'bg-brand-black text-white border-brand-black' : 'bg-white text-brand-grey border-brand-border'
              }`}
            >
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
            placeholder="Code, customer, or store…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-brand-border bg-white text-sm focus:outline-none focus:border-brand-orange"
          />
        </div>
      </div>

      {visible.length === 0 ? (
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
                  : 'Shop orders will show up here as customers place them.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((o) => {
            const status = shopStatusMeta(o.status);
            const payment = shopPaymentMeta(o.payment_status);
            const items = o.shop_order_items || [];
            const customer = o.profiles?.full_name || 'Customer';
            const phone = o.contact_phone || o.profiles?.mobile_number;
            return (
              <Card key={o.order_code} className="p-3 sm:p-4 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-brand-black truncate">{customer}</p>
                    <p className="text-xs text-brand-grey truncate mt-0.5">
                      {o.merchants?.name || 'Store'} · <span className="font-mono font-bold">{o.order_code}</span>
                    </p>
                    {o.created_at && (
                      <p className="text-[11px] text-brand-grey mt-0.5">{new Date(o.created_at).toLocaleString()}</p>
                    )}
                    <p className="text-xs text-brand-grey truncate mt-0.5">
                      {formatAddressDetail({
                        street: o.delivery_street,
                        building: o.delivery_building,
                        address: o.delivery_address,
                      }) || 'No address'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black text-brand-orange tabular-nums text-sm">{fmtSAR(o.total)}</p>
                    <p className="text-[11px] text-brand-grey">markup {fmtSAR(o.platform_margin_total)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Pill tone={status.tone}>{status.label}</Pill>
                  <Pill tone={payment.tone}>{payment.label}</Pill>
                  {o.payment_method === 'cash' && <Pill tone="blue">Cash</Pill>}
                </div>
                {items.length > 0 && (
                  <p className="text-xs text-brand-grey mt-2 leading-relaxed line-clamp-3">
                    {items
                      .map((i) => `${i.quantity} × ${i.name_snapshot}${i.variant_label_snapshot ? ` (${i.variant_label_snapshot})` : ''}`)
                      .join(', ')}
                  </p>
                )}
                {phone && (
                  <p className="text-xs text-brand-grey mt-1">
                    Contact: <span className="font-bold text-brand-dark">{phone}</span>
                  </p>
                )}

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {o.payment_status === 'awaiting' && o.payment_method !== 'cash' && (
                    <>
                      <button
                        type="button"
                        onClick={() => act(o.order_code, () => api.adminShopVerifyPayment(o.order_code, null))}
                        disabled={busy === o.order_code}
                        className={btnPrimary + ' !py-2.5 !px-3 !text-xs justify-center w-full'}
                      >
                        <Check className="w-4 h-4" /> Verify payment
                      </button>
                      <button
                        type="button"
                        onClick={() => act(o.order_code, () => api.adminShopRejectPayment(o.order_code, 'Proof not valid'))}
                        className={btnGhost + ' !py-2.5 !px-3 !text-xs justify-center w-full !text-red-600 !border-red-200'}
                      >
                        <X className="w-4 h-4" /> Reject payment
                      </button>
                    </>
                  )}
                  {o.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => act(o.order_code, () => api.adminShopAcceptOrder(o.order_code))}
                      disabled={busy === o.order_code}
                      className={btnGhost + ' !py-2.5 !px-3 !text-xs justify-center w-full'}
                    >
                      Accept
                    </button>
                  )}
                  {['accepted', 'packing', 'ready', 'out_for_delivery'].includes(o.status) && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = { accepted: 'packing', packing: 'ready', ready: 'out_for_delivery', out_for_delivery: 'delivered' }[o.status];
                        act(o.order_code, () => api.adminShopOrderStatus(o.order_code, next));
                      }}
                      className={btnGhost + ' !py-2.5 !px-3 !text-xs justify-center w-full'}
                    >
                      Advance
                    </button>
                  )}
                  {!['delivered', 'cancelled', 'rejected'].includes(o.status) && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!(await confirmAction(`Cancel ${o.order_code}?`, 'Reserved stock is released.'))) return;
                        act(o.order_code, () => api.adminShopCancelOrder(o.order_code, 'Admin cancelled'));
                      }}
                      className={btnGhost + ' !py-2.5 !px-3 !text-xs justify-center w-full !text-red-600 !border-red-200'}
                    >
                      Cancel
                    </button>
                  )}
                  {o.payment_status === 'paid' && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!(await confirmAction(`Refund ${o.order_code}?`, 'Stock is released back to the store.'))) return;
                        act(o.order_code, () => api.adminShopRefund(o.order_code));
                      }}
                      className={btnGhost + ' !py-2.5 !px-3 !text-xs justify-center w-full'}
                    >
                      Mark refunded
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Inventory --------------------------------------------------------
function InventorySection({ stores }) {
  const [storeId, setStoreId] = useState(stores[0]?.id || '');
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!storeId) {
      setData(null);
      return;
    }
    api.adminShopInventory(storeId).then(setData).catch(() => {});
  }, [storeId]);

  if (stores.length === 0) {
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center justify-center text-center px-5 py-12">
          <div className="w-14 h-14 rounded-2xl bg-brand-warm text-brand-orange flex items-center justify-center mb-4">
            <Boxes className="w-6 h-6" />
          </div>
          <p className="font-black text-brand-black">No stores yet</p>
          <p className="text-sm text-brand-grey mt-1.5 max-w-xs">Add a store before you can check stock levels.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4 min-w-0">
      <Card className="p-4">
        <Field label="Store">
          <CustomDropdown
            value={storeId}
            onChange={setStoreId}
            options={stores.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="Select a store…"
            drawerTitle="Choose a store"
            className="w-full"
          />
        </Field>
      </Card>
      {!storeId ? (
        <Card className="overflow-hidden">
          <div className="flex flex-col items-center justify-center text-center px-5 py-12">
            <div className="w-14 h-14 rounded-2xl bg-brand-warm text-brand-orange flex items-center justify-center mb-4">
              <Boxes className="w-6 h-6" />
            </div>
            <p className="font-black text-brand-black">Choose a store</p>
            <p className="text-sm text-brand-grey mt-1.5 max-w-xs">Low-stock products for that store will show here.</p>
          </div>
        </Card>
      ) : data && (
        <Card className="p-4 sm:p-5">
          <p className="font-black text-brand-black mb-3">
            Low stock ({data.lowStock.length})
          </p>
          <p className="text-xs text-brand-grey mb-3">Products at or below their per-item warning line.</p>
          {data.lowStock.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center px-4 py-8">
              <div className="w-14 h-14 rounded-2xl bg-brand-warm text-brand-orange flex items-center justify-center mb-4">
                <Sparkles className="w-6 h-6" />
              </div>
              <p className="font-black text-brand-black">Stock looks healthy</p>
              <p className="text-sm text-brand-grey mt-1.5">Everything is above its low-stock line.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.lowStock.map((p) => (
                <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-xl border border-brand-border min-w-0">
                  <span className="font-bold text-brand-black truncate flex-1 min-w-0">{p.name}</span>
                  <Pill tone={p.stock_quantity <= 0 ? 'red' : 'amber'}>
                    {p.stock_quantity} left (warn at {p.low_stock_threshold})
                  </Pill>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// --- Settlement -------------------------------------------------------
const SETTLEMENT_COLUMNS = [
  { key: 'orderCode', header: 'order_code' },
  { key: 'date', header: 'date' },
  { key: 'store', header: 'store' },
  { key: 'subtotal', header: 'subtotal' },
  { key: 'storePayout', header: 'store_payout' },
  { key: 'platformMarkup', header: 'platform_markup' },
  { key: 'deliveryCharge', header: 'delivery_charge' },
  { key: 'vat', header: 'vat' },
  { key: 'total', header: 'total' },
  { key: 'paymentMethod', header: 'payment_method' },
  { key: 'paymentStatus', header: 'payment_status' },
  { key: 'collectedBy', header: 'collected_by' },
];

// --- Refunds owed -----------------------------------------------------
// Cancelled or rejected orders that are still marked paid. Nothing here
// discovers anything the Orders tab could not — the point is that it cannot
// be MISSED. A refund only moves when someone presses the button, so it needs
// a list of its own rather than living inside a 200-row order feed.
function RefundsSection({ onChanged }) {
  const [refunds, setRefunds] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      setRefunds((await api.adminShopRefunds()).refunds || []);
      setFailed(false);
    } catch {
      setFailed(true);
      setRefunds([]);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function refund(code) {
    if (!(await confirmAction(`Refund ${code}?`, 'Record this once the money has actually been returned.'))) {
      return;
    }
    setBusy(code);
    try {
      await api.adminShopRefund(code);
      notifySuccess(`${code} marked refunded`);
      await load();
      onChanged?.();
    } catch {
      /* surfaced */
    } finally {
      setBusy(null);
    }
  }

  if (refunds === null) {
    return <div className="flex justify-center py-12"><Spinner className="!w-7 !h-7" /></div>;
  }

  if (failed) {
    return (
      <Card className="p-10 text-center">
        <p className="font-bold text-brand-black">The refund queue could not be loaded</p>
        <button onClick={load} className={btnGhost + ' mt-3 inline-flex'}>
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </Card>
    );
  }

  if (refunds.length === 0) {
    return (
      <Card className="p-10 text-center">
        <Undo2 className="w-8 h-8 text-brand-grey/40 mx-auto mb-3" />
        <p className="font-bold text-brand-black">No refunds owed</p>
        <p className="text-sm text-brand-grey mt-1">
          Cancelled and rejected orders that were already paid appear here until the money is returned.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-brand-grey">
        {refunds.length} order{refunds.length === 1 ? '' : 's'} paid for and then cancelled or
        rejected. Return the money, then mark it refunded here.
      </p>
      {refunds.map((r) => (
        <Card key={r.orderCode} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xs text-brand-grey">{r.orderCode}</p>
              <p className="font-bold text-brand-black">{r.store || 'Store'}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Pill tone="red">{r.status === 'rejected' ? 'Rejected' : 'Cancelled'}</Pill>
                {r.cancelledBy === 'merchant' && <Pill tone="amber">By the store</Pill>}
                <Pill tone="blue">{SHOP_PAYMENT_METHODS[r.paymentMethod] || r.paymentMethod}</Pill>
              </div>
              {r.reason && <p className="text-xs text-brand-grey mt-2">{r.reason}</p>}
              {r.cancelledAt && (
                <p className="text-xs text-brand-grey mt-1">
                  {new Date(r.cancelledAt).toLocaleString()}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="font-black text-brand-black">{fmtSAR(r.total)}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-brand-border">
            <button
              onClick={() => refund(r.orderCode)}
              disabled={busy === r.orderCode}
              className={btnPrimary + ' !py-1.5 !px-3 text-sm'}
            >
              <Undo2 className="w-4 h-4" /> Mark refunded
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function SettlementSection() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      setData(await api.adminShopSettlement(from, `${to}T23:59:59`));
    } catch {
      /* surfaced */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 min-w-0">
      <Card className="p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Receipt className="w-4 h-4 text-brand-orange" />
          <p className="font-black text-brand-black">Settlement</p>
        </div>
        <p className="text-xs text-brand-grey">
          What we owe each store (their net payout) vs. the markup we keep, over a date range.
          Online orders are collected by us — we owe the store; cash orders are collected by the rider.
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
          <button type="button" onClick={run} disabled={busy} className={btnPrimary + ' !py-2.5 justify-center w-full sm:w-auto'}>
            {busy ? <Spinner className="!border-white/40 !border-t-white" /> : 'Run report'}
          </button>
          {data && data.orders.length > 0 && (
            <button
              type="button"
              onClick={() => downloadCsv(`shop-settlement-${from}-to-${to}.csv`, toCsv(data.orders, SETTLEMENT_COLUMNS))}
              className={btnGhost + ' !py-2.5 justify-center w-full sm:w-auto sm:ml-auto'}
            >
              <Download className="w-4 h-4" /> CSV
            </button>
          )}
        </div>
      </Card>

      {data && (
        <>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
            <Stat label="Owed to stores (online)" value={fmtSAR(data.totals.onlineOwedToStore)} icon={Wallet} />
            <Stat label="Markup kept (online)" value={fmtSAR(data.totals.onlineMarkupKept)} icon={Banknote} />
            <Stat label="Cash collected by riders" value={fmtSAR(data.totals.cashCollectedByRider)} icon={Banknote} />
            <Stat label="Cash owed to stores" value={fmtSAR(data.totals.cashStorePayout)} icon={Wallet} />
            <Stat label="Markup on cash orders" value={fmtSAR(data.totals.cashMarkup)} icon={Banknote} />
            <Stat label="VAT collected" value={fmtSAR(data.totals.vatCollected)} icon={Receipt} />
          </div>
          {data.totals.refundedAmount > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium">
              {fmtSAR(data.totals.refundedAmount)} refunded in this period and excluded from the totals above.
            </div>
          )}
          <Card className="p-4">
            <p className="text-sm text-brand-grey">{data.count} order(s) in range.</p>
          </Card>
        </>
      )}
    </div>
  );
}

// --- Shell ------------------------------------------------------------
export default function ShopAdmin() {
  const [section, setSection] = useState('stores');
  const [overview, setOverview] = useState(null);
  const [stores, setStores] = useState([]);
  const [storesFailed, setStoresFailed] = useState(false);
  const [selectedStore, setSelectedStore] = useState('');
  const [loading, setLoading] = useState(true);

  // Loaded independently, NOT with one Promise.all under a swallowed catch.
  // Coupled, a failing overview rejected before setStores ever ran and the
  // Stores section rendered its "No stores yet" empty card — a claim about
  // the data made from an unrelated request failing. FoodAdmin has always
  // loaded each section on its own; this matches it.
  const load = useCallback(async () => {
    const results = await Promise.allSettled([api.adminShopOverview(), api.adminShopStores()]);
    if (results[0].status === 'fulfilled') setOverview(results[0].value);
    if (results[1].status === 'fulfilled') setStores(results[1].value.stores || []);
    // The stores request is the one whose failure would otherwise be
    // indistinguishable from an empty catalogue.
    setStoresFailed(results[1].status === 'rejected');
    setLoading(false);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  useBroadcast('admin-shop', { changed: () => load() });

  if (loading) return <div className="flex justify-center py-20"><Spinner className="!w-8 !h-8" /></div>;

  return (
    <div className="space-y-4 sm:space-y-5 min-w-0">
      {overview && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
          <Stat label="Orders today" value={overview.ordersToday} icon={ClipboardList} hint="Placed since midnight" />
          <Stat label="Total orders" value={overview.totalOrders} icon={Receipt} />
          <Stat label="Platform revenue" value={fmtSAR(overview.platformRevenue)} icon={Banknote} />
          <Stat
            label="Payments to verify"
            value={overview.paymentsToVerify}
            tone={overview.paymentsToVerify > 0 ? 'red' : undefined}
            icon={Wallet}
            hint="STC Pay screenshots"
            onClick={() => setSection('orders')}
          />
          <Stat label="Stores" value={overview.stores} icon={Store} onClick={() => setSection('stores')} />
          <Stat
            label="Suspended"
            value={overview.suspended}
            tone={overview.suspended > 0 ? 'red' : undefined}
            icon={ShieldX}
            hint="Cannot take orders"
          />
          <Stat
            label="Out of stock"
            value={overview.outOfStockProducts}
            tone={overview.outOfStockProducts > 0 ? 'red' : undefined}
            icon={Boxes}
            hint="Products at zero"
            onClick={() => setSection('inventory')}
          />
          <Stat
            label="Refunds owed"
            value={overview.refundsOwed ?? 0}
            tone={overview.refundsOwed > 0 ? 'red' : undefined}
            icon={Undo2}
            hint="Paid, then cancelled"
            onClick={() => setSection('refunds')}
          />
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto overscroll-x-contain snap-x snap-mandatory pb-1 -mx-3 px-3 sm:-mx-5 sm:px-5 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8 xl:mx-0 xl:px-0 no-scrollbar">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
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

      {section === 'stores' && (
        <StoresSection
          stores={stores}
          failed={storesFailed}
          onChanged={load}
          onOpenCatalogue={(s) => {
            setSelectedStore(s.id);
            setSection('catalogue');
          }}
        />
      )}
      {section === 'catalogue' && (
        <CatalogueSection stores={stores} selectedStore={selectedStore} onSelectStore={setSelectedStore} />
      )}
      {section === 'orders' && <OrdersSection onChanged={load} />}
      {section === 'inventory' && <InventorySection stores={stores} />}
      {section === 'refunds' && <RefundsSection onChanged={load} />}
      {section === 'settlement' && <SettlementSection />}
    </div>
  );
}
