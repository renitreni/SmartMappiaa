// ---------------------------------------------------------------------
// Small shared UI atoms for the portals.
// ---------------------------------------------------------------------
import { Link } from 'react-router-dom';
import { ArrowLeft, LogOut } from 'lucide-react';
import { TONE_CLASSES } from '../lib/constants';
import { useAuth } from '../lib/AuthProvider';

export function PortalShell({ title, subtitle, right, onBack, children, wide = false }) {
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-brand-muted">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-brand-border">
        <div className={`${wide ? 'max-w-7xl' : 'max-w-5xl'} mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-1 shrink-0">
            {onBack && (
              <button
                onClick={onBack}
                title="Back"
                className="p-2 -ml-1 rounded-lg hover:bg-brand-surface cursor-pointer text-brand-dark"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <Link to="/" className="flex items-center gap-2">
              <img src="/mappia-new-logo.png" alt="Smart Mappia" className="w-9 h-9 object-contain" />
              <span className="font-black tracking-tight text-brand-black hidden sm:block">
                Smart <span className="text-brand-orange">Mappia</span>
              </span>
            </Link>
          </div>
          <div className="text-center leading-tight min-w-0">
            <div className="font-black text-brand-black truncate">{title}</div>
            {subtitle && <div className="text-xs text-brand-grey truncate">{subtitle}</div>}
          </div>
          <div className="shrink-0 flex items-center gap-1">
            {right}
            {user && (
              <>
                <span className="text-xs text-brand-grey font-medium max-w-[140px] truncate hidden md:block">{user.email}</span>
                <button onClick={() => signOut()} title="Sign out" className="p-2 rounded-lg hover:bg-brand-surface cursor-pointer text-brand-grey">
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className={`${wide ? 'max-w-7xl' : 'max-w-5xl'} mx-auto px-4 md:px-6 py-5 md:py-6`}>{children}</main>
    </div>
  );
}

export function Badge({ tone = 'grey', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
        TONE_CLASSES[tone] || TONE_CLASSES.grey
      } ${className}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block w-5 h-5 border-2 border-brand-orange/30 border-t-brand-orange rounded-full animate-spin ${className}`}
    />
  );
}

export function Card({ children, className = '' }) {
  return (
    <div className={`bg-white border border-brand-border rounded-2xl shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-brand-grey uppercase tracking-wider block mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full bg-white border border-brand-border rounded-xl px-4 py-3 text-brand-dark text-sm ' +
  'focus:outline-none focus:border-brand-orange transition-colors';

// Styled <input type="file"> — orange "choose file" button + standard input look.
export const fileInputClass =
  inputClass +
  ' cursor-pointer file:mr-3 file:rounded-lg file:border-0 file:bg-brand-orange ' +
  'file:text-white file:px-3 file:py-1.5 file:font-bold';

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 bg-brand-orange hover:bg-brand-orange/90 ' +
  'text-white font-black py-3 px-5 rounded-xl transition-all shadow-lg shadow-brand-orange/20 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed text-sm cursor-pointer';

export const btnGhost =
  'inline-flex items-center justify-center gap-2 bg-white hover:bg-brand-surface ' +
  'text-brand-dark font-bold py-3 px-5 rounded-xl border border-brand-border transition-all ' +
  'disabled:opacity-50 disabled:cursor-not-allowed text-sm cursor-pointer';
