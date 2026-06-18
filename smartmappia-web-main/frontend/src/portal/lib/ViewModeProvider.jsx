// ---------------------------------------------------------------------
// Admin "preview as" view mode (frontend-only).
//
// Lets a signed-in ADMIN render the user (/book) or driver (/driver) portal
// WITHOUT changing their Supabase session/JWT — they stay authenticated as
// admin the whole time. The chosen preview role is kept in React state +
// sessionStorage so a page refresh keeps the preview. This is NOT a backend
// session concept; backend access still rides on the admin's real JWT.
// ---------------------------------------------------------------------
import { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, ArrowLeft } from 'lucide-react';
import { useAuth } from './AuthProvider';

const ViewModeCtx = createContext(null);
const PREVIEW_KEY = 'sm_admin_preview';
const VALID = ['passenger', 'driver'];

function readStored() {
  try {
    const v = sessionStorage.getItem(PREVIEW_KEY);
    return VALID.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function ViewModeProvider({ children }) {
  const { session, role } = useAuth();
  const [previewRole, setPreviewRoleState] = useState(readStored);

  function setPreviewRole(next) {
    const value = VALID.includes(next) ? next : null;
    setPreviewRoleState(value);
    try {
      if (value) sessionStorage.setItem(PREVIEW_KEY, value);
      else sessionStorage.removeItem(PREVIEW_KEY);
    } catch {
      /* sessionStorage unavailable — keep in-memory only */
    }
  }

  // Preview is an admin-only affordance: drop it if the user signs out or the
  // resolved role is anything other than admin.
  useEffect(() => {
    if (previewRole && (!session || role !== 'admin')) {
      setPreviewRole(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, role]);

  const value = {
    // Only honor the preview when the real role is admin.
    previewRole: role === 'admin' ? previewRole : null,
    setPreviewRole,
  };

  return <ViewModeCtx.Provider value={value}>{children}</ViewModeCtx.Provider>;
}

export function useViewMode() {
  const ctx = useContext(ViewModeCtx);
  if (!ctx) throw new Error('useViewMode must be used within <ViewModeProvider>');
  return ctx;
}

const LABELS = { passenger: 'User', driver: 'Driver' };

// Persistent banner shown on every page while an admin is previewing, so it's
// never ambiguous which mode is active. "Back to Admin View" exits the preview.
export function PreviewBanner() {
  const { previewRole, setPreviewRole } = useViewMode();
  const navigate = useNavigate();

  function backToAdmin() {
    setPreviewRole(null);
    navigate('/admin');
  }

  return (
    <AnimatePresence>
      {previewRole && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 rounded-2xl bg-brand-black text-white shadow-2xl border border-white/10 pl-4 pr-2 py-2"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <Eye className="w-4 h-4 text-brand-orange" />
            Previewing as {LABELS[previewRole] || previewRole}
          </span>
          <button
            type="button"
            onClick={backToAdmin}
            className="inline-flex items-center gap-1.5 text-xs font-bold bg-brand-orange hover:bg-brand-orange/90 text-white px-3 py-2 rounded-xl cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Admin View
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
