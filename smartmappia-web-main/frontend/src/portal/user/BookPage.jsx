// ---------------------------------------------------------------------
// Passenger: book a trip, then pay (STC Pay proof upload).
// On success -> /track/:code (the Grab-style live tracking screen).
// ---------------------------------------------------------------------
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthProvider';
import { Plane, Home, Upload, CheckCircle2, Crosshair, ArrowRight, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { uploadProofFile } from '../lib/supabaseClient';
import { useGeolocation } from '../lib/geo';
import { AIRPORTS, fareBreakdown } from '../lib/constants';
import { PortalShell, Card, Field, inputClass, fileInputClass, btnPrimary, btnGhost, Spinner } from '../components/ui';
import CustomDropdown from '../../components/CustomDropdown';
import DateTimePicker from '../../components/DateTimePicker';
import RideMap from '../components/RideMap';

const FARE = fareBreakdown();
const AIRPORT_OPTIONS = AIRPORTS.map((a) => ({ value: a.id, label: a.name }));

export default function BookPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const [step, setStep] = useState('form'); // form | pay
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // form fields
  const [direction, setDirection] = useState('house_to_airport');
  const [airport, setAirport] = useState(AIRPORTS[0]);
  const [homeAddress, setHomeAddress] = useState('');
  const [homeCoords, setHomeCoords] = useState(null);
  const [datetime, setDatetime] = useState('');
  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');

  // Prefill from landing-page fare estimator (?direction=&airport=&district=).
  useEffect(() => {
    const direction = searchParams.get('direction');
    if (direction === 'house_to_airport' || direction === 'airport_to_house') {
      setDirection(direction);
    }

    const airportId = searchParams.get('airport');
    const fromLanding = AIRPORTS.find((a) => a.id === airportId);
    if (fromLanding) setAirport(fromLanding);

    const district = searchParams.get('district');
    if (district) setHomeAddress((addr) => addr || `${district} District, Riyadh`);
  }, [searchParams]);

  // Prefill contact details from the signed-in profile.
  useEffect(() => {
    if (profile?.fullName) setName((n) => n || profile.fullName);
    if (profile?.whatsapp) setWhatsapp((w) => w || profile.whatsapp);
  }, [profile]);

  const { coords: geo } = useGeolocation({ enabled: false });

  // payment state
  const [booking, setBooking] = useState(null);
  const [instructions, setInstructions] = useState(null);
  const [file, setFile] = useState(null);

  function useMyLocation() {
    if (!('geolocation' in navigator)) return setError('Geolocation not available.');
    navigator.geolocation.getCurrentPosition(
      (p) => setHomeCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => setError(e.message),
      { enableHighAccuracy: true }
    );
  }

  const homePoint = homeCoords || geo || null;
  const mapMarkers = [
    homePoint && { lat: homePoint.lat, lng: homePoint.lng, type: 'home', label: 'Your location', key: 'home' },
    { lat: airport.lat, lng: airport.lng, type: 'airport', label: airport.name, key: 'airport' },
  ].filter(Boolean);

  const mapLegend = [
    homePoint && { glyph: 'H', color: '#FF7E21', label: 'Your location' },
    { glyph: 'A', color: '#1F2937', label: 'Airport' },
  ].filter(Boolean);

  async function submitBooking(e) {
    e.preventDefault();
    setError(null);
    if (!name || !whatsapp || !datetime) {
      return setError('Please fill in your name, WhatsApp number, and pickup time.');
    }
    const home = { address: homeAddress || 'My location', lat: homePoint?.lat ?? null, lng: homePoint?.lng ?? null };
    const air = { address: airport.name, lat: airport.lat, lng: airport.lng };
    const toAirport = direction === 'house_to_airport';
    const pickup = toAirport ? home : air;
    const dropoff = toAirport ? air : home;

    setBusy(true);
    try {
      const created = await api.createBooking({
        trip_type: direction,
        airport_terminal: airport.name,
        pickup_address: pickup.address,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dropoff_address: dropoff.address,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        pickup_datetime: new Date(datetime).toISOString(),
        passenger_name: name,
        passenger_whatsapp: whatsapp,
      });
      setBooking(created);
      const inst = await api.paymentInstructions(created.bookingCode);
      setInstructions(inst);
      setStep('pay');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitProof() {
    if (!file) return setError('Please choose a screenshot of your STC Pay transfer.');
    setError(null);
    setBusy(true);
    try {
      const signed = await api.proofSignedUrl(booking.bookingCode, {
        file_name: file.name,
        mime_type: file.type,
      });
      await uploadProofFile(signed.bucket, signed.path, signed.token, file);
      await api.recordProof(booking.bookingCode, {
        path: signed.path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      });
      navigate(`/track/${booking.bookingCode}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalShell
      title="Book a Pick & Drop"
      subtitle={`Fare · SAR ${FARE.total.toFixed(2)} (incl. ${FARE.serviceFeePercent}% service fee)`}
      onBack={step === 'pay' ? () => setStep('form') : () => navigate('/')}
    >
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
          {error}
        </div>
      )}

      {step === 'form' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="p-6 overflow-visible">
            <form onSubmit={submitBooking} className="space-y-5">
              <div className="grid grid-cols-2 gap-2 bg-brand-surface p-1.5 rounded-xl border border-brand-border">
                <button
                  type="button"
                  onClick={() => setDirection('house_to_airport')}
                  className={`py-2.5 rounded-lg text-xs md:text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    direction === 'house_to_airport'
                      ? 'bg-brand-orange text-white shadow-md shadow-brand-orange/20'
                      : 'text-brand-grey hover:text-brand-dark'
                  }`}
                >
                  <Home size={16} />
                  House
                  <ArrowRight size={14} />
                  <Plane size={16} />
                  Airport
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('airport_to_house')}
                  className={`py-2.5 rounded-lg text-xs md:text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    direction === 'airport_to_house'
                      ? 'bg-brand-orange text-white shadow-md shadow-brand-orange/20'
                      : 'text-brand-grey hover:text-brand-dark'
                  }`}
                >
                  <Plane size={16} />
                  Airport
                  <ArrowRight size={14} />
                  <Home size={16} />
                  House
                </button>
              </div>

              <Field label="Airport Terminal">
                <CustomDropdown
                  value={airport.id}
                  onChange={(id) => setAirport(AIRPORTS.find((a) => a.id === id) || AIRPORTS[0])}
                  options={AIRPORT_OPTIONS}
                  allowEmpty={false}
                />
              </Field>

              <Field label={direction === 'house_to_airport' ? 'Pickup (your address)' : 'Drop-off (your address)'}>
                <div className="flex gap-2">
                  <input
                    className={inputClass}
                    placeholder="e.g. Al Olaya, Riyadh"
                    value={homeAddress}
                    onChange={(e) => setHomeAddress(e.target.value)}
                  />
                  <button type="button" onClick={useMyLocation} className={btnGhost + ' shrink-0 px-3'} title="Use my location">
                    <Crosshair className="w-4 h-4" />
                  </button>
                </div>
                {homePoint && (
                  <span className="text-xs text-green-600 font-medium mt-1 inline-block">
                    Location set ({homePoint.lat.toFixed(4)}, {homePoint.lng.toFixed(4)})
                  </span>
                )}
              </Field>

              <Field label="Pickup date & time">
                <DateTimePicker value={datetime} onChange={setDatetime} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Your name">
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
                </Field>
                <Field label="WhatsApp">
                  <input className={inputClass} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+9665XXXXXXXX" />
                </Field>
              </div>

              <div className="pt-3 border-t border-brand-border space-y-1.5">
                <div className="flex justify-between text-sm text-brand-grey">
                  <span>Base fare</span>
                  <span>SAR {FARE.base.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm text-brand-grey">
                  <span>Service fee ({FARE.serviceFeePercent}%)</span>
                  <span>SAR {FARE.serviceFee.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-brand-border">
                  <div>
                    <div className="text-xs font-bold text-brand-grey uppercase">Total</div>
                    <div className="text-2xl font-black text-brand-orange">SAR {FARE.total.toFixed(2)}</div>
                  </div>
                  <button type="submit" disabled={busy} className={btnPrimary}>
                    {busy ? <Spinner className="!border-white/40 !border-t-white" /> : 'Continue to payment'}
                  </button>
                </div>
              </div>
            </form>
          </Card>

          <Card className="p-3 self-start overflow-hidden">
            <RideMap markers={mapMarkers} legend={mapLegend} height={420} />
            <p className="text-xs text-brand-grey px-3 py-2">
              <b className="text-brand-orange">H</b> your location · <b className="text-brand-dark">A</b> airport terminal. Tap the crosshair to set your exact pickup so the nearest driver can find you.
            </p>
          </Card>
        </div>
      )}

      {step === 'pay' && instructions && (
        <div className="max-w-xl mx-auto">
          <Card className="p-6">
            <button
              onClick={() => setStep('form')}
              className="text-sm text-brand-grey hover:text-brand-dark mb-4 inline-flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Edit trip details
            </button>
            <div className="flex items-center gap-2 text-brand-orange font-black mb-1">
              <CheckCircle2 className="w-5 h-5" /> Booking created
            </div>
            <p className="text-sm text-brand-grey mb-5">
              Booking code <span className="font-mono font-bold text-brand-dark">{booking.bookingCode}</span>
            </p>

            <div className="bg-brand-warm border border-brand-border rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-brand-grey">Send via STC Pay to</span><span className="font-bold">{instructions.stcPay.number || '—'}</span></div>
              <div className="flex justify-between"><span className="text-brand-grey">Recipient</span><span className="font-bold">{instructions.stcPay.recipientName}</span></div>
              {instructions.fare && (
                <>
                  <div className="flex justify-between"><span className="text-brand-grey">Base fare</span><span>SAR {instructions.fare.base.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-brand-grey">Service fee ({instructions.fare.serviceFeePercent}%)</span><span>SAR {instructions.fare.serviceFee.toFixed(2)}</span></div>
                </>
              )}
              <div className="flex justify-between pt-2 border-t border-brand-border"><span className="text-brand-grey font-bold">Total to pay</span><span className="font-black text-brand-orange">SAR {(instructions.fare?.total ?? instructions.amount)}</span></div>
              <div className="flex justify-between"><span className="text-brand-grey">Reference (note)</span><span className="font-mono font-bold">{instructions.reference}</span></div>
            </div>

            <ol className="list-decimal list-inside text-sm text-brand-dark mt-4 space-y-1">
              {instructions.instructions.map((s, i) => <li key={i}>{s}</li>)}
            </ol>

            <div className="mt-5">
              <Field label="Upload your STC Pay screenshot">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className={fileInputClass}
                />
              </Field>
              <button onClick={submitProof} disabled={busy} className={btnPrimary + ' w-full mt-4'}>
                {busy ? <Spinner className="!border-white/40 !border-t-white" /> : <><Upload className="w-4 h-4" /> Submit proof & track</>}
              </button>
              {instructions.testMode && (
                <p className="text-xs text-amber-600 mt-2 text-center font-medium">
                  Test mode is ON — your payment will auto-verify instantly.
                </p>
              )}
            </div>
          </Card>
        </div>
      )}
    </PortalShell>
  );
}
