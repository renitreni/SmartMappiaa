// ---------------------------------------------------------------------
// Shared constants + small presentation helpers for the portals.
// ---------------------------------------------------------------------

// Where each role lands after signing in (admins always go to their dashboard).
// Users land on the multi-service hub (/home) — Pick & Drop and Food Delivery
// are equal citizens — honoring an explicit non-root `next` first.
export function roleHome(role, next = '/') {
  if (role === 'admin') return '/admin';
  if (role === 'driver') return '/driver';
  if (role === 'merchant') return '/merchant';
  // Passengers: honor an explicit `next`, but never follow a stale one into an
  // account-type dashboard (e.g. ?next=/admin left over after switching accounts).
  const safeNext =
    next &&
    next !== '/' &&
    !next.startsWith('/admin') &&
    !next.startsWith('/driver') &&
    !next.startsWith('/merchant');
  return safeNext ? next : '/home';
}

// Fare model (mirrors backend lib/fare.js): flat base + 3.75% service fee.
export const FARE_BASE = 100;
export const SERVICE_FEE_RATE = 0.0375;

export function fareBreakdown() {
  const base = FARE_BASE;
  const serviceFee = Math.round(base * SERVICE_FEE_RATE * 100) / 100;
  const total = Math.round((base + serviceFee) * 100) / 100;
  return { base, serviceFeeRate: SERVICE_FEE_RATE, serviceFeePercent: +(SERVICE_FEE_RATE * 100).toFixed(2), serviceFee, total };
}

// Riyadh airports with approximate coordinates (used for map + matching).
export const AIRPORTS = [
  { id: 'kkia_t1', name: 'King Khalid Intl — Terminal 1', lat: 24.9576, lng: 46.7012 },
  { id: 'kkia_t2', name: 'King Khalid Intl — Terminal 2', lat: 24.9618, lng: 46.6952 },
  { id: 'kkia_t5', name: 'King Khalid Intl — Terminal 5', lat: 24.9489, lng: 46.7026 },
];

/** Dropdown options with terminal name prominent and airport as secondary line. */
export function airportDropdownOptions() {
  return AIRPORTS.map((a) => {
    const sep = a.name.indexOf(' — ');
    if (sep === -1) return { value: a.id, label: a.name };
    return { value: a.id, label: a.name.slice(sep + 3), sublabel: a.name.slice(0, sep) };
  });
}

export const RIYADH_CENTER = { lat: 24.7136, lng: 46.6753 };

// Human-friendly labels + colors for booking statuses.
export const BOOKING_STATUS = {
  pending_payment: { label: 'Awaiting payment', tone: 'amber' },
  payment_under_review: { label: 'Payment under review', tone: 'amber' },
  confirmed: { label: 'Finding your driver', tone: 'blue' },
  driver_assigned: { label: 'Driver assigned', tone: 'blue' },
  driver_on_the_way: { label: 'Driver on the way', tone: 'blue' },
  arrived: { label: 'Driver has arrived', tone: 'green' },
  in_progress: { label: 'On the trip', tone: 'green' },
  completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

export const TONE_CLASSES = {
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  green: 'bg-green-50 text-green-700 border-green-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  grey: 'bg-brand-surface text-brand-grey border-brand-border',
};

export function statusMeta(bookingStatus) {
  return BOOKING_STATUS[bookingStatus] || { label: bookingStatus || 'Unknown', tone: 'grey' };
}

// Human-friendly labels + colors for Pick & Drop payment statuses (mirrors
// the payment_status enum in the DB). Used by the Transaction Records hub.
export const RIDE_PAYMENT_STATUS = {
  awaiting_proof: { label: 'Awaiting payment', tone: 'amber' },
  proof_uploaded: { label: 'Payment under review', tone: 'amber' },
  under_review: { label: 'Payment under review', tone: 'amber' },
  verified: { label: 'Paid', tone: 'green' },
  rejected: { label: 'Payment rejected', tone: 'red' },
  refunded: { label: 'Refunded', tone: 'grey' },
};

export function ridePaymentMeta(status) {
  return RIDE_PAYMENT_STATUS[status] || { label: status || 'Unknown', tone: 'grey' };
}

// Build a WhatsApp deep link from a phone number (strips non-digits).
export function whatsappLink(number, text) {
  if (!number) return null;
  const digits = String(number).replace(/[^\d]/g, '');
  if (!digits) return null;
  const q = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits}${q}`;
}

// Statuses where the passenger may still cancel (mirrors the backend rule).
export const CANCELLABLE = [
  'pending_payment',
  'payment_under_review',
  'confirmed',
  'driver_assigned',
  'driver_on_the_way',
  'arrived',
];

// --- Food Delivery ---------------------------------------------------

// Business rules mirrored from backend lib/foodMoney.js for DISPLAY ONLY —
// the server re-validates all of them at checkout/accept.
export const FOOD_MIN_ORDER = 30;
export const FOOD_DELIVERY_FEE = 10;
export const FOOD_RADIUS_KM = 15;
export const MERCHANT_CREDIT_LIMIT = 300;
export const MERCHANT_CREDIT_ALERT = 240; // 80% of the 300 SAR limit

// Currency shown as `SAR 30.00` consistently across the food screens.
export function fmtSAR(amount) {
  return `SAR ${Number(amount ?? 0).toFixed(2)}`;
}

// Human-friendly labels + colors for food order statuses.
export const FOOD_ORDER_STATUS = {
  pending: { label: 'Pending', tone: 'amber' },
  accepted: { label: 'Accepted', tone: 'blue' },
  preparing: { label: 'Preparing', tone: 'blue' },
  ready: { label: 'Ready', tone: 'blue' },
  out_for_delivery: { label: 'Out for delivery', tone: 'blue' },
  delivered: { label: 'Delivered', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'red' },
  rejected: { label: 'Rejected', tone: 'red' },
};

export const FOOD_PAYMENT_STATUS = {
  awaiting: { label: 'Awaiting payment', tone: 'amber' },
  paid: { label: 'Paid', tone: 'green' },
  failed: { label: 'Payment failed', tone: 'red' },
  refunded: { label: 'Refunded', tone: 'grey' },
};

export function foodStatusMeta(status) {
  return FOOD_ORDER_STATUS[status] || { label: status || 'Unknown', tone: 'grey' };
}

export function foodPaymentMeta(status) {
  return FOOD_PAYMENT_STATUS[status] || { label: status || 'Unknown', tone: 'grey' };
}

// The fulfillment ladder shown on the tracking stepper. `desc` is the
// notification-style line shown under the currently active step.
export const FOOD_TRACK_STEPS = [
  { id: 'pending', label: 'Order placed', desc: 'Waiting for the restaurant to confirm your order.' },
  { id: 'accepted', label: 'Confirmed', desc: 'The restaurant confirmed your order.' },
  { id: 'preparing', label: 'Preparing', desc: 'The restaurant is preparing your order.' },
  { id: 'ready', label: 'Ready', desc: 'Your order is ready and waiting for the rider.' },
  { id: 'out_for_delivery', label: 'Out for delivery', desc: 'Your rider picked up the order and is on the way to you.' },
  { id: 'delivered', label: 'Delivered', desc: 'Enjoy your meal.' },
];

export const FOOD_PAYMENT_METHODS = {
  stcpay: 'STC Pay',
  tap: 'Card (Tap)',
  cash: 'Cash on delivery',
};
