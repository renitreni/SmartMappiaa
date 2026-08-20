// ---------------------------------------------------------------------
// "You can pay by card on the next step."
//
// The step-1 pickers choose how the ORDER is created, and the backend enums
// (routes/food.js, routes/shop.js) refuse card there on purpose: an order
// must never be created against a gateway that might be unconfigured. Card
// is chosen at the payment step instead.
//
// That left all three verticals silently offering card one screen after a
// picker that never mentioned it — and food actively said "coming soon"
// while the next screen took card fine. This is the one line that makes the
// picker honest, and it renders only when the gateway really is live.
// ---------------------------------------------------------------------
import { CreditCard } from 'lucide-react';
import useCardAvailable from '../lib/useCardAvailable';

export default function CardNextStepNote() {
  const available = useCardAvailable();
  if (!available) return null;

  return (
    <p className="mt-3 flex items-start gap-2 text-xs text-brand-grey">
      <CreditCard className="w-3.5 h-3.5 mt-0.5 shrink-0 text-brand-orange" />
      <span>
        Prefer to pay by card? Place the order, then choose <strong className="font-bold text-brand-dark">Card</strong> on
        the payment step.
      </span>
    </p>
  );
}
