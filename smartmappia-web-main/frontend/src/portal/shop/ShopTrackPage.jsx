// ---------------------------------------------------------------------
// Ecommerce — live order tracking: /shop/track/:code
//
// Realtime first on the shop-order-<code> channel, with the standard 8 s
// polling fallback whenever the socket is not connected. Realtime
// accelerates; polling guarantees.
// ---------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Phone, MessageCircle, ShoppingBag, MapPin } from 'lucide-react';
import { api } from '../lib/api';
import { useBroadcast } from '../lib/useBroadcast';
import {
  fmtSAR,
  shopStatusMeta,
  shopPaymentMeta,
  SHOP_TRACK_STEPS,
  SHOP_PAYMENT_METHODS,
  TONE_CLASSES,
} from '../lib/constants';
import { PortalShell, Card, Spinner, btnGhost } from '../components/ui';
import RoutedRideMap from '../components/RoutedRideMap';
import EditableContact from '../components/EditableContact';
import RateDriver from '../components/RateDriver';
import PaymentPanel from '../food/PaymentPanel';

const POLL_MS = 8000;
const TERMINAL = ['delivered', 'cancelled', 'rejected'];

function StatusStepper({ status }) {
  const activeIndex = SHOP_TRACK_STEPS.findIndex((s) => s.id === status);
  return (
    <ol className="space-y-3">
      {SHOP_TRACK_STEPS.map((step, i) => {
        const done = activeIndex >= 0 && i < activeIndex;
        const active = i === activeIndex;
        return (
          <li key={step.id} className="flex gap-3">
            <span
              className={`w-3 h-3 rounded-full mt-1.5 shrink-0 ${
                done ? 'bg-green-500' : active ? 'bg-brand-orange' : 'bg-brand-border'
              }`}
            />
            <span className="min-w-0">
              <span
                className={`block font-bold text-sm ${
                  active ? 'text-brand-black' : done ? 'text-brand-dark' : 'text-brand-grey'
                }`}
              >
                {step.label}
              </span>
              {active && <span className="block text-xs text-brand-grey mt-0.5">{step.desc}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function ShopTrackPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api
      .shopOrder(code)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [code]);

  useEffect(load, [load]);

  const status = data?.order?.status;
  const realtimeEnabled = !!status && !TERMINAL.includes(status);
  const connected = useBroadcast(`shop-order-${code}`, { status: () => load() }, realtimeEnabled);

  // Polling fallback: only while the socket is down and the order is live.
  useEffect(() => {
    if (connected || !realtimeEnabled) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [connected, realtimeEnabled, load]);

  if (error) {
    return (
      <PortalShell title="Track order" onBack={() => navigate('/shop/orders')}>
        <Card className="p-8 text-center">
          <p className="font-bold text-brand-black">{error}</p>
        </Card>
      </PortalShell>
    );
  }

  if (!data) {
    return (
      <PortalShell title="Track order">
        <div className="flex justify-center py-16">
          <Spinner className="!w-8 !h-8" />
        </div>
      </PortalShell>
    );
  }

  const { order, items, store, rider, driverRating } = data;
  const statusMeta = shopStatusMeta(order.status);
  const paymentMeta = shopPaymentMeta(order.payment_status);
  const awaitingOnlinePayment =
    order.payment_method !== 'cash' && ['awaiting', 'failed'].includes(order.payment_status);

  const markers = [];
  if (store?.lat != null && store?.lng != null) {
    markers.push({ key: 'store', lat: store.lat, lng: store.lng, type: 'pickup', label: store.name });
  }
  if (order.delivery_lat != null && order.delivery_lng != null) {
    markers.push({
      key: 'drop',
      lat: order.delivery_lat,
      lng: order.delivery_lng,
      type: 'dropoff',
      label: 'Delivery',
    });
  }

  return (
    <PortalShell
      title={store?.name || 'Your order'}
      subtitle={order.order_code}
      onBack={() => navigate('/shop/orders')}
    >
      <div className="flex flex-wrap gap-2 mb-4">
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${TONE_CLASSES[statusMeta.tone]}`}>
          {statusMeta.label}
        </span>
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${TONE_CLASSES[paymentMeta.tone]}`}>
          {paymentMeta.label}
        </span>
        {connected && realtimeEnabled && (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold border border-green-200 bg-green-50 text-green-700">
            Live
          </span>
        )}
      </div>

      {order.status === 'rejected' && order.reject_reason && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
          {order.reject_reason}
        </div>
      )}

      {awaitingOnlinePayment && (
        <div className="mb-4">
          <PaymentPanel code={order.order_code} vertical="shop" onPaid={load} />
        </div>
      )}

      {markers.length > 0 && (
        <Card className="p-0 overflow-hidden mb-4">
          <RoutedRideMap
            markers={markers}
            from={store?.lat != null ? { lat: store.lat, lng: store.lng } : null}
            to={order.delivery_lat != null ? { lat: order.delivery_lat, lng: order.delivery_lng } : null}
            height={240}
          />
        </Card>
      )}

      <Card className="p-4 mb-4">
        <StatusStepper status={order.status} />
      </Card>

      {rider && (
        <Card className="p-4 mb-4">
          <p className="text-xs text-brand-grey mb-2">Your rider</p>
          <div className="flex items-center justify-between gap-3">
            <p className="font-bold text-brand-black">{rider.name || 'Rider'}</p>
            {rider.phone && (
              <div className="flex gap-2">
                <a href={`tel:${rider.phone}`} className={btnGhost + ' !py-1.5 !px-3 text-sm'}>
                  <Phone className="w-4 h-4" />
                </a>
                <a
                  href={`https://wa.me/${rider.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className={btnGhost + ' !py-1.5 !px-3 text-sm'}
                >
                  <MessageCircle className="w-4 h-4" />
                </a>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card className="p-4 mb-4">
        <p className="text-xs text-brand-grey mb-2">Delivering to</p>
        <p className="text-sm font-medium text-brand-dark flex gap-2">
          <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-brand-grey" />
          {order.delivery_address}
        </p>
        <div className="mt-3">
          <EditableContact
            value={order.contact_phone}
            editable={!TERMINAL.includes(order.status)}
            onSave={async (next) => {
              await api.shopOrderContact(order.order_code, next);
              load();
            }}
          />
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <p className="font-bold text-brand-black mb-3 flex items-center gap-2">
          <ShoppingBag className="w-4 h-4" /> Your items
        </p>
        <div className="space-y-2 text-sm">
          {(items || []).map((it) => (
            <div key={it.id} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="font-medium text-brand-dark">
                  {it.quantity} x {it.name_snapshot}
                </span>
                {it.variant_label_snapshot && (
                  <span className="text-brand-grey"> ({it.variant_label_snapshot})</span>
                )}
                {it.sku_snapshot && (
                  <span className="block text-[11px] font-mono text-brand-grey">{it.sku_snapshot}</span>
                )}
              </span>
              <span className="font-bold shrink-0">{fmtSAR(it.line_total)}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-brand-border space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-brand-grey">Subtotal</span>
            <span className="font-bold">{fmtSAR(order.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-brand-grey">Delivery</span>
            <span className="font-bold">{fmtSAR(order.delivery_fee)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-brand-grey">VAT ({Math.round((order.vat_rate || 0) * 100)}%)</span>
            <span className="font-bold">{fmtSAR(order.vat_amount)}</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-brand-border">
            <span className="font-black text-brand-black">Total</span>
            <span className="font-black text-brand-orange">{fmtSAR(order.total)}</span>
          </div>
          <p className="text-xs text-brand-grey pt-1">
            Paid with {SHOP_PAYMENT_METHODS[order.payment_method] || order.payment_method}
          </p>
        </div>
      </Card>

      {order.status === 'delivered' && rider && (
        <RateDriver kind="shop" code={order.order_code} driverName={rider.name} existing={driverRating} />
      )}
    </PortalShell>
  );
}
