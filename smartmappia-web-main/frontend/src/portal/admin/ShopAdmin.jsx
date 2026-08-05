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
} from 'lucide-react';
import { api } from '../lib/api';
import { useBroadcast } from '../lib/useBroadcast';
import { fmtSAR, shopStatusMeta, shopPaymentMeta, TONE_CLASSES } from '../lib/constants';
import { notifySuccess, notifyError, confirmAction } from '../lib/notify';
import { toCsv, downloadCsv } from '../lib/csv';
import { Card, Field, Spinner, inputClass, btnPrimary, btnGhost } from '../components/ui';
import PasswordInput from '../components/PasswordInput';

// Owner passwords are chosen by the admin and handed over in person — keep this
// in step with MIN_PASSWORD_LENGTH in backend/lib/validate.js.
const MIN_OWNER_PASSWORD = 8;

const SECTIONS = [
  { id: 'stores', label: 'Stores', icon: Store },
  { id: 'catalogue', label: 'Catalogue', icon: Package },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'settlement', label: 'Settlement', icon: Receipt },
];

function Stat({ label, value, tone }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-brand-grey font-medium">{label}</p>
      <p className={`text-2xl font-black mt-1 ${tone === 'red' ? 'text-red-600' : 'text-brand-black'}`}>
        {value}
      </p>
    </Card>
  );
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
function StoresSection({ stores, onChanged, onOpenCatalogue }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', cuisine_type: '', description: '', logo_url: '', address: '' });
  const [ownerFor, setOwnerFor] = useState(null);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [pwFor, setPwFor] = useState(null); // store whose owner password is being re-issued
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) await api.adminShopUpdateStore(editing, form);
      else await api.adminShopCreateStore(form);
      notifySuccess(editing ? 'Store updated' : 'Store created (unlisted)');
      setShowForm(false);
      setEditing(null);
      setForm({ name: '', cuisine_type: '', description: '', logo_url: '', address: '' });
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => {
            setEditing(null);
            setForm({ name: '', cuisine_type: '', description: '', logo_url: '', address: '' });
            setShowForm((v) => !v);
          }}
          className={btnPrimary}
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Close' : 'Add store'}
        </button>
      </div>

      {showForm && (
        <Card className="p-5">
          <form onSubmit={save} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Store name">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputClass} />
              </Field>
              <Field label="Category">
                <input value={form.cuisine_type} onChange={(e) => setForm({ ...form, cuisine_type: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Logo URL">
                <input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Address">
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputClass} />
              </Field>
            </div>
            <Field label="Description">
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={inputClass} />
            </Field>
            <p className="text-xs text-brand-grey">
              New stores start unlisted. Import the catalogue and set the net prices, then list it.
            </p>
            <button disabled={busy} className={btnPrimary + ' w-full'}>
              {busy ? <Spinner className="!border-white/40 !border-t-white" /> : 'Save store'}
            </button>
          </form>
        </Card>
      )}

      {stores.length === 0 ? (
        <Card className="p-10 text-center">
          <Store className="w-8 h-8 text-brand-grey/40 mx-auto mb-3" />
          <p className="font-bold text-brand-black">No stores yet</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {stores.map((s) => {
            const credit = s.credit || {};
            return (
              <Card key={s.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 shrink-0 rounded-lg bg-brand-surface overflow-hidden flex items-center justify-center">
                    {s.logo_url ? <img src={s.logo_url} alt="" className="w-full h-full object-cover" /> : <Store className="w-5 h-5 text-brand-grey/40" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-brand-black truncate">{s.name}</p>
                    <p className="text-xs text-brand-grey">{s.cuisine_type || 'No category'}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Pill tone={s.is_active ? 'green' : 'grey'}>{s.is_active ? 'Listed' : 'Unlisted'}</Pill>
                      {s.status === 'suspended' && <Pill tone="red">Suspended</Pill>}
                      {!s.logo_url && <Pill tone="amber">No logo</Pill>}
                      {(s.lat == null || s.lng == null) && <Pill tone="red">No map pin</Pill>}
                      {s.ownerEmail ? <Pill tone="blue">{s.ownerEmail}</Pill> : <Pill tone="amber">No owner</Pill>}
                    </div>
                    <p className="text-xs text-brand-grey mt-2">
                      Credit {fmtSAR(credit.creditUsed)} of {fmtSAR(credit.creditLimit)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-brand-border">
                  <button onClick={() => onOpenCatalogue(s)} className={btnGhost + ' !py-1.5 !px-3 text-sm'}>
                    <Package className="w-4 h-4" /> Catalogue
                  </button>
                  <button onClick={() => toggleListed(s)} className={btnGhost + ' !py-1.5 !px-3 text-sm'}>
                    {s.is_active ? 'Unlist' : 'List'}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(s.id);
                      setForm({
                        name: s.name || '',
                        cuisine_type: s.cuisine_type || '',
                        description: s.description || '',
                        logo_url: s.logo_url || '',
                        address: s.address || '',
                      });
                      setShowForm(true);
                    }}
                    className={btnGhost + ' !py-1.5 !px-3 text-sm'}
                  >
                    <Pencil className="w-4 h-4" /> Edit
                  </button>
                  {!s.ownerEmail ? (
                    <button
                      onClick={() => { setOwnerFor(s.id); setOwnerEmail(''); setOwnerPassword(''); }}
                      className={btnGhost + ' !py-1.5 !px-3 text-sm'}
                    >
                      <UserPlus className="w-4 h-4" /> Assign owner
                    </button>
                  ) : (
                    <button
                      onClick={() => { setPwFor(pwFor === s.id ? null : s.id); setNewPassword(''); }}
                      className={btnGhost + ' !py-1.5 !px-3 text-sm'}
                      title={`Owner: ${s.ownerEmail}`}
                    >
                      <UserPlus className="w-4 h-4" /> Owner password
                    </button>
                  )}
                  {s.status === 'suspended' ? (
                    <button
                      onClick={async () => {
                        await api.adminShopReactivate(s.id);
                        onChanged();
                      }}
                      className={btnGhost + ' !py-1.5 !px-3 text-sm'}
                    >
                      Reactivate
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        if (!(await confirmAction(`Suspend ${s.name}?`, 'It will stop accepting orders.'))) return;
                        await api.adminShopSuspend(s.id, null);
                        onChanged();
                      }}
                      className={btnGhost + ' !py-1.5 !px-3 text-sm'}
                    >
                      Suspend
                    </button>
                  )}
                  {credit.creditUsed > 0 && (
                    <button
                      onClick={async () => {
                        if (!(await confirmAction(`Reconcile ${fmtSAR(credit.creditUsed)}?`, 'Records that the store has settled.'))) return;
                        await api.adminShopCredit(s.id, { amount: credit.creditUsed, note: 'Admin reconciliation' });
                        onChanged();
                      }}
                      className={btnGhost + ' !py-1.5 !px-3 text-sm'}
                    >
                      Reconcile credit
                    </button>
                  )}
                </div>

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
                    <div className="flex gap-2">
                      <button disabled={busy} className={btnPrimary}>Link</button>
                      <button type="button" onClick={() => setOwnerFor(null)} className={btnGhost}>Cancel</button>
                    </div>
                    <p className="text-xs text-brand-grey">
                      Give the owner this password in person — there is no reset email.
                    </p>
                  </form>
                )}

                {pwFor === s.id && (
                  <form onSubmit={resetOwnerPassword} className="mt-3 pt-3 border-t border-brand-border space-y-2">
                    <p className="text-xs font-bold text-brand-dark">Owner account: {s.ownerEmail}</p>
                    <PasswordInput
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder={`New password (min ${MIN_OWNER_PASSWORD} characters)`}
                    />
                    <div className="flex gap-2">
                      <button disabled={busy} className={btnPrimary}>Set new password</button>
                      <button type="button" onClick={() => setPwFor(null)} className={btnGhost}>Cancel</button>
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

  if (!selectedStore) {
    return (
      <Card className="p-6">
        <Field label="Choose a store">
          <select value="" onChange={(e) => onSelectStore(e.target.value)} className={inputClass}>
            <option value="">Select a store...</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <select value={selectedStore} onChange={(e) => onSelectStore(e.target.value)} className={inputClass + ' flex-1'}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={load} className={btnGhost + ' !py-2 !px-3'}><RefreshCw className="w-4 h-4" /></button>
        </div>
      </Card>

      <Card className="p-5">
        <p className="font-black text-brand-black mb-3">Categories</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!catName.trim()) return;
            await api.adminShopAddCategory(selectedStore, { name: catName.trim(), sort_order: (data?.categories || []).length });
            setCatName('');
            load();
          }}
          className="flex gap-2 mb-3"
        >
          <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="New category" className={inputClass + ' flex-1'} />
          <button className={btnPrimary}><Plus className="w-4 h-4" /></button>
        </form>
        <div className="flex flex-wrap gap-2">
          {(data?.categories || []).map((c) => (
            <span key={c.id} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-surface text-sm font-medium">
              {c.name}
              <button
                onClick={async () => {
                  if (!(await confirmAction(`Delete "${c.name}"?`))) return;
                  await api.adminShopDeleteCategory(c.id);
                  load();
                }}
                className="text-brand-grey hover:text-red-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="font-black text-brand-black">Products</p>
          <button
            onClick={() => {
              setForm(emptyProduct);
              setEditingId(null);
              setShowForm((v) => !v);
            }}
            className={btnPrimary + ' !py-2 !px-3 text-sm'}
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
                <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className={inputClass}>
                  <option value="">Uncategorised</option>
                  {(data?.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
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
              <Field label="Image URL">
                <input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} className={inputClass} />
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
        ) : (
          <div className="space-y-2">
            {(data?.products || []).map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl border border-brand-border">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-brand-black truncate">{p.name}</p>
                  <p className="text-xs text-brand-grey">
                    List {fmtSAR(p.price)} · Net {p.net_price != null ? fmtSAR(p.net_price) : 'not set'} ·{' '}
                    <span className="font-bold text-brand-dark">
                      markup {p.net_price != null ? fmtSAR(p.price - p.net_price) : 'fallback'}
                    </span>
                  </p>
                  <p className="text-xs text-brand-grey mt-0.5">
                    Stock {p.stock_quantity}
                    {(p.product_variants || []).length > 0 && ` · ${p.product_variants.length} options`}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
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
                    className="p-2 text-brand-grey hover:text-brand-orange"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!(await confirmAction(`Delete "${p.name}"?`))) return;
                      await api.adminShopDeleteProduct(p.id);
                      load();
                    }}
                    className="p-2 text-brand-grey hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
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

  const visible = useMemo(() => {
    const list = orders || [];
    if (filter === 'action') {
      return list.filter((o) => o.status === 'pending' || o.payment_status === 'awaiting');
    }
    if (filter === 'live') {
      return list.filter((o) => !['delivered', 'cancelled', 'rejected'].includes(o.status));
    }
    return list;
  }, [orders, filter]);

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

  if (!orders) return <div className="flex justify-center py-16"><Spinner className="!w-8 !h-8" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[
          { id: 'action', label: 'Needs action' },
          { id: 'live', label: 'Live' },
          { id: 'all', label: 'All' },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-bold border ${
              filter === f.id ? 'bg-brand-orange text-white border-brand-orange' : 'bg-white text-brand-grey border-brand-border'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Card className="p-10 text-center">
          <ClipboardList className="w-8 h-8 text-brand-grey/40 mx-auto mb-3" />
          <p className="font-bold text-brand-black">No orders here</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((o) => {
            const status = shopStatusMeta(o.status);
            const payment = shopPaymentMeta(o.payment_status);
            return (
              <Card key={o.order_code} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-brand-grey">{o.order_code}</p>
                    <p className="font-bold text-brand-black">{o.merchants?.name}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Pill tone={status.tone}>{status.label}</Pill>
                      <Pill tone={payment.tone}>{payment.label}</Pill>
                      {o.payment_method === 'cash' && <Pill tone="blue">Cash</Pill>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black text-brand-black">{fmtSAR(o.total)}</p>
                    <p className="text-xs text-brand-grey">markup {fmtSAR(o.platform_margin_total)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-brand-border">
                  {o.payment_status === 'awaiting' && o.payment_method !== 'cash' && (
                    <>
                      <button onClick={() => act(o.order_code, () => api.adminShopVerifyPayment(o.order_code, null))} disabled={busy === o.order_code} className={btnPrimary + ' !py-1.5 !px-3 text-sm'}>
                        <Check className="w-4 h-4" /> Verify payment
                      </button>
                      <button onClick={() => act(o.order_code, () => api.adminShopRejectPayment(o.order_code, 'Proof not valid'))} className={btnGhost + ' !py-1.5 !px-3 text-sm'}>
                        Reject payment
                      </button>
                    </>
                  )}
                  {o.status === 'pending' && (
                    <button onClick={() => act(o.order_code, () => api.adminShopAcceptOrder(o.order_code))} disabled={busy === o.order_code} className={btnGhost + ' !py-1.5 !px-3 text-sm'}>
                      Accept
                    </button>
                  )}
                  {['accepted', 'packing', 'ready', 'out_for_delivery'].includes(o.status) && (
                    <button
                      onClick={() => {
                        const next = { accepted: 'packing', packing: 'ready', ready: 'out_for_delivery', out_for_delivery: 'delivered' }[o.status];
                        act(o.order_code, () => api.adminShopOrderStatus(o.order_code, next));
                      }}
                      className={btnGhost + ' !py-1.5 !px-3 text-sm'}
                    >
                      Advance
                    </button>
                  )}
                  {!['delivered', 'cancelled', 'rejected'].includes(o.status) && (
                    <button
                      onClick={async () => {
                        if (!(await confirmAction(`Cancel ${o.order_code}?`, 'Reserved stock is released.'))) return;
                        act(o.order_code, () => api.adminShopCancelOrder(o.order_code, 'Admin cancelled'));
                      }}
                      className={btnGhost + ' !py-1.5 !px-3 text-sm'}
                    >
                      Cancel
                    </button>
                  )}
                  {o.payment_status === 'paid' && (
                    <button
                      onClick={async () => {
                        if (!(await confirmAction(`Refund ${o.order_code}?`, 'Stock is released back to the store.'))) return;
                        act(o.order_code, () => api.adminShopRefund(o.order_code));
                      }}
                      className={btnGhost + ' !py-1.5 !px-3 text-sm'}
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
    if (!storeId) return;
    api.adminShopInventory(storeId).then(setData).catch(() => {});
  }, [storeId]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={inputClass}>
          <option value="">Select a store...</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Card>
      {data && (
        <Card className="p-5">
          <p className="font-black text-brand-black mb-3">
            Low stock ({data.lowStock.length}) — at or below the per-product threshold
          </p>
          {data.lowStock.length === 0 ? (
            <p className="text-sm text-brand-grey">Everything is above its low-stock line.</p>
          ) : (
            <div className="space-y-2">
              {data.lowStock.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-xl border border-brand-border">
                  <span className="font-bold text-brand-black">{p.name}</span>
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
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} /></Field>
          <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} /></Field>
          <button onClick={run} disabled={busy} className={btnPrimary}>
            {busy ? <Spinner className="!border-white/40 !border-t-white" /> : 'Run report'}
          </button>
          {data && data.orders.length > 0 && (
            <button
              onClick={() => downloadCsv(`shop-settlement-${from}-to-${to}.csv`, toCsv(data.orders, SETTLEMENT_COLUMNS))}
              className={btnGhost}
            >
              <Download className="w-4 h-4" /> CSV
            </button>
          )}
        </div>
      </Card>

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="Owed to stores (online)" value={fmtSAR(data.totals.onlineOwedToStore)} />
            <Stat label="Markup kept (online)" value={fmtSAR(data.totals.onlineMarkupKept)} />
            <Stat label="Cash collected by riders" value={fmtSAR(data.totals.cashCollectedByRider)} />
            <Stat label="Cash owed to stores" value={fmtSAR(data.totals.cashStorePayout)} />
            <Stat label="Markup on cash orders" value={fmtSAR(data.totals.cashMarkup)} />
            <Stat label="VAT collected" value={fmtSAR(data.totals.vatCollected)} />
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
  const [selectedStore, setSelectedStore] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [ov, st] = await Promise.all([api.adminShopOverview(), api.adminShopStores()]);
      setOverview(ov);
      setStores(st.stores || []);
    } catch {
      /* surfaced */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  useBroadcast('admin-shop', { changed: () => load() });

  if (loading) return <div className="flex justify-center py-20"><Spinner className="!w-8 !h-8" /></div>;

  return (
    <div className="space-y-5">
      {overview && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Orders today" value={overview.ordersToday} />
          <Stat label="Total orders" value={overview.totalOrders} />
          <Stat label="Platform revenue" value={fmtSAR(overview.platformRevenue)} />
          <Stat label="Payments to verify" value={overview.paymentsToVerify} tone={overview.paymentsToVerify > 0 ? 'red' : undefined} />
          <Stat label="Stores" value={overview.stores} />
          <Stat label="Suspended" value={overview.suspended} tone={overview.suspended > 0 ? 'red' : undefined} />
          <Stat label="Out of stock" value={overview.outOfStockProducts} tone={overview.outOfStockProducts > 0 ? 'red' : undefined} />
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-bold border transition-colors ${
              section === id ? 'bg-brand-orange text-white border-brand-orange' : 'bg-white text-brand-grey border-brand-border'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {section === 'stores' && (
        <StoresSection
          stores={stores}
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
      {section === 'settlement' && <SettlementSection />}
    </div>
  );
}
