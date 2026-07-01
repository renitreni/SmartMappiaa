// ---------------------------------------------------------------------
// Admin portal: review payment proofs (verify/reject) and approve drivers.
// Access is gated by RequireAuth role="admin"; identity from the session.
// ---------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Check, X, ExternalLink, ShieldCheck, ShieldX, Search, FileText } from 'lucide-react';
import { api } from '../lib/api';
import { useBroadcast } from '../lib/useBroadcast';
import { realtimeEnabled } from '../lib/supabaseClient';
import { statusMeta } from '../lib/constants';
import { Card, Badge, Spinner, btnPrimary } from '../components/ui';
import AdminLayout from './AdminLayout';
import Dashboard from './Dashboard';

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
  const [search, setSearch] = useState('');

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList((await api.adminList(filter.q)).bookings || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadDetail = useCallback(async (code) => {
    setSelected(code);
    setDetail(null);
    try {
      setDetail(await api.adminDetail(code));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useBroadcast('admin-bookings', { changed: () => { loadList(); if (selected) loadDetail(selected); } }, realtimeEnabled);

  async function verify(code) {
    setBusy(true);
    setError(null);
    try {
      await api.adminVerify(code);
      await loadList();
      await loadDetail(code);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reject(code) {
    const reason = window.prompt('Reason for rejecting this payment?');
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminReject(code, reason);
      await loadList();
      await loadDetail(code);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = list.filter((b) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      b.booking_code?.toLowerCase().includes(q) ||
      b.passenger_name?.toLowerCase().includes(q)
    );
  });

  return (
    <>
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="flex gap-2 flex-wrap flex-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors cursor-pointer ${
                filter.id === f.id
                  ? 'bg-brand-black text-white border-brand-black'
                  : 'bg-white text-brand-grey border-brand-border hover:text-brand-dark'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative sm:w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-grey" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bookings…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-brand-border text-sm focus:outline-none focus:border-brand-orange"
          />
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-2 p-2 max-h-[calc(100vh-14rem)] overflow-y-auto">
          {loading && (
            <div className="p-6 flex justify-center">
              <Spinner />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-brand-grey">No bookings found.</div>
          )}
          {filtered.map((b) => {
            const meta = statusMeta(b.booking_status);
            const isSelected = selected === b.booking_code;
            return (
              <button
                key={b.booking_code}
                type="button"
                onClick={() => loadDetail(b.booking_code)}
                className={`w-full text-left p-3 rounded-xl mb-1 transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-brand-warm border-brand-orange/30 shadow-sm'
                    : 'border-transparent hover:bg-brand-surface'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-brand-dark">{b.booking_code}</span>
                  <Badge tone={meta.tone}>{b.payment_status}</Badge>
                </div>
                <div className="text-sm font-medium text-brand-dark mt-1 truncate">
                  {b.passenger_name} · SAR {b.fare_amount}
                </div>
                <div className="text-xs text-brand-grey truncate mt-0.5">
                  {new Date(b.created_at).toLocaleString()}
                </div>
              </button>
            );
          })}
        </Card>

        <Card className="lg:col-span-3 p-5 min-h-[420px]">
          {!selected && (
            <div className="flex flex-col items-center justify-center text-center py-20 px-6">
              <div className="w-14 h-14 rounded-2xl bg-brand-surface flex items-center justify-center mb-4">
                <Search className="w-6 h-6 text-brand-grey" />
              </div>
              <p className="font-bold text-brand-dark">Select a booking</p>
              <p className="text-sm text-brand-grey mt-1 max-w-xs">
                Choose a booking from the list to review payment details and proofs.
              </p>
            </div>
          )}
          {selected && !detail && (
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          )}
          {detail && (
            <div>
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-brand-border">
                <div>
                  <div className="font-mono font-black text-xl text-brand-black">{detail.booking.booking_code}</div>
                  <div className="text-sm text-brand-grey mt-1">
                    {detail.booking.passenger_name} · {detail.booking.passenger_whatsapp}
                  </div>
                </div>
                <Badge tone={statusMeta(detail.booking.booking_status).tone}>
                  {detail.booking.payment_status}
                </Badge>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 mt-4 text-sm">
                <div className="p-3 rounded-xl bg-brand-muted">
                  <div className="text-[10px] font-bold text-brand-grey uppercase mb-1">Pickup</div>
                  {detail.booking.pickup_address}
                </div>
                <div className="p-3 rounded-xl bg-brand-muted">
                  <div className="text-[10px] font-bold text-brand-grey uppercase mb-1">Drop-off</div>
                  {detail.booking.dropoff_address}
                </div>
                <div className="p-3 rounded-xl bg-brand-muted">
                  <div className="text-[10px] font-bold text-brand-grey uppercase mb-1">Fare</div>
                  SAR {detail.booking.fare_amount}
                </div>
                <div className="p-3 rounded-xl bg-brand-muted">
                  <div className="text-[10px] font-bold text-brand-grey uppercase mb-1">Pickup time</div>
                  {detail.booking.pickup_datetime
                    ? new Date(detail.booking.pickup_datetime).toLocaleString()
                    : '—'}
                </div>
              </div>

              <div className="mt-6">
                <div className="font-black text-brand-black mb-3">Payment proofs</div>
                {(!detail.proofs || detail.proofs.length === 0) && (
                  <p className="text-sm text-brand-grey p-4 rounded-xl bg-brand-muted text-center">
                    No proof uploaded yet.
                  </p>
                )}
                <div className="grid sm:grid-cols-2 gap-3">
                  {(detail.proofs || []).map((p) => (
                    <div key={p.id} className="border border-brand-border rounded-xl overflow-hidden">
                      {p.downloadUrl && (p.file_mime_type || '').startsWith('image') ? (
                        <a href={p.downloadUrl} target="_blank" rel="noreferrer">
                          <img src={p.downloadUrl} alt="proof" className="w-full h-36 object-cover" />
                        </a>
                      ) : (
                        <a
                          href={p.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 p-4 text-sm text-brand-orange font-bold"
                        >
                          <ExternalLink className="w-4 h-4" /> Open file
                        </a>
                      )}
                      <div className="px-3 py-2 text-xs flex items-center justify-between bg-brand-muted">
                        <Badge tone={p.status === 'verified' ? 'green' : p.status === 'rejected' ? 'red' : 'amber'}>
                          {p.status}
                        </Badge>
                        <span className="text-brand-grey">{new Date(p.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {detail.booking.payment_status !== 'verified' ? (
                <div className="flex flex-col sm:flex-row gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => verify(detail.booking.booking_code)}
                    disabled={busy}
                    className={btnPrimary + ' flex-1'}
                  >
                    {busy ? (
                      <Spinner className="!border-white/40 !border-t-white" />
                    ) : (
                      <>
                        <Check className="w-4 h-4" /> Verify payment
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => reject(detail.booking.booking_code)}
                    disabled={busy}
                    className="flex-1 inline-flex items-center justify-center gap-2 bg-white hover:bg-red-50 text-red-600 font-bold py-3 rounded-xl border border-red-200 cursor-pointer disabled:opacity-50"
                  >
                    <X className="w-4 h-4" /> Reject
                  </button>
                </div>
              ) : (
                <div className="mt-6 p-4 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm font-bold flex items-center gap-2">
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

const DOC_LABELS = {
  national_id: 'National ID / Iqama',
  license: 'Driving License',
  vehicle_registration: 'Vehicle Registration (Istimara)',
  insurance: 'Vehicle Insurance',
  tga_permit: 'TGA Ride-hailing Permit',
  profile_photo: 'Driver Photo',
  vehicle_photo: 'Vehicle Photo + Plate',
};

// Expandable panel: a driver's uploaded documents with per-doc Verify/Reject.
// Verifying all required docs auto-approves the driver (backend-side).
function DriverDocsPanel({ driverId, onReviewed }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await api.adminDriverDocuments(driverId)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [driverId]);
  useEffect(() => { load(); }, [load]);

  async function review(docId, status) {
    let reason;
    if (status === 'rejected') {
      reason = window.prompt('Reason for rejecting this document:');
      if (reason === null) return; // cancelled
      if (!reason.trim()) { setError('A rejection reason is required.'); return; }
    }
    setBusyId(docId);
    setError(null);
    try {
      await api.adminReviewDoc(driverId, docId, { status, rejection_reason: reason });
      await load();
      if (onReviewed) onReviewed();
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  if (loading && !data) {
    return <div className="p-4 flex justify-center bg-brand-muted/40"><Spinner /></div>;
  }
  const docs = (data && data.documents) || [];

  return (
    <div className="bg-brand-muted/40 px-4 py-3 space-y-2">
      {error && <div className="text-xs text-red-600 font-medium">{error}</div>}
      {docs.length === 0 && <div className="text-sm text-brand-grey">No documents uploaded yet.</div>}
      {docs.map((d) => (
        <div key={d.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white rounded-xl border border-brand-border p-3">
          <div className="min-w-0">
            <div className="font-bold text-brand-dark text-sm">{DOC_LABELS[d.doc_type] || d.doc_type}</div>
            <div className="text-xs text-brand-grey">
              <Badge tone={d.status === 'verified' ? 'green' : d.status === 'rejected' ? 'red' : 'amber'}>{d.status}</Badge>
              {d.expiry_date ? ` · expires ${d.expiry_date}` : ''}
              {d.rejection_reason ? ` · ${d.rejection_reason}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {d.url && (
              <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-brand-dark border border-brand-border rounded-lg px-2.5 py-1.5 hover:bg-brand-muted">
                <ExternalLink className="w-4 h-4" /> View
              </a>
            )}
            <button type="button" onClick={() => review(d.id, 'verified')} disabled={busyId === d.id || d.status === 'verified'}
              className="inline-flex items-center gap-1 text-sm font-bold text-green-700 border border-green-200 rounded-lg px-2.5 py-1.5 hover:bg-green-50 disabled:opacity-40 cursor-pointer">
              <Check className="w-4 h-4" /> Verify
            </button>
            <button type="button" onClick={() => review(d.id, 'rejected')} disabled={busyId === d.id || d.status === 'rejected'}
              className="inline-flex items-center gap-1 text-sm font-bold text-red-600 border border-red-200 rounded-lg px-2.5 py-1.5 hover:bg-red-50 disabled:opacity-40 cursor-pointer">
              <X className="w-4 h-4" /> Reject
            </button>
          </div>
        </div>
      ))}
      {data && data.requiredTypes && (
        <div className="text-xs text-brand-grey pt-1">
          Required: {data.requiredTypes.map((t) => DOC_LABELS[t] || t).join(', ')}. The driver is auto-approved once all required documents are verified.
        </div>
      )}
    </div>
  );
}

function DriversView() {
  const [drivers, setDrivers] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDrivers((await api.adminDrivers()).drivers || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setApproval(id, approved) {
    setBusyId(id);
    setError(null);
    try {
      await api.adminApproveDriver(id, approved);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const filtered = drivers.filter((d) => {
    if (filter === 'pending') return !d.driver_approved;
    if (filter === 'approved') return d.driver_approved;
    return true;
  });

  const pendingCount = drivers.filter((d) => !d.driver_approved).length;

  return (
    <>
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-5">
        {[
          { id: 'all', label: `All (${drivers.length})` },
          { id: 'pending', label: `Pending (${pendingCount})` },
          { id: 'approved', label: `Approved (${drivers.length - pendingCount})` },
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors cursor-pointer ${
              filter === f.id
                ? 'bg-brand-black text-white border-brand-black'
                : 'bg-white text-brand-grey border-brand-border hover:text-brand-dark'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {loading && (
          <div className="p-8 flex justify-center">
            <Spinner />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-brand-grey">No drivers in this category.</div>
        )}
        {!loading &&
          filtered.map((d, i) => (
            <div key={d.id} className={i > 0 ? 'border-t border-brand-border' : ''}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-brand-muted/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-brand-orange/15 text-brand-orange flex items-center justify-center font-black shrink-0">
                    {(d.full_name || d.email || '?')[0].toUpperCase()}
                  </div>
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
                </div>
                <div className="flex items-center gap-2 shrink-0 sm:ml-4">
                  <Badge tone={d.driver_approved ? 'green' : 'amber'}>
                    {d.driver_approved ? 'Approved' : 'Pending'}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
                    className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-dark border border-brand-border rounded-xl px-3 py-2 hover:bg-brand-muted cursor-pointer"
                  >
                    <FileText className="w-4 h-4" /> Docs
                  </button>
                  {d.driver_approved ? (
                    <button
                      type="button"
                      onClick={() => setApproval(d.id, false)}
                      disabled={busyId === d.id}
                      className="inline-flex items-center gap-1.5 text-sm font-bold text-red-600 border border-red-200 rounded-xl px-3 py-2 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                    >
                      {busyId === d.id ? (
                        <Spinner />
                      ) : (
                        <>
                          <ShieldX className="w-4 h-4" /> Revoke
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setApproval(d.id, true)}
                      disabled={busyId === d.id}
                      className={btnPrimary + ' !py-2 !px-3'}
                    >
                      {busyId === d.id ? (
                        <Spinner className="!border-white/40 !border-t-white" />
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" /> Approve
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
              {expandedId === d.id && <DriverDocsPanel driverId={d.id} onReviewed={load} />}
            </div>
          ))}
      </Card>
    </>
  );
}

// --- Reports tab -----------------------------------------------------
const REPORT_RANGES = [
  { id: 'day', label: 'Today' },
  { id: 'month', label: '30 days' },
  { id: 'quarter', label: '3 months' },
  { id: 'half', label: '6 months' },
  { id: 'year', label: '1 year' },
];

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows) {
  const cols = [
    'booking_code', 'created_at', 'booking_status', 'payment_status',
    'fare_amount', 'currency', 'trip_type', 'passenger_name',
  ];
  const head = cols.join(',');
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(',')).join('\n');
  return `${head}\n${body}`;
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ReportStat({ label, value }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] font-bold uppercase tracking-wide text-brand-grey">{label}</div>
      <div className="text-2xl font-black text-brand-black mt-1 tabular-nums">{value}</div>
    </Card>
  );
}

function ReportsView() {
  const [range, setRange] = useState('month');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.adminReports(range)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  function exportCsv() {
    if (!data?.rows?.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`smartmappia-report-${range}-${stamp}.csv`, rowsToCsv(data.rows));
  }

  const t = data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {REPORT_RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            className={`px-4 py-2 rounded-full text-xs font-bold cursor-pointer transition-all ${
              range === r.id
                ? 'bg-brand-black text-white shadow-md'
                : 'bg-white text-brand-grey border border-black/5 hover:text-brand-dark'
            }`}
          >
            {r.label}
          </button>
        ))}
        <button
          type="button"
          onClick={exportCsv}
          disabled={!data?.rows?.length}
          className={btnPrimary + ' ml-auto !py-2 !px-4 disabled:opacity-50 disabled:cursor-not-allowed'}
        >
          Download CSV
        </button>
      </div>

      {error && <Card className="p-4 text-red-600 text-sm font-medium">{error}</Card>}
      {loading && <div className="flex justify-center py-16"><Spinner className="!w-7 !h-7" /></div>}

      {!loading && t && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ReportStat label="Bookings" value={t.bookings} />
            <ReportStat label="Completed" value={t.completed} />
            <ReportStat label="Cancelled" value={t.cancelled} />
            <ReportStat label="Revenue" value={`SAR ${t.revenue}`} />
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between gap-3">
              <span className="font-black text-brand-black text-sm">By {data.granularity}</span>
              <span className="text-xs text-brand-grey">
                {new Date(data.from).toLocaleDateString()} – {new Date(data.to).toLocaleDateString()}
              </span>
            </div>
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-brand-surface text-brand-grey text-xs uppercase sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 font-bold">Period</th>
                    <th className="text-right px-4 py-2 font-bold">Bookings</th>
                    <th className="text-right px-4 py-2 font-bold">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.series.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-brand-grey">No data in this range.</td></tr>
                  )}
                  {data.series.map((s) => (
                    <tr key={s.bucket} className="border-t border-brand-border">
                      <td className="px-4 py-2 text-brand-dark">{s.bucket}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.count}</td>
                      <td className="px-4 py-2 text-right tabular-nums">SAR {s.revenue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState('overview');
  const [tick, setTick] = useState(0);

  return (
    <AdminLayout
      activeTab={tab}
      onTabChange={setTab}
      onRefresh={() => setTick((t) => t + 1)}
    >
      {tab === 'overview' && <Dashboard key={`o${tick}`} onNavigate={setTab} />}
      {tab === 'bookings' && <BookingsView key={`b${tick}`} />}
      {tab === 'drivers' && <DriversView key={`d${tick}`} />}
      {tab === 'reports' && <ReportsView key={`r${tick}`} />}
    </AdminLayout>
  );
}
