// ---------------------------------------------------------------------
// Passenger: Grab-style live tracking.
//   - live driver position on the map + ETA
//   - pickup & drop-off pins
//   - WhatsApp the driver
//   - cancel booking
//   - status timeline
// Updates via Supabase Realtime Broadcast, with an 8s polling safety net.
// ---------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MessageCircle, X, MapPin, Flag, Navigation, Clock, RefreshCw, Car } from 'lucide-react';
import { api } from '../lib/api';
import { useBroadcast } from '../lib/useBroadcast';
import { realtimeEnabled } from '../lib/supabaseClient';
import { statusMeta, whatsappLink, CANCELLABLE } from '../lib/constants';
import { PortalShell, Card, Badge, Spinner, btnGhost } from '../components/ui';
import RideMap from '../components/RideMap';

const ACTIVE = ['accepted', 'on_the_way', 'arrived', 'started'];

export default function TrackPage() {
  const { code } = useParams();
  const [data, setData] = useState(null);
  const [live, setLive] = useState({ driverLocation: null, etaMinutes: null });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const doneRef = useRef(false);

  const refetch = useCallback(async () => {
    try {
      const d = await api.tracking(code);
      setData(d);
      doneRef.current = d.bookingStatus === 'completed' || d.bookingStatus === 'cancelled';
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { refetch(); }, [refetch]);

  // Polling safety net (also covers the case where realtime isn't configured).
  useEffect(() => {
    const id = setInterval(() => { if (!doneRef.current) refetch(); }, 8000);
    return () => clearInterval(id);
  }, [refetch]);

  // Realtime: live position + status changes.
  const connected = useBroadcast(
    `booking-${code}`,
    {
      status: (payload) => {
        if (payload.driverLocation) setLive((l) => ({ ...l, driverLocation: payload.driverLocation }));
        if (payload.etaMinutes != null) setLive((l) => ({ ...l, etaMinutes: payload.etaMinutes }));
        if (payload.bookingStatus || payload.paymentStatus || payload.driver) refetch();
      },
    },
    realtimeEnabled
  );

  async function onCancel() {
    if (!window.confirm('Cancel this booking? This cannot be undone.')) return;
    setCancelling(true);
    try {
      await api.cancelBooking(code, 'Cancelled by passenger');
      await refetch();
    } catch (err) {
      setError(err.message);
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <PortalShell title="Tracking" subtitle={code}>
        <div className="flex items-center justify-center py-20"><Spinner className="!w-8 !h-8" /></div>
      </PortalShell>
    );
  }
  if (error && !data) {
    return (
      <PortalShell title="Tracking" subtitle={code}>
        <Card className="p-6 text-center">
          <p className="text-red-600 font-bold mb-3">{error}</p>
          <Link to="/book" className={btnGhost}>Make a new booking</Link>
        </Card>
      </PortalShell>
    );
  }

  const meta = statusMeta(data.bookingStatus);
  const driverLoc = live.driverLocation || data.driverLocation;
  const eta = live.etaMinutes ?? data.liveEtaMinutes;
  const isActive = ACTIVE.includes(data.driverRideStatus);
  const waiting = data.bookingStatus === 'confirmed' || data.bookingStatus === 'payment_under_review';
  const tripStarted = data.driverRideStatus === 'started';

  const pickup = data.pickupLat != null ? { lat: data.pickupLat, lng: data.pickupLng } : null;
  const dropoff = data.dropoffLat != null ? { lat: data.dropoffLat, lng: data.dropoffLng } : null;

  const markers = [
    pickup && { ...pickup, type: 'pickup', label: 'Pickup', key: 'p' },
    dropoff && { ...dropoff, type: 'dropoff', label: 'Drop-off', key: 'd' },
    driverLoc && { lat: driverLoc.lat, lng: driverLoc.lng, type: 'driver', label: 'Your driver', key: 'driver' },
  ].filter(Boolean);

  const mapLegend = [
    pickup && { glyph: 'P', color: '#FF7E21', label: 'Pickup' },
    dropoff && { glyph: 'D', color: '#1F2937', label: 'Drop-off' },
    driverLoc && { glyph: '●', color: '#FF7E21', label: 'Driver' },
  ].filter(Boolean);

  // Dashed guide line: driver→pickup before the trip, pickup→dropoff during.
  let line = null;
  if (driverLoc && pickup && !tripStarted) line = [driverLoc, pickup];
  else if (pickup && dropoff && tripStarted) line = [pickup, dropoff];

  const canCancel = CANCELLABLE.includes(data.bookingStatus);
  const waLink = data.driver && whatsappLink(data.driver.whatsapp, `Hi, this is about booking ${code}`);

  return (
    <PortalShell
      title="Live tracking"
      subtitle={code}
      right={
        <button onClick={refetch} className="p-2 rounded-lg hover:bg-brand-surface cursor-pointer" title="Refresh">
          <RefreshCw className="w-4 h-4 text-brand-grey" />
        </button>
      }
    >
      {/* Status banner */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          {waiting && <Spinner />}
          <div>
            <div className="font-black text-lg text-brand-black leading-tight">{meta.label}</div>
            <div className="text-xs text-brand-grey">
              {waiting ? 'Hang tight — matching you with a nearby driver…' : `Driver status: ${data.driverRideStatus || '—'}`}
            </div>
          </div>
        </div>
        <Badge tone={meta.tone}>{data.bookingStatus}</Badge>
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* Map */}
        <Card className="lg:col-span-3 p-2 relative overflow-hidden">
          <RideMap markers={markers} line={line} legend={mapLegend} height={380} />
          {isActive && eta != null && (
            <div className="absolute top-4 left-4 z-[400] bg-white rounded-xl shadow-lg border border-brand-border px-4 py-2 flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand-orange" />
              <div>
                <div className="text-[10px] font-bold text-brand-grey uppercase leading-none">ETA</div>
                <div className="font-black text-brand-black leading-tight">{eta} min</div>
              </div>
            </div>
          )}
          {!realtimeEnabled && (
            <div className="absolute bottom-3 left-3 z-[400] text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded">
              Realtime off — refreshing every 8s
            </div>
          )}
          {realtimeEnabled && connected && (
            <div className="absolute bottom-3 left-3 z-[400] text-[10px] bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Live
            </div>
          )}
        </Card>

        {/* Side panel */}
        <div className="lg:col-span-2 space-y-4">
          {/* Driver card */}
          {data.driver ? (
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-brand-orange/10 flex items-center justify-center text-brand-orange">
                  <Car className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <div className="font-black text-brand-black truncate">{data.driver.name || 'Your driver'}</div>
                  <div className="text-xs text-brand-grey">Smart Mappia driver</div>
                </div>
              </div>
              {waLink && (
                <a href={waLink} target="_blank" rel="noreferrer"
                  className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                  <MessageCircle className="w-4 h-4" /> Message driver on WhatsApp
                </a>
              )}
            </Card>
          ) : (
            <Card className="p-4 text-center text-sm text-brand-grey">
              {waiting ? 'No driver yet — waiting for one to accept your trip.' : '—'}
            </Card>
          )}

          {/* Trip details */}
          <Card className="p-4 space-y-3">
            <div className="flex gap-3">
              <MapPin className="w-5 h-5 text-brand-orange shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-brand-grey uppercase">Pickup</div>
                <div className="text-sm font-medium text-brand-dark">{data.pickupAddress}</div>
              </div>
            </div>
            <div className="flex gap-3">
              <Flag className="w-5 h-5 text-brand-black shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-brand-grey uppercase">Drop-off</div>
                <div className="text-sm font-medium text-brand-dark">{data.dropoffAddress}</div>
              </div>
            </div>
            <div className="flex justify-between pt-2 border-t border-brand-border text-sm">
              <span className="text-brand-grey">Fare</span>
              <span className="font-black text-brand-orange">SAR {data.fareAmount}</span>
            </div>
          </Card>

          {canCancel && (
            <button onClick={onCancel} disabled={cancelling}
              className="w-full inline-flex items-center justify-center gap-2 bg-white hover:bg-red-50 text-red-600 font-bold py-3 rounded-xl border border-red-200 transition-colors cursor-pointer disabled:opacity-50">
              {cancelling ? <Spinner /> : <><X className="w-4 h-4" /> Cancel booking</>}
            </button>
          )}
        </div>
      </div>

      {/* Timeline */}
      <Card className="p-5 mt-4">
        <div className="flex items-center gap-2 font-black text-brand-black mb-4">
          <Navigation className="w-4 h-4 text-brand-orange" /> Trip timeline
        </div>
        <ol className="space-y-4">
          {(data.timeline || []).map((e, i) => (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={`w-3 h-3 rounded-full ${i === data.timeline.length - 1 ? 'bg-brand-orange' : 'bg-brand-border'}`} />
                {i < data.timeline.length - 1 && <span className="w-px flex-1 bg-brand-border mt-1" />}
              </div>
              <div className="pb-1 -mt-1">
                <div className="text-sm font-bold text-brand-dark">{e.title || e.type}</div>
                {e.message && <div className="text-xs text-brand-grey">{e.message}</div>}
                <div className="text-[10px] text-brand-grey mt-0.5">{new Date(e.at).toLocaleString()}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </PortalShell>
  );
}
