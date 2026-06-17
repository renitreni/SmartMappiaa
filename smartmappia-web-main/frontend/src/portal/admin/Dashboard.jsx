// ---------------------------------------------------------------------
// Admin dashboard — bento layout, donut chart, quick actions.
// ---------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  Activity,
  CalendarDays,
  Clock,
  Users,
  AlertCircle,
  ArrowUpRight,
  Car,
  CreditCard,
  Shield,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import { useBroadcast } from '../lib/useBroadcast';
import { realtimeEnabled } from '../lib/supabaseClient';
import { statusMeta } from '../lib/constants';
import { Spinner } from '../components/ui';

const STATUS_COLORS = {
  pending_payment: '#F59E0B',
  payment_under_review: '#FB923C',
  confirmed: '#3B82F6',
  driver_assigned: '#6366F1',
  driver_on_the_way: '#0EA5E9',
  arrived: '#14B8A6',
  in_progress: '#10B981',
  completed: '#22C55E',
  cancelled: '#EF4444',
};

function Panel({ className = '', children }) {
  return (
    <div
      className={`bg-white rounded-[1.25rem] border border-black/[0.04] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_40px_-20px_rgba(15,23,42,0.12)] ${className}`}
    >
      {children}
    </div>
  );
}

function DonutChart({ segments, size = 168 }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  if (total === 0) {
    return (
      <div
        className="relative flex items-center justify-center rounded-full bg-brand-surface"
        style={{ width: size, height: size }}
      >
        <span className="text-xs font-semibold text-brand-grey">No data</span>
      </div>
    );
  }

  let offset = 0;
  const arcs = segments.map((seg) => {
    const pct = seg.value / total;
    const dash = pct * circumference;
    const arc = { ...seg, dash, gap: circumference - dash, offset: -offset };
    offset += dash;
    return arc;
  });

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#EEF2F7"
          strokeWidth={stroke}
        />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={stroke}
            strokeDasharray={`${arc.dash} ${arc.gap}`}
            strokeDashoffset={arc.offset}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
        <div className="text-3xl font-black text-brand-black leading-none">{total}</div>
        <div className="text-[11px] font-semibold text-brand-grey uppercase tracking-wider mt-1">
          Active pipeline
        </div>
      </div>
    </div>
  );
}

function MetricTile({ label, value, hint, icon: Icon, accent = 'slate', onClick, live = false }) {
  const accents = {
    orange: 'from-brand-orange/15 to-brand-orange/5 text-brand-orange',
    green: 'from-emerald-500/15 to-emerald-500/5 text-emerald-600',
    blue: 'from-sky-500/15 to-sky-500/5 text-sky-600',
    amber: 'from-amber-500/15 to-amber-500/5 text-amber-600',
    slate: 'from-slate-500/10 to-slate-500/5 text-slate-600',
  };
  const accentClass = accents[accent] || accents.slate;

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${accentClass} flex items-center justify-center shrink-0`}>
          <Icon className="w-5 h-5" />
        </div>
        {live && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 admin-live-dot" />
            Live
          </span>
        )}
        {onClick && !live && (
          <ArrowUpRight className="w-4 h-4 text-brand-grey/50 group-hover:text-brand-orange transition-colors" />
        )}
      </div>
      <div className="mt-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-grey">{label}</div>
        <div className="text-2xl md:text-[1.75rem] font-black text-brand-black tracking-tight mt-1">{value}</div>
        {hint && <div className="text-xs text-brand-grey mt-1">{hint}</div>}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group text-left w-full h-full p-5 md:p-6 hover:-translate-y-0.5 transition-transform cursor-pointer"
      >
        {inner}
      </button>
    );
  }

  return <div className="p-5 md:p-6 h-full">{inner}</div>;
}

function QuickAction({ title, desc, count, tone, onClick }) {
  const tones = {
    amber: 'border-amber-200/80 bg-amber-50/70 hover:bg-amber-50',
    blue: 'border-sky-200/80 bg-sky-50/70 hover:bg-sky-50',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-2xl border p-4 transition-all cursor-pointer group ${tones[tone]}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-bold text-brand-black text-sm">{title}</div>
        <span className="text-lg font-black text-brand-black">{count}</span>
      </div>
      <p className="text-xs text-brand-grey mt-1 pr-6">{desc}</p>
      <span className="inline-flex items-center gap-1 text-xs font-bold text-brand-orange mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
        Open section <ArrowUpRight className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

export default function Dashboard({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setStats(await api.adminStats());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useBroadcast('admin-bookings', { changed: load }, realtimeEnabled);

  const segments = useMemo(() => {
    if (!stats?.bookingsByStatus) return [];
    return Object.entries(stats.bookingsByStatus)
      .sort((a, b) => b[1] - a[1])
      .map(([status, value]) => ({
        key: status,
        value,
        color: STATUS_COLORS[status] || '#94A3B8',
        label: statusMeta(status).label,
      }));
  }, [stats]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28 gap-3">
        <Spinner className="!w-9 !h-9" />
        <p className="text-sm font-medium text-brand-grey">Loading your dashboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <Panel className="p-5 text-red-700 bg-red-50 border-red-100 text-sm font-medium">{error}</Panel>
    );
  }

  if (!stats) return null;

  const t = stats.totals;
  const d = stats.drivers;
  const completionRate = t.bookings > 0 ? Math.round((t.completed / t.bookings) * 100) : 0;
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6">
      {/* Hero strip */}
      <Panel className="overflow-hidden">
        <div className="relative p-6 md:p-8">
          <div className="absolute inset-0 bg-gradient-to-r from-brand-black via-[#1a2235] to-[#111827]" />
          <div className="absolute top-0 right-0 w-72 h-72 bg-brand-orange/20 rounded-full blur-3xl translate-x-1/3 -translate-y-1/2" />
          <div className="absolute bottom-0 left-1/3 w-56 h-56 bg-sky-500/10 rounded-full blur-3xl" />

          <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              <p className="text-white/50 text-xs font-semibold uppercase tracking-[0.16em] mb-2">
                {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight">{greeting}</h2>
              <p className="text-white/65 text-sm md:text-base mt-2 max-w-xl">
                You have{' '}
                <span className="text-white font-bold">{t.active} active ride{t.active === 1 ? '' : 's'}</span>
                {t.needsReview > 0 && (
                  <>
                    {' '}and{' '}
                    <span className="text-brand-orange font-bold">{t.needsReview} payment{t.needsReview === 1 ? '' : 's'}</span>{' '}
                    waiting for review
                  </>
                )}
                .
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/10 px-5 py-4 min-w-[140px]">
                <div className="text-white/50 text-[10px] font-bold uppercase tracking-wider">Revenue</div>
                <div className="text-2xl font-black text-white mt-1">SAR {t.revenue}</div>
              </div>
              <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/10 px-5 py-4 min-w-[120px]">
                <div className="text-white/50 text-[10px] font-bold uppercase tracking-wider">Completion</div>
                <div className="text-2xl font-black text-white mt-1">{completionRate}%</div>
              </div>
              <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/10 px-5 py-4 min-w-[120px]">
                <div className="text-white/50 text-[10px] font-bold uppercase tracking-wider">Drivers</div>
                <div className="text-2xl font-black text-white mt-1">{d.approved}</div>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {/* Quick actions when needed */}
      {(t.needsReview > 0 || d.pending > 0) && (
        <div className="grid sm:grid-cols-2 gap-3">
          {t.needsReview > 0 && (
            <QuickAction
              title="Payments to review"
              desc="Verify or reject uploaded payment proofs."
              count={t.needsReview}
              tone="amber"
              onClick={() => onNavigate?.('bookings')}
            />
          )}
          {d.pending > 0 && (
            <QuickAction
              title="Drivers pending approval"
              desc="New signups waiting before they can go online."
              count={d.pending}
              tone="blue"
              onClick={() => onNavigate?.('drivers')}
            />
          )}
        </div>
      )}

      {/* Bento metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Panel className="xl:col-span-2 overflow-hidden">
          <MetricTile
            label="Verified revenue"
            value={`SAR ${t.revenue}`}
            hint={`${t.bookings} total bookings in the system`}
            icon={Banknote}
            accent="green"
          />
        </Panel>
        <Panel>
          <MetricTile
            label="Active rides"
            value={t.active}
            hint="Currently in progress"
            icon={Activity}
            accent="blue"
            live={t.active > 0}
          />
        </Panel>
        <Panel>
          <MetricTile
            label="New today"
            value={t.today}
            hint="Bookings created today"
            icon={CalendarDays}
            accent="orange"
          />
        </Panel>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Panel>
          <MetricTile
            label="Awaiting payment"
            value={t.awaitingPayment}
            hint="Passengers haven't paid yet"
            icon={Clock}
            accent="amber"
            onClick={() => onNavigate?.('bookings')}
          />
        </Panel>
        <Panel>
          <MetricTile
            label="Needs review"
            value={t.needsReview}
            hint="Proofs uploaded"
            icon={AlertCircle}
            accent="amber"
            onClick={() => onNavigate?.('bookings')}
          />
        </Panel>
        <Panel>
          <MetricTile
            label="Completed"
            value={t.completed}
            hint="Successfully finished trips"
            icon={CheckCircle2}
            accent="green"
          />
        </Panel>
        <Panel>
          <MetricTile
            label="Cancelled"
            value={t.cancelled}
            hint="Cancelled bookings"
            icon={Car}
            accent="slate"
          />
        </Panel>
      </div>

      {/* Chart + side panel */}
      <div className="grid lg:grid-cols-5 gap-4">
        <Panel className="lg:col-span-3 p-6 md:p-7">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h3 className="text-lg font-black text-brand-black tracking-tight">Booking pipeline</h3>
              <p className="text-sm text-brand-grey mt-0.5">Distribution across all ride stages</p>
            </div>
          </div>

          {segments.length === 0 ? (
            <div className="py-16 text-center text-sm text-brand-grey">No bookings yet.</div>
          ) : (
            <div className="flex flex-col md:flex-row items-center gap-8 md:gap-10">
              <DonutChart segments={segments} />
              <div className="flex-1 w-full space-y-3">
                {segments.map((seg) => {
                  const total = segments.reduce((s, x) => s + x.value, 0);
                  const pct = Math.round((seg.value / total) * 100);
                  return (
                    <div key={seg.key} className="flex items-center gap-3">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: seg.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="font-semibold text-brand-dark truncate">{seg.label}</span>
                          <span className="font-black text-brand-black shrink-0">{seg.value}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-brand-surface overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: seg.color }}
                          />
                        </div>
                      </div>
                      <span className="text-xs font-bold text-brand-grey w-8 text-right shrink-0">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Panel>

        <Panel className="lg:col-span-2 p-6 md:p-7 flex flex-col">
          <h3 className="text-lg font-black text-brand-black tracking-tight">Operations</h3>
          <p className="text-sm text-brand-grey mt-0.5 mb-5">Shortcuts and fleet overview</p>

          <div className="space-y-3 flex-1">
            <button
              type="button"
              onClick={() => onNavigate?.('bookings')}
              className="w-full flex items-center gap-3 p-4 rounded-2xl bg-brand-muted hover:bg-brand-surface border border-black/[0.03] cursor-pointer transition-colors text-left group"
            >
              <div className="w-10 h-10 rounded-xl bg-brand-orange/15 text-brand-orange flex items-center justify-center">
                <CreditCard className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-brand-black">Review bookings</div>
                <div className="text-xs text-brand-grey">{t.awaitingPayment + t.needsReview} need action</div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-brand-grey group-hover:text-brand-orange transition-colors" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate?.('drivers')}
              className="w-full flex items-center gap-3 p-4 rounded-2xl bg-brand-muted hover:bg-brand-surface border border-black/[0.03] cursor-pointer transition-colors text-left group"
            >
              <div className="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-600 flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-brand-black">Manage drivers</div>
                <div className="text-xs text-brand-grey">{d.approved} approved · {d.pending} pending</div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-brand-grey group-hover:text-brand-orange transition-colors" />
            </button>

            <div className="rounded-2xl bg-gradient-to-br from-brand-black to-[#1a2235] p-5 text-white mt-2">
              <div className="flex items-center gap-2 text-brand-orange mb-2">
                <Zap className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Fleet status</span>
              </div>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-3xl font-black">{d.approved}</div>
                  <div className="text-xs text-white/55 mt-1">Approved drivers</div>
                </div>
                <div className="text-right">
                  <div className="inline-flex items-center gap-1.5 text-emerald-400 text-sm font-bold">
                    <Shield className="w-4 h-4" />
                    {d.total - d.pending} active
                  </div>
                  <div className="text-xs text-white/45 mt-1">{d.pending} awaiting review</div>
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
