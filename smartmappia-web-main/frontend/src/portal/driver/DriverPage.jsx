// ---------------------------------------------------------------------

// Driver portal (Grab-style). Identity comes from the signed-in Supabase

// session; a driver must be admin-approved before they can go online.

// ---------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';

import {

  Power,

  MessageCircle,

  MapPin,

  Flag,

  Navigation,

  Check,

  ShieldAlert,

  User,

  Radio,

  Clock,

  ChevronRight,

} from 'lucide-react';

import { api } from '../lib/api';

import { useAuth } from '../lib/AuthProvider';

import { useGeolocation, haversineKm, etaMinutes, movementFrom, bearingDeg, parseCoord, resolveCoordsFromAddress } from '../lib/geo';

import { useBroadcast } from '../lib/useBroadcast';

import { realtimeEnabled } from '../lib/supabaseClient';

import { whatsappLink } from '../lib/constants';

import { PortalShell, Card, Badge, Spinner, btnPrimary } from '../components/ui';

import RideMap from '../components/RideMap';



const ACTIVE = ['accepted', 'on_the_way', 'arrived', 'started'];

const RIDE_STEPS = [

  { key: 'accepted', label: 'Accepted' },

  { key: 'on_the_way', label: 'En route' },

  { key: 'arrived', label: 'Arrived' },

  { key: 'started', label: 'On trip' },

];

const NEXT = {

  accepted: { status: 'on_the_way', label: 'Start heading to pickup' },

  on_the_way: { status: 'arrived', label: "I've arrived at pickup" },

  arrived: { status: 'started', label: 'Start trip to drop-off' },

  started: { status: 'completed', label: 'Complete trip' },

};

const STATUS_LABELS = {

  accepted: 'New ride accepted',

  on_the_way: 'Heading to client',

  arrived: 'Waiting at pickup',

  started: 'Trip in progress',

};



function normRide(r) {

  if (!r) return null;

  const pickupAddress = r.pickupAddress || r.pickup_address;

  const dropoffAddress = r.dropoffAddress || r.dropoff_address;

  const pickupCoords = resolveCoordsFromAddress(

    pickupAddress,

    parseCoord(r.pickupLat ?? r.pickup_lat),

    parseCoord(r.pickupLng ?? r.pickup_lng)

  );

  const dropoffCoords = resolveCoordsFromAddress(

    dropoffAddress,

    parseCoord(r.dropoffLat ?? r.dropoff_lat),

    parseCoord(r.dropoffLng ?? r.dropoff_lng)

  );

  return {

    bookingCode: r.bookingCode || r.booking_code,

    tripType: r.tripType || r.trip_type,

    airportTerminal: r.airportTerminal || r.airport_terminal,

    pickupAddress,

    pickupLat: pickupCoords?.lat ?? null,

    pickupLng: pickupCoords?.lng ?? null,

    dropoffAddress,

    dropoffLat: dropoffCoords?.lat ?? null,

    dropoffLng: dropoffCoords?.lng ?? null,

    fareAmount: r.fareAmount ?? r.fare_amount,

    passengerName: r.passengerName || r.passenger_name,

    passengerWhatsapp: r.passengerWhatsapp || r.passenger_whatsapp,

    driverRideStatus: r.driverRideStatus || r.driver_ride_status,

    bookingStatus: r.bookingStatus || r.booking_status,

  };

}



function RideProgress({ status }) {

  const idx = RIDE_STEPS.findIndex((s) => s.key === status);

  return (

    <div className="driver-step-track mb-4">

      {RIDE_STEPS.map((step, i) => (

        <div key={step.key} className="space-y-1.5">

          <div

            className={`driver-step-bar ${i <= idx ? (i === idx ? 'is-active' : 'is-done') : ''}`}

            title={step.label}

          />

          <span className={`block text-[9px] font-bold uppercase tracking-wide truncate ${

            i <= idx ? 'text-brand-orange' : 'text-brand-grey/70'

          }`}

          >

            {step.label}

          </span>

        </div>

      ))}

    </div>

  );

}



function OnlineToggle({ online, coords, driverMove, onToggle }) {

  return (

    <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-white/90 backdrop-blur-md border border-white/80 shadow-lg shadow-black/5">

      <div className="flex items-center gap-3 min-w-0">

        <div className={`relative w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${

          online ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30' : 'bg-brand-surface text-brand-grey'

        }`}

        >

          <Power className="w-5 h-5" />

          {online && (

            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-white border-2 border-emerald-500 admin-live-dot" />

          )}

        </div>

        <div className="min-w-0">

          <div className="font-black text-brand-black text-sm leading-tight">

            {online ? 'You\'re online' : 'You\'re offline'}

          </div>

          <div className="text-[11px] text-brand-grey truncate mt-0.5">

            {online

              ? coords

                ? driverMove.moving && driverMove.speedKmh != null

                  ? `Moving · ~${Math.round(driverMove.speedKmh)} km/h`

                  : 'Ready for rides · GPS active'

                : 'Locating you…'

              : 'Go online to receive requests'}

          </div>

        </div>

      </div>

      <button

        type="button"

        onClick={onToggle}

        className={`shrink-0 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${

          online

            ? 'bg-brand-surface text-brand-dark hover:bg-brand-border border border-brand-border'

            : 'bg-brand-orange text-white hover:bg-brand-orange/90 shadow-md shadow-brand-orange/25'

        }`}

      >

        {online ? 'Go offline' : 'Go online'}

      </button>

    </div>

  );

}



function ActiveRidePanel({ ride, here, busyCode, onAdvance }) {

  const navTarget = ride.driverRideStatus === 'started'

    ? { lat: ride.dropoffLat, lng: ride.dropoffLng }

    : { lat: ride.pickupLat, lng: ride.pickupLng };

  const distToTarget = here && navTarget.lat != null ? haversineKm(here, navTarget) : null;

  const eta = distToTarget != null ? etaMinutes(distToTarget) : null;

  const next = NEXT[ride.driverRideStatus];

  const wa = whatsappLink(ride.passengerWhatsapp, `Hi, I'm your Smart Mappia driver for ${ride.bookingCode}`);



  return (

    <Card className="driver-panel overflow-hidden border-0">

      <div className="bg-gradient-to-br from-brand-orange/10 via-white to-blue-50/40 px-5 pt-5 pb-4 border-b border-brand-border/60">

        <div className="flex items-start justify-between gap-3 mb-1">

          <div>

            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange mb-1">Active ride</p>

            <h2 className="font-black text-lg text-brand-black leading-tight">

              {STATUS_LABELS[ride.driverRideStatus] || ride.driverRideStatus}

            </h2>

          </div>

          <div className="text-right shrink-0">

            <div className="text-[10px] font-bold text-brand-grey uppercase">Fare</div>

            <div className="font-black text-xl text-brand-orange leading-none mt-0.5">SAR {ride.fareAmount}</div>

          </div>

        </div>

        <RideProgress status={ride.driverRideStatus} />

      </div>



      <div className="p-5 space-y-4">

        <div className="flex items-center gap-3 p-3 rounded-2xl bg-brand-muted/80 border border-brand-border/60">

          <div className="w-11 h-11 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">

            <User className="w-5 h-5" />

          </div>

          <div className="min-w-0 flex-1">

            <div className="text-[10px] font-bold text-brand-grey uppercase">Passenger</div>

            <div className="font-bold text-brand-black truncate">{ride.passengerName}</div>

            <div className="text-[11px] font-mono text-brand-grey">{ride.bookingCode}</div>

          </div>

          {eta != null && (

            <div className="text-right shrink-0 pl-2">

              <div className="inline-flex items-center gap-1 text-brand-orange font-black text-sm">

                <Clock className="w-3.5 h-3.5" />

                {eta} min

              </div>

              {distToTarget != null && (

                <div className="text-[10px] text-brand-grey font-bold mt-0.5">{distToTarget.toFixed(1)} km away</div>

              )}

            </div>

          )}

        </div>



        <div className="space-y-0">

          <div className="flex gap-3">

            <div className="flex flex-col items-center pt-1">

              <span className="w-3.5 h-3.5 rounded-full bg-blue-500 ring-4 ring-blue-500/20 shrink-0" />

              <div className="driver-route-line flex-1 my-1" />

            </div>

            <div className="pb-3 min-w-0 flex-1">

              <div className="text-[10px] font-bold text-brand-grey uppercase mb-0.5">Pickup · Client</div>

              <div className="text-sm font-semibold text-brand-dark leading-snug">{ride.pickupAddress}</div>

            </div>

          </div>

          <div className="flex gap-3">

            <div className="flex flex-col items-center pt-1">

              <span className="w-3.5 h-3.5 rounded-full bg-brand-dark ring-4 ring-brand-dark/15 shrink-0" />

            </div>

            <div className="min-w-0 flex-1">

              <div className="text-[10px] font-bold text-brand-grey uppercase mb-0.5">Drop-off</div>

              <div className="text-sm font-semibold text-brand-dark leading-snug">{ride.dropoffAddress}</div>

            </div>

          </div>

        </div>



        {next && (

          <button

            type="button"

            onClick={() => onAdvance(ride.bookingCode, next.status)}

            disabled={busyCode === ride.bookingCode}

            className={btnPrimary + ' w-full !py-3.5 !text-base !rounded-2xl'}

          >

            {busyCode === ride.bookingCode ? (

              <Spinner className="!border-white/40 !border-t-white" />

            ) : (

              <>

                <ChevronRight className="w-5 h-5" />

                {next.label}

              </>

            )}

          </button>

        )}



        <div className="grid grid-cols-2 gap-2.5">

          {wa && (

            <a

              href={wa}

              target="_blank"

              rel="noreferrer"

              className="inline-flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm font-bold

                bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"

            >

              <MessageCircle className="w-4 h-4 shrink-0" />

              Message

            </a>

          )}

          {navTarget?.lat != null && (

            <a

              href={`https://waze.com/ul?ll=${navTarget.lat},${navTarget.lng}&navigate=yes`}

              target="_blank"

              rel="noreferrer"

              className={`inline-flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm font-bold

                bg-brand-dark text-white hover:bg-black transition-colors ${!wa ? 'col-span-2' : ''}`}

            >

              <Navigation className="w-4 h-4 shrink-0" />

              Waze

            </a>

          )}

        </div>

      </div>

    </Card>

  );

}



function RequestCard({ ride, dist, busyCode, onAccept }) {

  return (

    <div className="group p-4 rounded-2xl border border-brand-border/80 bg-white hover:border-brand-orange/40 hover:shadow-md hover:shadow-brand-orange/5 transition-all">

      <div className="flex items-start justify-between gap-2 mb-2">

        <span className="font-mono text-[11px] font-bold text-brand-grey bg-brand-muted px-2 py-0.5 rounded-md">

          {ride.bookingCode}

        </span>

        {dist != null && (

          <span className="inline-flex items-center gap-1 text-xs font-black text-brand-orange shrink-0">

            <Clock className="w-3 h-3" />

            {dist.toFixed(1)} km · ~{etaMinutes(dist)} min

          </span>

        )}

      </div>

      <div className="space-y-1.5 mb-3">

        <div className="flex gap-2 text-sm text-brand-dark">

          <MapPin className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />

          <span className="line-clamp-2 leading-snug">{ride.pickupAddress}</span>

        </div>

        <div className="flex gap-2 text-sm text-brand-grey">

          <Flag className="w-4 h-4 text-brand-dark shrink-0 mt-0.5" />

          <span className="line-clamp-1">{ride.dropoffAddress}</span>

        </div>

      </div>

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-brand-border/60">

        <span className="font-black text-brand-orange">SAR {ride.fareAmount}</span>

        <button

          type="button"

          onClick={() => onAccept(ride.bookingCode)}

          disabled={busyCode === ride.bookingCode}

          className={btnPrimary + ' !py-2 !px-5 !rounded-xl !text-sm'}

        >

          {busyCode === ride.bookingCode ? <Spinner className="!border-white/40 !border-t-white" /> : 'Accept ride'}

        </button>

      </div>

    </div>

  );

}



export default function DriverPage() {

  const { driverApproved, profile } = useAuth();

  const [online, setOnline] = useState(false);

  const [available, setAvailable] = useState([]);

  const [activeRide, setActiveRide] = useState(null);

  const [error, setError] = useState(null);

  const [busyCode, setBusyCode] = useState(null);

  const [lastPayout, setLastPayout] = useState(null);

  const [driverMove, setDriverMove] = useState({ speedKmh: null, moving: false, heading: null });

  const prevCoordRef = useRef(null);



  const { coords, error: geoError } = useGeolocation({ watch: true, enabled: online });

  const coordsRef = useRef(coords);

  coordsRef.current = coords;



  useEffect(() => {

    if (!coords) return;

    const now = Date.now();

    const prev = prevCoordRef.current;

    if (prev && (prev.lat !== coords.lat || prev.lng !== coords.lng)) {

      const dt = (now - prev.t) / 1000;

      setDriverMove({ ...movementFrom(prev, coords, dt), heading: bearingDeg(prev, coords) });

    }

    prevCoordRef.current = { lat: coords.lat, lng: coords.lng, t: now };

  }, [coords?.lat, coords?.lng]);



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

      here && { ...here, type: 'driver', label: 'You', key: 'me', heading: driverMove.heading },

      activeRide.pickupLat != null && {

        lat: activeRide.pickupLat,

        lng: activeRide.pickupLng,

        type: 'passenger',

        label: activeRide.passengerName || 'Client',

        key: 'client',

      },

      activeRide.dropoffLat != null && { lat: activeRide.dropoffLat, lng: activeRide.dropoffLng, type: 'dropoff', label: 'Drop-off', key: 'd' },

    ].filter(Boolean);

    if (here && activeRide.pickupLat != null && activeRide.driverRideStatus !== 'started') {

      line = [here, { lat: activeRide.pickupLat, lng: activeRide.pickupLng }];

    }

  } else {

    markers = [

      here && { ...here, type: 'driver', label: 'You', key: 'me', heading: driverMove.heading },

      ...available.filter((r) => r.pickupLat != null).map((r) => ({

        lat: r.pickupLat,

        lng: r.pickupLng,

        type: 'pickup',

        label: r.pickupAddress,

        key: r.bookingCode,

      })),

    ].filter(Boolean);

  }



  const navTarget = activeRide

    ? activeRide.driverRideStatus === 'started'

      ? { lat: activeRide.dropoffLat, lng: activeRide.dropoffLng }

      : { lat: activeRide.pickupLat, lng: activeRide.pickupLng }

    : null;



  const clientDist = here && activeRide?.pickupLat != null

    ? haversineKm(here, { lat: activeRide.pickupLat, lng: activeRide.pickupLng })

    : null;

  const clientFarAway = clientDist != null && clientDist > 80;



  const mapLegend = [

    here && { glyph: '●', color: '#FF7E21', label: 'You' },

    activeRide

      ? { glyph: 'C', color: '#2563EB', label: 'Client' }

      : { glyph: 'P', color: '#FF7E21', label: 'Requests' },

    activeRide && { glyph: 'D', color: '#1F2937', label: 'Drop-off' },

  ].filter(Boolean);



  const sortedAvailable = [...available]

    .map((r) => ({ ...r, dist: here ? haversineKm(here, { lat: r.pickupLat, lng: r.pickupLng }) : null }))

    .sort((a, b) => (a.dist == null ? 1 : b.dist == null ? -1 : a.dist - b.dist));



  return (

    <PortalShell

      wide

      title="Driver"

      subtitle={online ? 'Online · receiving rides' : 'Offline'}

      right={

        online && realtimeEnabled ? (

          <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">

            <Radio className="w-3 h-3" />

            Live

          </span>

        ) : null

      }

    >

      <div className="driver-shell -mx-1 px-1 pb-2">

        {error && (

          <div className="mb-4 p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">

            {error}

          </div>

        )}



        {geoError && online && !coords && (

          <div className="mb-4 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">

            {geoError}

          </div>

        )}



        {lastPayout && !activeRide && (

          <div className="mb-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-3">

            <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">

              <Check className="w-5 h-5" />

            </div>

            <div>

              <div className="font-black text-emerald-800">Trip completed</div>

              <div className="text-sm text-emerald-700">

                Payout <b>SAR {lastPayout.driverNet}</b> · {lastPayout.payoutStatus}

              </div>

            </div>

          </div>

        )}



        <div className="flex flex-col lg:flex-row gap-4 lg:gap-5 lg:items-start">

          {/* Map — hero column */}

          <div className="flex-1 min-w-0 space-y-3 lg:sticky lg:top-20">

            <div className="relative driver-map-frame rounded-3xl overflow-hidden border border-brand-border/50 bg-white">

              <RideMap

                markers={markers}

                line={line}

                legend={mapLegend}

                height={activeRide ? 420 : 460}

                className="!rounded-none !border-0 !shadow-none"

                follow={!!activeRide && !!here}

                followTarget={navTarget}

              />



              {clientFarAway && activeRide && (

                <div className="absolute top-3 left-3 right-3 z-[400] pointer-events-none">

                  <div className="bg-amber-50/95 backdrop-blur-sm border border-amber-200 text-amber-900 text-xs font-medium px-3 py-2 rounded-xl shadow-sm">

                    Client pickup is in Riyadh ({clientDist.toFixed(0)} km away). Map shows your area — use Waze to navigate.

                  </div>

                </div>

              )}



              {activeRide && !clientFarAway && clientDist != null && (

                <div className="absolute top-3 right-3 z-[400] pointer-events-none">

                  <div className="bg-white/95 backdrop-blur-sm border border-brand-border px-3 py-2 rounded-xl shadow-lg text-right">

                    <div className="text-[10px] font-bold text-brand-grey uppercase">To client</div>

                    <div className="font-black text-brand-black">{clientDist.toFixed(1)} km · ~{etaMinutes(clientDist)} min</div>

                  </div>

                </div>

              )}

            </div>



            <OnlineToggle

              online={online}

              coords={coords}

              driverMove={driverMove}

              onToggle={() => setOnline((v) => !v)}

            />

          </div>



          {/* Side panel */}

          <div className="lg:w-[400px] shrink-0 space-y-4">

            {activeRide ? (

              <ActiveRidePanel

                ride={activeRide}

                here={here}

                busyCode={busyCode}

                onAdvance={advance}

              />

            ) : (

              <Card className="driver-panel border-0 overflow-hidden">

                <div className="px-5 pt-5 pb-3 border-b border-brand-border/60">

                  <div className="flex items-center justify-between gap-2">

                    <div>

                      <h2 className="font-black text-lg text-brand-black">Nearby requests</h2>

                      <p className="text-xs text-brand-grey mt-0.5">

                        {online ? 'Sorted by distance from you' : 'Go online to start receiving rides'}

                      </p>

                    </div>

                    <Badge tone={online ? 'green' : 'grey'}>{sortedAvailable.length}</Badge>

                  </div>

                </div>



                <div className="p-4 space-y-3 max-h-[520px] overflow-y-auto">

                  {!online && (

                    <div className="text-center py-10 px-4">

                      <div className="w-14 h-14 rounded-2xl bg-brand-muted mx-auto mb-3 flex items-center justify-center">

                        <Power className="w-7 h-7 text-brand-grey" />

                      </div>

                      <p className="font-bold text-brand-dark">You&apos;re offline</p>

                      <p className="text-sm text-brand-grey mt-1">Toggle online below the map to see ride requests.</p>

                    </div>

                  )}

                  {online && sortedAvailable.length === 0 && (

                    <div className="text-center py-10 px-4">

                      <Spinner className="!w-7 !h-7 mx-auto mb-3" />

                      <p className="font-bold text-brand-dark">Waiting for requests</p>

                      <p className="text-sm text-brand-grey mt-1">New rides appear here in real time.</p>

                    </div>

                  )}

                  {online && sortedAvailable.map((r) => (

                    <RequestCard

                      key={r.bookingCode}

                      ride={r}

                      dist={r.dist}

                      busyCode={busyCode}

                      onAccept={accept}

                    />

                  ))}

                </div>

              </Card>

            )}

          </div>

        </div>

      </div>

    </PortalShell>

  );

}


