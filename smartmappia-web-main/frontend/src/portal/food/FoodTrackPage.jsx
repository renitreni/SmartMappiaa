// ---------------------------------------------------------------------
// Food Delivery — live tracking: /food/track/:code
// Grab-style: real-time status stepper (broadcast + 8s polling fallback),
// a LIVE MAP with the rider's pin gliding on every GPS ping, the
// restaurant card, and the rider card (name + in-app Call and WhatsApp).
// Payment panel appears inline while the order is awaiting payment.
// ---------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
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
} from 'lucide-react';
import { api } from '../lib/api';
import { useBroadcast } from '../lib/useBroadcast';
import { realtimeEnabled } from '../lib/supabaseClient';
import {
  fmtSAR,
  whatsappLink,
  foodStatusMeta,
  foodPaymentMeta,
  FOOD_TRACK_STEPS,
} from '../lib/constants';
import { PortalShell, Card, Badge, Spinner, btnGhost } from '../components/ui';
import RideMap from '../components/RideMap';
import RateDriver from '../components/RateDriver';
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
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // Live rider position, pushed on every GPS ping (~12s while online).
  const [riderLive, setRiderLive] = useState(null); // { lat, lng, at, etaMinutes }

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
            {/* Status header */}
            <Card className="p-5">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                  <Badge tone={payMeta.tone}>{payMeta.label}</Badge>
                </div>
                {connected && (
                  <span className="text-[10px] font-bold text-green-600 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Live
                  </span>
                )}
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
              <RideMap
                height={260}
                follow
                followTarget={
                  order.delivery_lat != null
                    ? { lat: order.delivery_lat, lng: order.delivery_lng }
                    : null
                }
                markers={[
                  { type: 'driver', lat: riderLive.lat, lng: riderLive.lng, key: 'rider' },
                  data.merchant && data.merchant.lat != null
                    ? { type: 'pickup', lat: data.merchant.lat, lng: data.merchant.lng, label: data.merchant.name, key: 'restaurant' }
                    : null,
                  order.delivery_lat != null
                    ? { type: 'dropoff', lat: order.delivery_lat, lng: order.delivery_lng, label: 'Delivery address', key: 'dropoff' }
                    : null,
                ].filter(Boolean)}
                legend={[
                  { label: 'Rider', color: '#FF7E21', glyph: 'R' },
                  { label: 'Restaurant', color: '#FF7E21', glyph: 'P' },
                  { label: 'You', color: '#1F2937', glyph: 'D' },
                ]}
              />
            )}

            {/* Rider card — appears the moment a rider is assigned. */}
            {data.rider && !failed && (
              <RiderCard rider={data.rider} etaMinutes={riderLive?.etaMinutes ?? data.rider.etaMinutes} />
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

            {/* Receipt */}
            <Card className="p-5">
              <p className="font-black text-brand-black mb-3 flex items-center gap-2">
                <ReceiptText className="w-4 h-4 text-brand-orange" /> Order details
              </p>
              <div className="space-y-1.5 text-sm">
                {(data.items || []).map((line, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="text-brand-dark truncate">{line.quantity} × {line.name_snapshot}</span>
                    <span className="tabular-nums font-medium shrink-0">{fmtSAR(line.line_total)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t border-brand-border space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-brand-grey">Subtotal</span><span className="font-bold tabular-nums">{fmtSAR(order.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-brand-grey">Delivery fee</span><span className="font-bold tabular-nums">{fmtSAR(order.delivery_fee)}</span></div>
                <div className="flex justify-between pt-1.5 border-t border-brand-border">
                  <span className="font-bold text-brand-dark">Total</span>
                  <span className="font-black text-brand-orange tabular-nums">{fmtSAR(order.total)}</span>
                </div>
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
