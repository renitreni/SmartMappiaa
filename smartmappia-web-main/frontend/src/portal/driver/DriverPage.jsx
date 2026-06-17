// ---------------------------------------------------------------------
// Driver portal (Grab-style). Identity comes from the signed-in Supabase
// session; a driver must be admin-approved before they can go online.
//   - go online -> share live GPS
//   - see nearby UNCLAIMED requests (nearest first), on a map
//   - accept (first-come-first-served, atomic on the backend)
//   - progress the ride; WhatsApp the rider
// ---------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { Power, MessageCircle, MapPin, Flag, Navigation, Check, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthProvider';
import { useGeolocation, haversineKm, etaMinutes } from '../lib/geo';
import { useBroadcast } from '../lib/useBroadcast';
import { realtimeEnabled } from '../lib/supabaseClient';
import { whatsappLink } from '../lib/constants';
import { PortalShell, Card, Badge, Spinner, btnPrimary, btnGhost } from '../components/ui';
import RideMap from '../components/RideMap';

const ACTIVE = ['accepted', 'on_the_way', 'arrived', 'started'];
const NEXT = {
  accepted: { status: 'on_the_way', label: 'Start heading to pickup' },
  on_the_way: { status: 'arrived', label: "I've arrived" },
  arrived: { status: 'started', label: 'Start trip' },
  started: { status: 'completed', label: 'Complete trip' },
};

function normRide(r) {
  if (!r) return null;
  return {
    bookingCode: r.bookingCode || r.booking_code,
    tripType: r.tripType || r.trip_type,
    airportTerminal: r.airportTerminal || r.airport_terminal,
    pickupAddress: r.pickupAddress || r.pickup_address,
    pickupLat: r.pickupLat ?? r.pickup_lat,
    pickupLng: r.pickupLng ?? r.pickup_lng,
    dropoffAddress: r.dropoffAddress || r.dropoff_address,
    dropoffLat: r.dropoffLat ?? r.dropoff_lat,
    dropoffLng: r.dropoffLng ?? r.dropoff_lng,
    fareAmount: r.fareAmount ?? r.fare_amount,
    passengerName: r.passengerName || r.passenger_name,
    passengerWhatsapp: r.passengerWhatsapp || r.passenger_whatsapp,
    driverRideStatus: r.driverRideStatus || r.driver_ride_status,
    bookingStatus: r.bookingStatus || r.booking_status,
  };
}

export default function DriverPage() {
  const { driverApproved, profile } = useAuth();
  const [online, setOnline] = useState(false);
  const [available, setAvailable] = useState([]);
  const [activeRide, setActiveRide] = useState(null);
  const [error, setError] = useState(null);
  const [busyCode, setBusyCode] = useState(null);
  const [lastPayout, setLastPayout] = useState(null);

  const { coords, error: geoError } = useGeolocation({ watch: true, enabled: online });
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  const loadActive = useCallback(async () => {
    try {
      const { rides } = await api.driverRides();
      const active = (rides || []).map(normRide).find((r) => ACTIVE.includes(r.driverRideStatus));
      setActiveRide(active || null);
    } catch (err) { setError(err.message); }
  }, []);

  const loadAvailable = useCallback(async () => {
    const c = coordsRef.current;
    try {
      const { rides } = await api.driverAvailable(c?.lat, c?.lng);
      setAvailable((rides || []).map(normRide));
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => { if (driverApproved) loadActive(); }, [driverApproved, loadActive]);

  // While online with no active ride: post GPS + refresh feed periodically.
  useEffect(() => {
    if (!online || !driverApproved) return undefined;
    let stop = false;
    const tick = async () => {
      const c = coordsRef.current;
      if (c) { try { await api.driverLocation({ lat: c.lat, lng: c.lng, accuracy: c.accuracy }); } catch { /* ignore */ } }
      if (!activeRide && !stop) loadAvailable();
    };
    tick();
    const id = setInterval(tick, 12000);
    return () => { stop = true; clearInterval(id); };
  }, [online, driverApproved, activeRide, loadAvailable]);

  useBroadcast(
    'drivers-available',
    {
      new_request: (payload) => {
        const r = normRide(payload);
        setAvailable((list) => (list.some((x) => x.bookingCode === r.bookingCode) ? list : [...list, r]));
      },
      request_taken: (payload) => {
        setAvailable((list) => list.filter((x) => x.bookingCode !== payload.bookingCode));
      },
    },
    realtimeEnabled && online && driverApproved && !activeRide
  );

  async function accept(code) {
    setBusyCode(code); setError(null);
    try {
      await api.driverAccept(code);
      setAvailable((list) => list.filter((x) => x.bookingCode !== code));
      await loadActive();
    } catch (err) { setError(err.message); await loadAvailable(); } finally { setBusyCode(null); }
  }

  async function advance(code, status) {
    setBusyCode(code); setError(null);
    try {
      const res = await api.driverStatus(code, status);
      if (status === 'completed') {
        setLastPayout(res.ledger);
        setActiveRide(null);
        loadAvailable();
      } else {
        await loadActive();
      }
    } catch (err) { setError(err.message); } finally { setBusyCode(null); }
  }

  // Not approved yet -> hold screen.
  if (!driverApproved) {
    return (
      <PortalShell title="Driver" subtitle={profile?.fullName || ''}>
        <div className="max-w-md mx-auto">
          <Card className="p-6 text-center">
            <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <p className="font-black text-brand-black">Pending admin approval</p>
            <p className="text-sm text-brand-grey mt-1">
              Your driver account has been created. An admin needs to verify you before you can go online and accept rides.
            </p>
          </Card>
        </div>
      </PortalShell>
    );
  }

  const here = coords ? { lat: coords.lat, lng: coords.lng } : null;

  let markers = [];
  let line = null;
  if (activeRide) {
    markers = [
      here && { ...here, type: 'driver', label: 'You', key: 'me' },
      activeRide.pickupLat != null && { lat: activeRide.pickupLat, lng: activeRide.pickupLng, type: 'pickup', label: 'Pickup', key: 'p' },
      activeRide.dropoffLat != null && { lat: activeRide.dropoffLat, lng: activeRide.dropoffLng, type: 'dropoff', label: 'Drop-off', key: 'd' },
    ].filter(Boolean);
    if (here && activeRide.pickupLat != null && activeRide.driverRideStatus !== 'started') line = [here, { lat: activeRide.pickupLat, lng: activeRide.pickupLng }];
  } else {
    markers = [
      here && { ...here, type: 'driver', label: 'You', key: 'me' },
      ...available.filter((r) => r.pickupLat != null).map((r) => ({
        lat: r.pickupLat,
        lng: r.pickupLng,
        type: 'pickup',
        label: r.pickupAddress,
        key: r.bookingCode,
      })),
    ].filter(Boolean);
  }

  const mapLegend = [
    here && { glyph: '●', color: '#FF7E21', label: 'You' },
    { glyph: 'P', color: '#FF7E21', label: activeRide ? 'Pickup' : 'Requests' },
    activeRide && { glyph: 'D', color: '#1F2937', label: 'Drop-off' },
  ].filter(Boolean);

  const sortedAvailable = [...available]
    .map((r) => ({ ...r, dist: here ? haversineKm(here, { lat: r.pickupLat, lng: r.pickupLng }) : null }))
    .sort((a, b) => (a.dist == null ? 1 : b.dist == null ? -1 : a.dist - b.dist));

  return (
    <PortalShell title="Driver" subtitle={online ? 'Online' : 'Offline'}>
      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">{error}</div>}

      <Card className="p-4 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${online ? 'bg-green-100 text-green-600' : 'bg-brand-surface text-brand-grey'}`}>
            <Power className="w-5 h-5" />
          </div>
          <div>
            <div className="font-black text-brand-black">{online ? "You're online" : "You're offline"}</div>
            <div className="text-xs text-brand-grey">
              {online ? (coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : 'Getting your location…') : 'Go online to receive ride requests'}
            </div>
          </div>
        </div>
        <button onClick={() => setOnline((v) => !v)} className={online ? btnGhost : btnPrimary}>
          {online ? 'Go offline' : 'Go online'}
        </button>
      </Card>

      {geoError && online && <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm">{geoError}</div>}

      {lastPayout && !activeRide && (
        <Card className="p-4 mb-4 bg-green-50 border-green-200">
          <div className="flex items-center gap-2 text-green-700 font-black"><Check className="w-5 h-5" /> Trip completed</div>
          <div className="text-sm text-green-700 mt-1">Your payout: <b>SAR {lastPayout.driverNet}</b> · status: {lastPayout.payoutStatus}</div>
        </Card>
      )}

      <div className="grid lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3 p-2 overflow-hidden">
          <RideMap markers={markers} line={line} legend={mapLegend} height={380} />
        </Card>

        <div className="lg:col-span-2 space-y-4">
          {activeRide ? (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-black text-brand-black">Active ride</span>
                <Badge tone="blue">{activeRide.driverRideStatus}</Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex gap-2"><MapPin className="w-4 h-4 text-brand-orange shrink-0 mt-0.5" /><span>{activeRide.pickupAddress}</span></div>
                <div className="flex gap-2"><Flag className="w-4 h-4 text-brand-black shrink-0 mt-0.5" /><span>{activeRide.dropoffAddress}</span></div>
                <div className="flex justify-between pt-2 border-t border-brand-border"><span className="text-brand-grey">Passenger</span><span className="font-bold">{activeRide.passengerName}</span></div>
                <div className="flex justify-between"><span className="text-brand-grey">Fare</span><span className="font-black text-brand-orange">SAR {activeRide.fareAmount}</span></div>
              </div>

              {whatsappLink(activeRide.passengerWhatsapp) && (
                <a href={whatsappLink(activeRide.passengerWhatsapp, `Hi, I'm your Smart Mappia driver for ${activeRide.bookingCode}`)} target="_blank" rel="noreferrer"
                  className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold py-2.5 rounded-xl text-sm">
                  <MessageCircle className="w-4 h-4" /> Message user
                </a>
              )}

              {NEXT[activeRide.driverRideStatus] && (
                <button onClick={() => advance(activeRide.bookingCode, NEXT[activeRide.driverRideStatus].status)}
                  disabled={busyCode === activeRide.bookingCode} className={btnPrimary + ' w-full mt-3'}>
                  {busyCode === activeRide.bookingCode ? <Spinner className="!border-white/40 !border-t-white" /> : <><Navigation className="w-4 h-4" /> {NEXT[activeRide.driverRideStatus].label}</>}
                </button>
              )}
            </Card>
          ) : (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-black text-brand-black">Nearby requests</span>
                <Badge tone={online ? 'green' : 'grey'}>{sortedAvailable.length}</Badge>
              </div>
              {!online && <p className="text-sm text-brand-grey">Go online to see ride requests.</p>}
              {online && sortedAvailable.length === 0 && (
                <div className="text-sm text-brand-grey flex items-center gap-2"><Spinner /> Waiting for nearby requests…</div>
              )}
              <div className="space-y-3">
                {sortedAvailable.map((r) => (
                  <div key={r.bookingCode} className="border border-brand-border rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-brand-dark">{r.bookingCode}</span>
                      <span className="text-xs font-bold text-brand-orange">
                        {r.dist != null ? `${r.dist.toFixed(1)} km · ~${etaMinutes(r.dist)} min` : '—'}
                      </span>
                    </div>
                    <div className="text-sm mt-1 text-brand-dark truncate flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-brand-orange shrink-0" /> {r.pickupAddress}</div>
                    <div className="text-sm text-brand-grey truncate flex items-center gap-1.5"><Flag className="w-3.5 h-3.5 text-brand-black shrink-0" /> {r.dropoffAddress}</div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="font-black text-brand-orange text-sm">SAR {r.fareAmount}</span>
                      <button onClick={() => accept(r.bookingCode)} disabled={busyCode === r.bookingCode} className={btnPrimary + ' !py-2 !px-4'}>
                        {busyCode === r.bookingCode ? <Spinner className="!border-white/40 !border-t-white" /> : 'Accept'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
