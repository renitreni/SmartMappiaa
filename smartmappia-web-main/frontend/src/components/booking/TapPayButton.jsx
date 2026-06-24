// ---------------------------------------------------------------------
// "Pay online" button for the Tap Payments hosted-redirect flow
// (STC Pay / mada / cards).
//
// PLACEHOLDER until the Tap merchant API + backend endpoint are live:
//   - Flip `VITE_TAP_ENABLED=true` (and build the backend
//     POST /api/payments/:code/tap-charge) to turn it on.
//   - Until then this shows a friendly "coming soon" note and the manual
//     STC Pay transfer (rendered below this button) stays the working path.
//
// Real flow (when enabled): backend creates a Tap Charge and returns the
// hosted redirect URL; we send the user there. The Tap webhook is the
// source of truth that confirms the booking (see docs/production/NOTES.md §2).
// On Capacitor, swap `window.location.href` for `Browser.open(redirectUrl)`.
// ---------------------------------------------------------------------
import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import Swal from 'sweetalert2';
import { api } from '../../portal/lib/api';

const TAP_ENABLED = import.meta.env.VITE_TAP_ENABLED === 'true';

export default function TapPayButton({ bookingCode, className = '' }) {
  const [busy, setBusy] = useState(false);

  async function pay() {
    if (!TAP_ENABLED) {
      Swal.fire({
        icon: 'info',
        title: 'Online payment coming soon',
        html:
          'Paying by <b>STC Pay</b>, mada, or card through <b>Tap Payments</b> will be enabled ' +
          'shortly.<br/>For now, please use the manual STC Pay transfer below.',
        confirmButtonText: 'OK',
        confirmButtonColor: '#FF7E21',
      });
      return;
    }
    try {
      setBusy(true);
      const { redirectUrl } = await api.createTapCharge(bookingCode);
      window.location.href = redirectUrl; // Capacitor: Browser.open(redirectUrl)
    } catch {
      setBusy(false); // the API client already surfaces the error popup
    }
  }

  return (
    <button
      type="button"
      onClick={pay}
      disabled={busy}
      className={
        'w-full inline-flex items-center justify-center gap-2 bg-brand-dark hover:bg-black ' +
        'text-white font-black py-3.5 rounded-xl text-sm transition-colors ' +
        'disabled:opacity-50 cursor-pointer ' +
        className
      }
    >
      <CreditCard className="w-4 h-4" />
      Pay online — STC Pay / mada / card
      {!TAP_ENABLED && (
        <span className="ml-1 text-[10px] font-bold uppercase bg-white/20 px-1.5 py-0.5 rounded">
          Soon
        </span>
      )}
    </button>
  );
}
