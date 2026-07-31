// ---------------------------------------------------------------------
// Food Delivery — live tracking: /food/track/:code
// Grab-style: real-time status stepper (broadcast + 8s polling fallback),
// a LIVE MAP with the rider's pin gliding on every GPS ping, the
// restaurant card, and the rider card (name + in-app Call and WhatsApp).
// Payment panel appears inline while the order is awaiting payment.
// ---------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Check,
  UtensilsCrossed,
  Bike,
  Phone,
  MessageCircle,
  MapPin,
  XCircle,
  ReceiptText,
  Heart,
  Download,
  Clock,
  Store,
  Loader2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthProvider';
import { useBroadcast } from '../lib/useBroadcast';
import { realtimeEnabled } from '../lib/supabaseClient';
import { downloadFoodInvoice } from '../lib/invoice';
import {
  fmtSAR,
  vatLabel,
  whatsappLink,
  foodStatusMeta,
  foodPaymentMeta,
  FOOD_TRACK_STEPS,
  FOOD_PAYMENT_METHODS,
} from '../lib/constants';
import { bearingDeg } from '../lib/geo';
import { PortalShell, Card, Badge, Spinner, btnGhost } from '../components/ui';
import RoutedRideMap from '../components/RoutedRideMap';
import RateDriver from '../components/RateDriver';
import EditableContact from '../components/EditableContact';

// Mini car glyph for the map legend's Rider chip (matches the map marker).
const LEGEND_CAR_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2.7-5.4A2 2 0 0 0 13.5 3h-3A2 2 0 0 0 8.7 4.6L6 10l-2.5 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/>' +
  '<circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>';
import PaymentPanel from './PaymentPanel';

const POLL_MS = 8000;

function StatusStepper({ status }) {
  const failed = status === 'cancelled' || status === 'rejected';
  const activeIdx = FOOD_TRACK_STEPS.findIndex((s) => s.id === status);
  return (
    <div className="space-y-0">
      {FOOD_TRACK_STEPS.map((step, i) => {
        const done = !failed && activeIdx > i;
        const active = !failed && activeIdx === i;
        return (
          <div key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border-2 ${
                  done
                    ? 'bg-brand-orange border-brand-orange text-white'
                    : active
                      ? 'border-brand-orange text-brand-orange'
                      : 'border-brand-border text-transparent'
                }`}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : <span className={`w-2 h-2 rounded-full ${active ? 'bg-brand-orange animate-pulse' : ''}`} />}
              </div>
              {i < FOOD_TRACK_STEPS.length - 1 && (
                <div className={`w-0.5 flex-1 min-h-5 ${done ? 'bg-brand-orange' : 'bg-brand-border'}`} />
              )}
            </div>
            <div className="pb-5 min-w-0">
              <p className={`text-sm font-bold ${done || active ? 'text-brand-dark' : 'text-brand-grey/60'}`}>
                {step.label}
                {active && <span className="ml-2 text-xs font-medium text-brand-orange">Now</span>}
              </p>
              {active && step.desc && (
                <p className="text-xs text-brand-grey mt-0.5">{step.desc}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Coarse "what phase are we in" copy for the ETA hero. Kept here (not per-order)
// so the upcoming ecommerce order-status page can supply its own phase map and
// reuse <TrackHeader> unchanged.
const FOOD_TRACK_PHASE = {
  pending: { eta: 'Confirming', note: 'Waiting for the restaurant to confirm your order' },
  accepted: { eta: '25 – 45 mins', note: 'Preparing your order' },
  preparing: { eta: '25 – 45 mins', note: 'Preparing your order' },
  ready: { eta: '15 – 25 mins', note: "Ready — waiting for a rider to pick it up" },
  out_for_delivery: { eta: 'On the way', note: 'Your rider is heading to you' },
  delivered: { eta: 'Delivered', note: 'Enjoy your meal!' },
};

// Reusable ETA hero + slim progress bar (props in, no fetching) — shared shape
// for food today and ecommerce order status later.
function TrackHeader({ eta, note, progress, live }) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-5 bg-gradient-to-br from-brand-orange/10 to-white">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-3xl font-black text-brand-black leading-none tabular-nums">{eta}</p>
            <p className="text-sm font-bold text-brand-dark mt-2">{note}</p>
          </div>
          <div className="w-14 h-14 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0">
            <Clock className="w-7 h-7 text-brand-orange" />
          </div>
        </div>
        {live && (
          <span className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold text-green-600 uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Live
          </span>
        )}
      </div>
      <div className="h-1.5 bg-brand-border">
        <div
          className="h-full bg-brand-orange transition-all duration-500"
          style={{ width: `${Math.round(Math.max(0.04, progress) * 100)}%` }}
        />
      </div>
    </Card>
  );
}

// Order-details block (order number / from / delivery address / total).
function OrderMetaCard({ code, from, address, total }) {
  return (
    <Card className="p-5 space-y-3">
      <p className="font-black text-brand-black">Order details</p>
      <Row label="Order number" value={<span className="font-mono font-bold text-brand-dark">{code}</span>} />
      {from && (
        <Row
          label="Order from"
          value={<span className="font-bold text-brand-dark inline-flex items-center gap-1.5"><Store className="w-3.5 h-3.5 text-brand-orange" /> {from}</span>}
        />
      )}
      {address && <Row label="Delivery address" value={<span className="text-brand-dark text-right">{address}</span>} />}
      {total != null && <Row label="Total" value={<span className="font-black text-brand-orange tabular-nums">{fmtSAR(total)}</span>} />}
    </Card>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-brand-grey shrink-0">{label}</span>
      <span className="min-w-0">{value}</span>
    </div>
  );
}

// The Grab-style rider card: who is bringing the food + one-tap contact.
function RiderCard({ rider, etaMinutes }) {
  const initial = (rider.name || 'R')[0].toUpperCase();
  return (
    <Card className="p-5">
      <p className="text-xs font-bold text-brand-grey uppercase tracking-wider mb-3">Your delivery rider</p>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-orange to-brand-red text-white flex items-center justify-center font-black text-lg shrink-0">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-brand-black truncate">{rider.name || 'Rider assigned'}</p>
          <p className="text-xs text-brand-grey flex items-center gap-1">
            <Bike className="w-3.5 h-3.5" /> Smart Mappia rider
          </p>
        </div>
        {etaMinutes != null && (
          <div className="text-right shrink-0">
            <p className="text-xl font-black text-brand-orange tabular-nums leading-none">{etaMinutes}</p>
            <p className="text-[10px] font-bold text-brand-grey uppercase tracking-wider">min away</p>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-4">
        <a
          href={rider.mobile ? `tel:${rider.mobile}` : undefined}
          className={btnGhost + ' !py-2.5' + (rider.mobile ? '' : ' pointer-events-none opacity-50')}
        >
          <Phone className="w-4 h-4" /> Call
        </a>
        <a
          href={whatsappLink(rider.whatsapp || rider.mobile, 'Hi, I am tracking my Smart Mappia food order.') || undefined}
          target="_blank"
          rel="noreferrer"
          className={
            'inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 px-5 rounded-xl text-sm transition-all cursor-pointer' +
            (whatsappLink(rider.whatsapp || rider.mobile) ? '' : ' pointer-events-none opacity-50')
          }
        >
          <MessageCircle className="w-4 h-4" /> WhatsApp
        </a>
      </div>
    </Card>
  );
}

export default function FoodTrackPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // Live rider position, pushed on every GPS ping (~12s while online).
  const [riderLive, setRiderLive] = useState(null); // { lat, lng, at, etaMinutes }
  // Rider heading so the car icon points along travel (mirrors TrackPage).
  const [riderHeading, setRiderHeading] = useState(0);
  const prevRiderRef = useRef(null);

  useEffect(() => {
    if (!riderLive?.lat || !riderLive?.lng) return;
    const prev = prevRiderRef.current;
    const cur = { lat: riderLive.lat, lng: riderLive.lng };
    if (prev && (prev.lat !== cur.lat || prev.lng !== cur.lng)) {
      const b = bearingDeg(prev, cur);
      if (b != null) setRiderHeading(b);
    }
    prevRiderRef.current = cur;
  }, [riderLive?.lat, riderLive?.lng]);

  const load = useCallback(async () => {
    try {
      const next = await api.foodOrder(code);
      setData(next);
      if (next?.rider?.location) {
        setRiderLive((prev) => {
          const fresh = next.rider.location;
          // Keep the newer of poll vs broadcast.
          if (prev && new Date(prev.at) > new Date(fresh.at)) return prev;
          return { ...fresh, etaMinutes: next.rider.etaMinutes };
        });
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [code]);

  useEffect(() => { load(); }, [load]);

  // Realtime first; polling keeps working when the socket can't connect.
  // Location pings only move the pin; anything else refetches the order.
  const connected = useBroadcast(
    `fd-order-${code}`,
    {
      status: (payload) => {
        if (payload && payload.riderLocation) {
          setRiderLive({ ...payload.riderLocation, etaMinutes: payload.riderEtaMinutes ?? null });
        } else {
          load();
        }
      },
    },
    realtimeEnabled
  );
  useEffect(() => {
    if (connected) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [connected, load]);

  const order = data?.order;
  const failed = order && (order.status === 'cancelled' || order.status === 'rejected');
  const statusMeta = order ? foodStatusMeta(order.status) : null;
  const payMeta = order ? foodPaymentMeta(order.payment_status) : null;

  // ETA hero + progress driven off the fulfillment ladder; the live rider ETA
  // takes over once the order is on the way.
  const activeIdx = order ? FOOD_TRACK_STEPS.findIndex((s) => s.id === order.status) : -1;
  const progress = activeIdx >= 0 ? activeIdx / (FOOD_TRACK_STEPS.length - 1) : 0;
  const phase = (order && FOOD_TRACK_PHASE[order.status]) || { eta: '', note: '' };
  const liveEta = riderLive?.etaMinutes ?? data?.rider?.etaMinutes ?? null;
  const heroEta = order && order.status === 'out_for_delivery' && liveEta != null ? `${liveEta} min` : phase.eta;
  // Rider dropped mid-flight (cancel / disconnect): show a reassuring state.
  const findingRider =
    order && !failed && !data.rider &&
    ['accepted', 'preparing', 'ready', 'out_for_delivery'].includes(order.status);

  return (
    <PortalShell title="Track your order" subtitle={code} onBack={() => navigate('/food/orders')}>
      <div className="max-w-xl mx-auto space-y-4">
        {error && !data && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">{error}</div>
        )}
        {!data && !error && (
          <div className="flex justify-center py-20"><Spinner className="!w-8 !h-8" /></div>
        )}

        {order && (
          <>
            {/* ETA hero + progress bar (foodpanda-style). */}
            {!failed && (
              <TrackHeader eta={heroEta} note={phase.note} progress={progress} live={connected} />
            )}

            {/* Status + payment badges, and the full step ladder (or failure). */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                <Badge tone={payMeta.tone}>{payMeta.label}</Badge>
              </div>

              {failed ? (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
                  <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-bold text-red-700">
                      {order.status === 'rejected' ? 'The restaurant rejected this order.' : 'This order was cancelled.'}
                    </p>
                    {order.reject_reason && <p className="text-red-600 mt-0.5">{order.reject_reason}</p>}
                    {order.payment_status === 'paid' && (
                      <p className="text-red-600 mt-0.5">
                        Your payment will be refunded — refunds take a few hours up to 14 days.
                      </p>
                    )}
                    {order.payment_status === 'refunded' && (
                      <p className="text-red-600 mt-0.5">Your payment has been refunded.</p>
                    )}
                  </div>
                </div>
              ) : (
                <StatusStepper status={order.status} />
              )}
            </Card>

            {/* Live map — the rider pin glides on every GPS ping (Grab-style). */}
            {!failed && riderLive && order.status !== 'delivered' && (
              <RoutedRideMap
                from={{ lat: riderLive.lat, lng: riderLive.lng }}
                to={
                  order.delivery_lat != null
                    ? { lat: order.delivery_lat, lng: order.delivery_lng }
                    : null
                }
                fallbackLine={
                  order.delivery_lat != null
                    ? [
                        { lat: riderLive.lat, lng: riderLive.lng },
                        { lat: order.delivery_lat, lng: order.delivery_lng },
                      ]
                    : null
                }
                height={260}
                follow
                followTarget={
                  order.delivery_lat != null
                    ? { lat: order.delivery_lat, lng: order.delivery_lng }
                    : null
                }
                markers={[
                  { type: 'driver', lat: riderLive.lat, lng: riderLive.lng, key: 'rider', heading: riderHeading },
                  data.merchant && data.merchant.lat != null
                    ? { type: 'pickup', lat: data.merchant.lat, lng: data.merchant.lng, label: data.merchant.name, key: 'restaurant' }
                    : null,
                  order.delivery_lat != null
                    ? { type: 'dropoff', lat: order.delivery_lat, lng: order.delivery_lng, label: 'Delivery address', key: 'dropoff' }
                    : null,
                ].filter(Boolean)}
                legend={[
                  { label: 'Rider', color: '#FF7E21', svg: LEGEND_CAR_SVG },
                  { label: 'Restaurant', color: '#FF7E21', glyph: 'P' },
                  { label: 'You', color: '#1F2937', glyph: 'D' },
                ]}
              />
            )}

            {/* Rider card — appears the moment a rider is assigned. */}
            {data.rider && !failed && (
              <RiderCard rider={data.rider} etaMinutes={riderLive?.etaMinutes ?? data.rider.etaMinutes} />
            )}

            {/* No rider yet (searching, or the previous one cancelled/disconnected). */}
            {findingRider && (
              <Card className="p-5 flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-brand-orange animate-spin shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold text-brand-dark text-sm">Finding you a rider…</p>
                  <p className="text-xs text-brand-grey">We're matching your order with the nearest available rider.</p>
                </div>
              </Card>
            )}

            {/* Cash on delivery: nothing to pay online — just a reminder. */}
            {!failed && order.payment_method === 'cash' && order.payment_status === 'awaiting' && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm font-bold text-amber-800">
                Cash on delivery: please have {fmtSAR(order.total)} ready for your rider.
              </div>
            )}

            {/* Online payment needed? Show the pay panel right here. */}
            {!failed &&
              order.payment_method !== 'cash' &&
              (order.payment_status === 'awaiting' || order.payment_status === 'failed') && (
                <PaymentPanel code={code} onPaid={load} />
              )}

            {/* Delivered: warm thank-you + downloadable PDF receipt (spec §6). */}
            {order.status === 'delivered' && (
              <Card className="p-5 text-center bg-gradient-to-br from-brand-orange/10 to-white border-brand-orange/30">
                <div className="w-12 h-12 rounded-full bg-brand-orange/15 text-brand-orange flex items-center justify-center mx-auto mb-2">
                  <Heart className="w-6 h-6" />
                </div>
                <p className="font-black text-brand-black">Thank you for ordering with Smart Mappia!</p>
                <p className="text-xs text-brand-grey mt-1 mb-4">
                  We hope you enjoy your meal. Your receipt is ready to download.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    downloadFoodInvoice({
                      order,
                      items: data.items,
                      merchant: data.merchant,
                      customerName: profile?.fullName || user?.email || 'Smart Mappia customer',
                      driverName: data.rider?.name,
                    })
                  }
                  className="w-full inline-flex items-center justify-center gap-2 bg-brand-orange hover:bg-brand-orange/90 text-white font-black py-3 rounded-xl transition-all shadow-lg shadow-brand-orange/20 text-sm cursor-pointer"
                >
                  <Download className="w-4 h-4" /> Download receipt (PDF)
                </button>
              </Card>
            )}

            {/* Delivered: rate the rider (1-5 stars). */}
            {order.status === 'delivered' && data.rider && (
              <RateDriver
                kind="food"
                code={code}
                driverName={data.rider.name}
                existing={data.driverRating}
              />
            )}

            {/* Restaurant */}
            {data.merchant && (
              <Card className="p-5 flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-orange/15 to-brand-red/10 flex items-center justify-center overflow-hidden shrink-0">
                  {data.merchant.logo_url ? (
                    <img src={data.merchant.logo_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <UtensilsCrossed className="w-5 h-5 text-brand-orange/60" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-brand-dark truncate">{data.merchant.name}</p>
                  {data.merchant.address && (
                    <p className="text-xs text-brand-grey truncate flex items-center gap-1">
                      <MapPin className="w-3 h-3 shrink-0" /> {data.merchant.address}
                    </p>
                  )}
                </div>
              </Card>
            )}

            {/* Contact number — editable even while the order is on its way. */}
            <EditableContact
              value={order.contact_phone}
              editable={!failed && order.status !== 'delivered'}
              onSave={async (phone) => {
                await api.foodOrderContact(code, phone);
                await load();
              }}
            />

            {/* Order details block (order number / from / address / total). */}
            <OrderMetaCard
              code={code}
              from={data.merchant?.name}
              address={order.delivery_address}
              total={order.total}
            />

            {/* Itemized receipt */}
            <Card className="p-5">
              <p className="font-black text-brand-black mb-3 flex items-center gap-2">
                <ReceiptText className="w-4 h-4 text-brand-orange" /> Receipt
              </p>
              <div className="space-y-1.5 text-sm">
                {(data.items || []).map((line, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="text-brand-dark truncate">
                      {line.quantity} × {line.name_snapshot}
                      {line.size_snapshot ? <span className="text-brand-grey"> ({line.size_snapshot})</span> : null}
                    </span>
                    <span className="tabular-nums font-medium shrink-0">{fmtSAR(line.line_total)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t border-brand-border space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-brand-grey">Subtotal</span><span className="font-bold tabular-nums">{fmtSAR(order.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-brand-grey">Delivery charge</span><span className="font-bold tabular-nums">{fmtSAR(order.delivery_fee)}</span></div>
                {Number(order.vat_amount) > 0 && (
                  <div className="flex justify-between"><span className="text-brand-grey">{vatLabel(order.vat_rate)}</span><span className="font-bold tabular-nums">{fmtSAR(order.vat_amount)}</span></div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-brand-border">
                  <span className="font-bold text-brand-dark">Total</span>
                  <span className="font-black text-brand-orange tabular-nums">{fmtSAR(order.total)}</span>
                </div>
                {order.payment_method && (
                  <div className="flex justify-between pt-1.5">
                    <span className="text-brand-grey">Paid with</span>
                    <span className="font-bold text-brand-dark">
                      {FOOD_PAYMENT_METHODS[order.payment_method] || order.payment_method}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs text-brand-grey mt-3 flex items-center gap-1">
                <MapPin className="w-3 h-3 shrink-0" /> {order.delivery_address}
              </p>
            </Card>
          </>
        )}
      </div>
    </PortalShell>
  );
}
