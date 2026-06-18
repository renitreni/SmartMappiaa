// ---------------------------------------------------------------------
// Admin shell — dark sidebar, light workspace, responsive navigation.
// ---------------------------------------------------------------------
import { Link, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  RefreshCw,
  LogOut,
  Menu,
  X,
  ExternalLink,
  Bell,
  ChevronDown,
  Eye,
  User,
  Car,
  ArrowLeft,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../lib/AuthProvider';
import { useViewMode } from '../lib/ViewModeProvider';

// Admin-only action menu that replaces the old Refresh button. Lets the admin
// refresh data or preview the user/driver portal WITHOUT logging out (the
// Supabase session/JWT stays admin — see ViewModeProvider). Only ever rendered
// inside AdminLayout, which itself is gated by RequireAuth role="admin".
function ViewSwitchMenu({ onRefresh }) {
  const navigate = useNavigate();
  const { previewRole, setPreviewRole } = useViewMode();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onClickAway(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function run(fn) {
    setOpen(false);
    fn();
  }

  const items = [
    { key: 'refresh', label: 'Refresh', icon: RefreshCw, action: () => onRefresh && onRefresh() },
    { key: 'user', label: 'Switch to User View', icon: User, action: () => { setPreviewRole('passenger'); navigate('/book'); } },
    { key: 'driver', label: 'Switch to Driver View', icon: Car, action: () => { setPreviewRole('driver'); navigate('/driver'); } },
  ];
  if (previewRole) {
    items.push({ key: 'back', label: 'Back to Admin View', icon: ArrowLeft, action: () => { setPreviewRole(null); navigate('/admin'); } });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 p-2.5 sm:px-3 sm:py-2.5 rounded-xl bg-white border text-brand-grey hover:text-brand-dark cursor-pointer shadow-sm transition-colors ${
          open ? 'border-brand-orange/40 text-brand-dark' : 'border-black/5'
        }`}
        title="View options"
      >
        <Eye className="w-4 h-4" />
        <span className="hidden sm:inline text-xs font-bold">View</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-56"
            role="menu"
          >
            <ul className="bg-white border border-brand-border rounded-xl shadow-xl shadow-brand-orange/10 py-1.5">
              {items.map(({ key, label, icon: Icon, action }) => (
                <li key={key} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => run(action)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left text-brand-dark hover:bg-brand-surface hover:text-brand-orange transition-colors cursor-pointer"
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="font-medium">{label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const ADMIN_NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'bookings', label: 'Bookings', icon: ClipboardList },
  { id: 'drivers', label: 'Drivers', icon: Users },
];

const PAGE_COPY = {
  overview: {
    title: 'Dashboard',
    subtitle: 'Monitor bookings, payments, and drivers at a glance.',
  },
  bookings: {
    title: 'Bookings',
    subtitle: 'Review payment proofs and manage ride requests.',
  },
  drivers: {
    title: 'Drivers',
    subtitle: 'Approve new drivers and manage fleet access.',
  },
};

export default function AdminLayout({ activeTab, onTabChange, onRefresh, children }) {
  const { user, signOut } = useAuth();
  const [mobileNav, setMobileNav] = useState(false);
  const copy = PAGE_COPY[activeTab] || PAGE_COPY.overview;
  const initial = (user?.email || 'A')[0].toUpperCase();

  function selectTab(id) {
    onTabChange(id);
    setMobileNav(false);
  }

  function NavButton({ id, label, icon: Icon, compact = false }) {
    const isActive = activeTab === id;
    return (
      <button
        type="button"
        onClick={() => selectTab(id)}
        className={`w-full flex items-center gap-3 rounded-xl text-left transition-all cursor-pointer ${
          compact ? 'px-3 py-2.5' : 'px-3 py-3'
        } ${
          isActive
            ? 'bg-white/10 text-white shadow-inner shadow-black/10'
            : 'text-white/55 hover:text-white hover:bg-white/5'
        }`}
      >
        <span
          className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${
            isActive ? 'bg-brand-orange text-white' : 'bg-white/5 text-white/70'
          }`}
        >
          <Icon className="w-[18px] h-[18px]" />
        </span>
        <span className="text-sm font-semibold tracking-tight">{label}</span>
        {isActive && !compact && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-orange shrink-0" />
        )}
      </button>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#0c1018]">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-[260px] shrink-0 flex-col border-r border-white/5">
        <div className="h-[72px] px-5 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-3 min-w-0 group">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 group-hover:bg-white/15 transition-colors">
              <img src="/mappia-new-logo.png" alt="" className="w-7 h-7 object-contain" />
            </div>
            <div className="min-w-0">
              <div className="font-black text-white text-sm tracking-tight leading-none">
                Smart <span className="text-brand-orange">Mappia</span>
              </div>
              <div className="text-[10px] font-semibold text-white/40 uppercase tracking-[0.14em] mt-1">
                Control center
              </div>
            </div>
          </Link>
        </div>

        <div className="px-4 mb-2">
          <p className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/30 mb-2">
            Menu
          </p>
          <nav className="space-y-1">
            {ADMIN_NAV.map(({ id, label, icon }) => (
              <NavButton key={id} id={id} label={label} icon={icon} />
            ))}
          </nav>
        </div>

        <div className="mt-auto p-4">
          <div className="rounded-2xl bg-white/[0.04] border border-white/8 p-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-orange to-brand-red text-white flex items-center justify-center font-black text-sm shrink-0">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-white truncate">{user?.email}</div>
                <div className="text-[10px] text-white/45 font-medium mt-0.5">Administrator</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => signOut()}
              className="mt-3 w-full flex items-center justify-center gap-2 text-xs font-semibold text-white/60 hover:text-white py-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Main workspace */}
      <div className="flex-1 flex flex-col min-w-0 admin-shell-bg">
        <header className="sticky top-0 z-30 bg-[#eef1f6]/80 backdrop-blur-xl border-b border-black/5">
          <div className="h-[72px] px-4 md:px-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNav(true)}
                className="lg:hidden p-2.5 rounded-xl bg-white shadow-sm border border-black/5 cursor-pointer"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5 text-brand-dark" />
              </button>
              <div className="min-w-0">
                <h1 className="text-xl md:text-2xl font-black text-brand-black tracking-tight truncate">
                  {copy.title}
                </h1>
                <p className="text-sm text-brand-grey truncate hidden sm:block">{copy.subtitle}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="hidden sm:flex p-2.5 rounded-xl bg-white border border-black/5 text-brand-grey hover:text-brand-dark cursor-pointer shadow-sm"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
              </button>
              <ViewSwitchMenu onRefresh={onRefresh} />
              <Link
                to="/"
                className="hidden sm:inline-flex items-center gap-1.5 text-xs font-bold text-brand-dark bg-white border border-black/5 px-3.5 py-2.5 rounded-xl shadow-sm hover:border-brand-orange/30 hover:text-brand-orange transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View site
              </Link>
            </div>
          </div>

          {/* Mobile tabs */}
          <div className="lg:hidden flex gap-2 px-4 pb-3 overflow-x-auto">
            {ADMIN_NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => selectTab(id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap cursor-pointer transition-all ${
                  activeTab === id
                    ? 'bg-brand-black text-white shadow-md'
                    : 'bg-white text-brand-grey border border-black/5'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 py-6 md:py-8 w-full max-w-[1400px]">
          {children}
        </main>
      </div>

      {/* Mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 cursor-pointer backdrop-blur-sm"
            aria-label="Close menu"
            onClick={() => setMobileNav(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-[280px] bg-[#0c1018] shadow-2xl flex flex-col">
            <div className="h-[72px] px-4 flex items-center justify-between border-b border-white/5">
              <span className="font-black text-white text-sm">Smart Mappia</span>
              <button
                type="button"
                onClick={() => setMobileNav(false)}
                className="p-2 rounded-lg hover:bg-white/5 cursor-pointer text-white/70"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {ADMIN_NAV.map(({ id, label, icon }) => (
                <NavButton key={id} id={id} label={label} icon={icon} compact />
              ))}
            </nav>
            <div className="p-4 border-t border-white/5">
              <button
                type="button"
                onClick={() => signOut()}
                className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-white/60 py-2.5 rounded-xl border border-white/10 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
