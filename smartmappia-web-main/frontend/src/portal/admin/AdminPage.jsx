// ---------------------------------------------------------------------
// Admin portal: review payment proofs (verify/reject) and approve drivers.
// Access is gated by RequireAuth role="admin"; identity from the session.
// ---------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Check, X, RefreshCw, ExternalLink, ShieldCheck, ShieldX } from 'lucide-react';
import { api } from '../lib/api';
import { useBroadcast } from '../lib/useBroadcast';
import { realtimeEnabled } from '../lib/supabaseClient';
import { statusMeta } from '../lib/constants';
import { PortalShell, Card, Badge, Spinner, btnPrimary } from '../components/ui';

const FILTERS = [
  { id: 'review', label: 'Needs review', q: '?payment_status=proof_uploaded' },
  { id: 'all', label: 'All', q: '' },
  { id: 'verified', label: 'Verified', q: '?payment_status=verified' },
  { id: 'pending', label: 'Awaiting payment', q: '?payment_status=awaiting_proof' },
];

function BookingsView() {
  const [filter, setFilter] = useState(FILTERS[0]);
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true); setError(null);
    try { setList((await api.adminList(filter.q)).bookings || []); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [filter]);

  const loadDetail = useCallback(async (code) => {
    setSelected(code); setDetail(null);
    try { setDetail(await api.adminDetail(code)); }
    catch (err) { setError(err.message); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useBroadcast('admin-bookings', { changed: () => { loadList(); if (selected) loadDetail(selected); } }, realtimeEnabled);

  async function verify(code) {
    setBusy(true); setError(null);
    try { await api.adminVerify(code); await loadList(); await loadDetail(code); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function reject(code) {
    const reason = window.prompt('Reason for rejecting this payment?');
    if (!reason) return;
    setBusy(true); setError(null);
    try { await api.adminReject(code, reason); await loadList(); await loadDetail(code); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <>
      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">{error}</div>}
      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors cursor-pointer ${filter.id === f.id ? 'bg-brand-orange text-white border-brand-orange' : 'bg-white text-brand-grey border-brand-border hover:text-brand-dark'}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-2 p-2 max-h-[70vh] overflow-y-auto">
          {loading && <div className="p-6 flex justify-center"><Spinner /></div>}
          {!loading && list.length === 0 && <div className="p-6 text-center text-sm text-brand-grey">No bookings.</div>}
          {list.map((b) => {
            const meta = statusMeta(b.booking_status);
            return (
              <button key={b.booking_code} onClick={() => loadDetail(b.booking_code)}
                className={`w-full text-left p-3 rounded-xl mb-1 transition-colors cursor-pointer ${selected === b.booking_code ? 'bg-brand-warm' : 'hover:bg-brand-surface'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold">{b.booking_code}</span>
                  <Badge tone={meta.tone}>{b.payment_status}</Badge>
                </div>
                <div className="text-sm font-medium text-brand-dark mt-1 truncate">{b.passenger_name} · SAR {b.fare_amount}</div>
                <div className="text-xs text-brand-grey truncate">{new Date(b.created_at).toLocaleString()}</div>
              </button>
            );
          })}
        </Card>

        <Card className="lg:col-span-3 p-5">
          {!selected && <div className="text-center text-sm text-brand-grey py-16">Select a booking to review.</div>}
          {selected && !detail && <div className="flex justify-center py-16"><Spinner /></div>}
          {detail && (
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono font-black text-lg">{detail.booking.booking_code}</div>
                  <div className="text-sm text-brand-grey">{detail.booking.passenger_name} · {detail.booking.passenger_whatsapp}</div>
                </div>
                <Badge tone={statusMeta(detail.booking.booking_status).tone}>{detail.booking.payment_status}</Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                <div><div className="text-[10px] font-bold text-brand-grey uppercase">Pickup</div>{detail.booking.pickup_address}</div>
                <div><div className="text-[10px] font-bold text-brand-grey uppercase">Drop-off</div>{detail.booking.dropoff_address}</div>
                <div><div className="text-[10px] font-bold text-brand-grey uppercase">Fare</div>SAR {detail.booking.fare_amount}</div>
                <div><div className="text-[10px] font-bold text-brand-grey uppercase">Pickup time</div>{detail.booking.pickup_datetime ? new Date(detail.booking.pickup_datetime).toLocaleString() : '—'}</div>
              </div>

              <div className="mt-5">
                <div className="font-black text-brand-black mb-2">Payment proofs</div>
                {(!detail.proofs || detail.proofs.length === 0) && <p className="text-sm text-brand-grey">No proof uploaded yet.</p>}
                <div className="grid grid-cols-2 gap-3">
                  {(detail.proofs || []).map((p) => (
                    <div key={p.id} className="border border-brand-border rounded-xl overflow-hidden">
                      {p.downloadUrl && (p.file_mime_type || '').startsWith('image') ? (
                        <a href={p.downloadUrl} target="_blank" rel="noreferrer"><img src={p.downloadUrl} alt="proof" className="w-full h-36 object-cover" /></a>
                      ) : (
                        <a href={p.downloadUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-4 text-sm text-brand-orange font-bold"><ExternalLink className="w-4 h-4" /> Open file</a>
                      )}
                      <div className="px-3 py-2 text-xs flex items-center justify-between">
                        <Badge tone={p.status === 'verified' ? 'green' : p.status === 'rejected' ? 'red' : 'amber'}>{p.status}</Badge>
                        <span className="text-brand-grey">{new Date(p.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {detail.booking.payment_status !== 'verified' ? (
                <div className="flex gap-3 mt-5">
                  <button onClick={() => verify(detail.booking.booking_code)} disabled={busy} className={btnPrimary + ' flex-1'}>
                    {busy ? <Spinner className="!border-white/40 !border-t-white" /> : <><Check className="w-4 h-4" /> Verify payment</>}
                  </button>
                  <button onClick={() => reject(detail.booking.booking_code)} disabled={busy}
                    className="flex-1 inline-flex items-center justify-center gap-2 bg-white hover:bg-red-50 text-red-600 font-bold py-3 rounded-xl border border-red-200 cursor-pointer disabled:opacity-50">
                    <X className="w-4 h-4" /> Reject
                  </button>
                </div>
              ) : (
                <div className="mt-5 p-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm font-bold flex items-center gap-2">
                  <Check className="w-4 h-4" /> Payment verified — booking confirmed and open to drivers.
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function DriversView() {
  const [drivers, setDrivers] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setDrivers((await api.adminDrivers()).drivers || []); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setApproval(id, approved) {
    setBusyId(id); setError(null);
    try { await api.adminApproveDriver(id, approved); await load(); }
    catch (err) { setError(err.message); } finally { setBusyId(null); }
  }

  return (
    <>
      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">{error}</div>}
      <Card className="p-2">
        {loading && <div className="p-6 flex justify-center"><Spinner /></div>}
        {!loading && drivers.length === 0 && <div className="p-6 text-center text-sm text-brand-grey">No drivers yet.</div>}
        {drivers.map((d) => (
          <div key={d.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-brand-surface">
            <div className="min-w-0">
              <div className="font-bold text-brand-dark truncate">{d.full_name || '(no name)'}</div>
              <div className="text-xs text-brand-grey truncate">
                {d.email} · {d.mobile_number || d.whatsapp_number || '—'}
              </div>
              {(d.vehicle_type || d.vehicle_plate) && (
                <div className="text-xs text-brand-grey truncate mt-0.5">
                  {[d.vehicle_type, d.vehicle_plate].filter(Boolean).join(' · ')}
                  {d.national_id ? ` · ID ${d.national_id}` : ''}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge tone={d.driver_approved ? 'green' : 'amber'}>{d.driver_approved ? 'approved' : 'pending'}</Badge>
              {d.driver_approved ? (
                <button onClick={() => setApproval(d.id, false)} disabled={busyId === d.id}
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50 cursor-pointer disabled:opacity-50">
                  {busyId === d.id ? <Spinner /> : <><ShieldX className="w-4 h-4" /> Revoke</>}
                </button>
              ) : (
                <button onClick={() => setApproval(d.id, true)} disabled={busyId === d.id} className={btnPrimary + ' !py-1.5 !px-3'}>
                  {busyId === d.id ? <Spinner className="!border-white/40 !border-t-white" /> : <><ShieldCheck className="w-4 h-4" /> Approve</>}
                </button>
              )}
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState('bookings');
  const [tick, setTick] = useState(0);

  return (
    <PortalShell
      title="Admin dashboard"
      right={
        <button onClick={() => setTick((t) => t + 1)} className="p-2 rounded-lg hover:bg-brand-surface cursor-pointer" title="Refresh">
          <RefreshCw className="w-4 h-4 text-brand-grey" />
        </button>
      }
    >
      <div className="flex gap-2 mb-4">
        {['bookings', 'drivers'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-bold border capitalize transition-colors cursor-pointer ${tab === t ? 'bg-brand-black text-white border-brand-black' : 'bg-white text-brand-grey border-brand-border hover:text-brand-dark'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'bookings' ? <BookingsView key={`b${tick}`} /> : <DriversView key={`d${tick}`} />}
    </PortalShell>
  );
}
