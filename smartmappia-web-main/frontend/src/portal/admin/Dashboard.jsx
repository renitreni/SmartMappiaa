// ---------------------------------------------------------------------
// Admin dashboard — the at-a-glance overview admins land on after login.
// Pulls aggregate stats from GET /api/admin/stats and live-refreshes.
// ---------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Banknote, ClipboardList, CheckCircle2, Activity, CalendarDays, Clock, Users, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useBroadcast } from '../lib/useBroadcast';
import { realtimeEnabled } from '../lib/supabaseClient';
import { statusMeta } from '../lib/constants';
import { Card, Spinner, Badge } from '../components/ui';

const TONE_BG = {
  orange: 'bg-brand-orange/10 text-brand-orange',
  green: 'bg-green-50 text-green-600',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  grey: 'bg-brand-surface text-brand-grey',
};

function StatCard({ icon: Icon, label, value, sub, tone = 'orange' }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${TONE_BG[tone]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-black text-brand-black leading-tight truncate">{value}</div>
          <div className="text-[11px] font-bold text-brand-grey uppercase tracking-wide">{label}</div>
        </div>
      </div>
      {sub && <div className="text-xs text-brand-grey mt-2">{sub}</div>}
    </Card>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setStats(await api.adminStats()); setError(null); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useBroadcast('admin-bookings', { changed: load }, realtimeEnabled);

  if (loading) return <div className="flex justify-center py-16"><Spinner className="!w-8 !h-8" /></div>;
  if (error) return <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">{error}</div>;
  if (!stats) return null;

  const t = stats.totals;
  const d = stats.drivers;
  const byStatus = Object.entries(stats.bookingsByStatus || {}).sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(1, ...byStatus.map(([, n]) => n));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Banknote} tone="green" label="Revenue (verified)" value={`SAR ${t.revenue}`} sub={`${t.bookings} total bookings`} />
        <StatCard icon={CheckCircle2} tone="green" label="Completed" value={t.completed} />
        <StatCard icon={Activity} tone="blue" label="Active rides" value={t.active} />
        <StatCard icon={CalendarDays} tone="orange" label="Today" value={t.today} sub="new bookings" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={AlertCircle} tone="amber" label="Needs review" value={t.needsReview} sub="payment proofs waiting" />
        <StatCard icon={Clock} tone="grey" label="Awaiting payment" value={t.awaitingPayment} />
        <StatCard icon={Users} tone="blue" label="Drivers approved" value={d.approved} sub={`${d.pending} pending approval`} />
        <StatCard icon={ClipboardList} tone="grey" label="Cancelled" value={t.cancelled} />
      </div>

      <Card className="p-5">
        <div className="font-black text-brand-black mb-3">Bookings by status</div>
        {byStatus.length === 0 && <div className="text-sm text-brand-grey">No bookings yet.</div>}
        <div className="space-y-2.5">
          {byStatus.map(([status, n]) => {
            const meta = statusMeta(status);
            return (
              <div key={status} className="flex items-center gap-3">
                <div className="w-44 shrink-0"><Badge tone={meta.tone}>{meta.label}</Badge></div>
                <div className="flex-1 bg-brand-surface rounded-full h-2 overflow-hidden">
                  <div className="h-full bg-brand-orange rounded-full" style={{ width: `${(n / maxCount) * 100}%` }} />
                </div>
                <div className="w-8 text-right text-sm font-bold text-brand-dark">{n}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
