// ---------------------------------------------------------------------
// The card half of paying — saved card picker, consent, and the pay button.
//
// Extracted so PaymentPanel (food/shop) and PayPage (rides, which has its
// own itemised fare layout) share one implementation instead of two that
// drift. The caller supplies the vertical's charge function.
//
// Card entry itself never happens here. Tap's hosted page collects it, so
// no card number ever reaches React state — the moment it did, this page
// would be in PCI scope.
// ---------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { api } from '../lib/api';
import { fmtSAR } from '../lib/constants';
import SavedCardPicker, { NEW_CARD } from './SavedCardPicker';
import { btnPrimary, Spinner } from './ui';

export default function CardPaySection({ code, amount, available, charge, onPaid, onError }) {
  const [methods, setMethods] = useState([]);
  const [selected, setSelected] = useState(NEW_CARD);
  const [saveCard, setSaveCard] = useState(false);
  const [busy, setBusy] = useState(false);

  // Saved cards are vertical-agnostic — one call whichever service this is.
  // A failure is non-fatal: the customer can still pay with a new card.
  useEffect(() => {
    if (!available) return;
    api
      .paymentMethods()
      .then(({ methods: list }) => {
        const usable = list || [];
        setMethods(usable);
        const preferred =
          usable.find((m) => m.is_default && !m.expired) || usable.find((m) => !m.expired);
        if (preferred) setSelected(preferred.id);
      })
      .catch(() => setMethods([]));
  }, [available]);

  if (!available) {
    return (
      <div className="w-full py-3 px-5 rounded-xl border border-dashed border-brand-border text-center text-sm text-brand-grey font-medium">
        <CreditCard className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Card payment — coming soon
      </div>
    );
  }

  const usingSaved = selected !== NEW_CARD;

  async function pay() {
    onError?.(null);
    setBusy(true);
    try {
      const result = await charge(code, {
        ...(usingSaved ? { saved_method_id: selected } : { save_card: saveCard }),
      });
      if (result && result.url) {
        // 3DS, or Tap's hosted page for a new card. The webhook confirms the
        // order while the customer is away, so they land back on a paid one.
        window.location.href = result.url;
        return;
      }
      // Captured outright: a saved card with a payment agreement, no 3DS.
      onPaid?.(result);
      setBusy(false);
    } catch (err) {
      // A decline is not a dead end. Drop back to "different card" so the
      // next tap uses another card rather than retrying the same one —
      // repeated retries of a declined card are what issuers score as
      // card testing.
      if (err.failure_reason === 'card_declined') {
        setSelected(NEW_CARD);
      } else if (err.failure_reason === 'card_unavailable' || err.failure_reason === 'card_expired') {
        // The backend has already retired it; stop offering it here too.
        setMethods((prev) => prev.filter((m) => m.id !== selected));
        setSelected(NEW_CARD);
      }
      onError?.(err.message);
      setBusy(false);
    }
  }

  return (
    <div>
      <SavedCardPicker methods={methods} value={selected} onChange={setSelected} disabled={busy} />

      {!usingSaved && (
        <label className="flex items-start gap-2.5 mb-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 accent-brand-orange"
            checked={saveCard}
            onChange={(e) => setSaveCard(e.target.checked)}
          />
          <span className="text-xs text-brand-grey leading-relaxed">
            Save this card for faster checkout. Smart Mappia will store a secure reference from our
            payment provider — never your full card number — and will only charge it when you place
            an order and confirm payment. You can remove it any time in Payment methods.
          </span>
        </label>
      )}

      <button type="button" onClick={pay} disabled={busy} className={btnPrimary + ' w-full'}>
        {busy ? (
          <Spinner className="!border-white/40 !border-t-white" />
        ) : (
          <CreditCard className="w-4 h-4" />
        )}
        {usingSaved && amount != null ? `Pay ${fmtSAR(amount)}` : 'Pay by card'}
      </button>
    </div>
  );
}
