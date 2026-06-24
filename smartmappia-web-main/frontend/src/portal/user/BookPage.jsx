// ---------------------------------------------------------------------
// Passenger: book a trip, then pay (STC Pay proof upload).
// On success -> /track/:code (the Grab-style live tracking screen).
// ---------------------------------------------------------------------
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthProvider';
import {
  Upload,
  CheckCircle2,
  Crosshair,
  ArrowLeft,
  CreditCard,
  Copy,
  FileImage,
} from 'lucide-react';
import { api } from '../lib/api';
import { uploadProofFile } from '../lib/supabaseClient';
import { useGeolocation } from '../lib/geo';
import { AIRPORTS, fareBreakdown, airportDropdownOptions } from '../lib/constants';
import { PortalShell, Card, Field, inputClass, btnPrimary, btnGhost, Spinner } from '../components/ui';
import CustomDropdown from '../../components/CustomDropdown';
import DateTimePicker from '../../components/DateTimePicker';
import RideMap from '../components/RideMap';
import {
  DirectionToggle,
  FareSummary,
  LocationHint,
  MapPinLegend,
  LegalConsentNote,
} from '../../components/booking/BookingUI';
import TapPayButton from '../../components/booking/TapPayButton';

const FARE = fareBreakdown();
const AIRPORT_OPTIONS = airportDropdownOptions();

export default function BookPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const [step, setStep] = useState('form');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [direction, setDirection] = useState('house_to_airport');
  const [airport, setAirport] = useState(AIRPORTS[0]);
  const [homeAddress, setHomeAddress] = useState('');
  const [homeCoords, setHomeCoords] = useState(null);
  const [datetime, setDatetime] = useState('');
  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');

  useEffect(() => {
    const dir = searchParams.get('direction');
    if (dir === 'house_to_airport' || dir === 'airport_to_house') {
      setDirection(dir);
    }

    const airportId = searchParams.get('airport');
    const fromLanding = AIRPORTS.find((a) => a.id === airportId);
    if (fromLanding) setAirport(fromLanding);

    const district = searchParams.get('district');
    if (district) setHomeAddress((addr) => addr || `${district} District, Riyadh`);
  }, [searchParams]);

  useEffect(() => {
    if (profile?.fullName) setName((n) => n || profile.fullName);
    if (profile?.whatsapp) setWhatsapp((w) => w || profile.whatsapp);
  }, [profile]);

  const { coords: geo } = useGeolocation({ enabled: false });

  const [booking, setBooking] = useState(null);
  const [instructions, setInstructions] = useState(null);
  const [file, setFile] = useState(null);
  const [copied, setCopied] = useState(null);

  function useMyLocation() {
    if (!('geolocation' in navigator)) return setError('Geolocation not available.');
    navigator.geolocation.getCurrentPosition(
      (p) => setHomeCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => setError(e.message),
      { enableHighAccuracy: true }
    );
  }

  function copyText(key, text) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
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

  const currentStep = step === 'form' ? 1 : 2;

  return (
    <PortalShell
      title="Book a Pick & Drop"
      subtitle={step === 'form' ? `SAR ${FARE.total.toFixed(2)} · Step ${currentStep} of 2` : `Booking ${booking?.bookingCode}`}
      onBack={step === 'pay' ? () => setStep('form') : () => navigate('/')}
    >
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
          {error}
        </div>
      )}

      {step === 'form' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="p-6 md:p-7 overflow-visible">
            <form onSubmit={submitBooking} className="space-y-5">
              <DirectionToggle value={direction} onChange={setDirection} variant="inline" />

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Airport terminal">
                  <CustomDropdown
                    value={airport.id}
                    onChange={(id) => setAirport(AIRPORTS.find((a) => a.id === id) || AIRPORTS[0])}
                    options={AIRPORT_OPTIONS}
                    allowEmpty={false}
                    drawerTitle="Airport terminal"
                  />
                </Field>
                <Field label="Pickup date & time">
                  <DateTimePicker value={datetime} onChange={setDatetime} />
                </Field>
              </div>

              <Field label={direction === 'house_to_airport' ? 'Your address (pickup)' : 'Your address (drop-off)'}>
                <div className="flex gap-2.5">
                  <input
                    className={inputClass}
                    placeholder="e.g. Al Olaya, Riyadh"
                    value={homeAddress}
                    onChange={(e) => setHomeAddress(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={useMyLocation}
                    className={btnGhost + ' shrink-0 px-4'}
                    title="Use my GPS location"
                  >
                    <Crosshair className="w-4 h-4" />
                  </button>
                </div>
                {homePoint && <LocationHint active lat={homePoint.lat} lng={homePoint.lng} />}
                <p className="text-xs text-brand-grey mt-1.5">Tap the crosshair to pin your exact location</p>
              </Field>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Your name">
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
                </Field>
                <Field label="WhatsApp">
                  <input className={inputClass} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+9665XXXXXXXX" />
                </Field>
              </div>

              <FareSummary fare={FARE} showButton buttonLabel="Continue to payment" busy={busy} compact />
              <LegalConsentNote />
            </form>
          </Card>

          <Card className="p-3 self-start overflow-hidden hidden lg:block">
            <div className="px-2 py-2 border-b border-brand-border mb-2">
              <p className="text-xs font-black text-brand-black">Route preview</p>
            </div>
            <RideMap markers={mapMarkers} legend={mapLegend} height={380} />
            <div className="px-2 pt-2">
              <MapPinLegend />
            </div>
          </Card>
        </div>
      )}

      {step === 'pay' && instructions && (
        <div className="max-w-2xl mx-auto space-y-5">
          <button
            onClick={() => setStep('form')}
            className="text-sm text-brand-grey hover:text-brand-dark inline-flex items-center gap-1.5 cursor-pointer font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> Back to trip details
          </button>

          <Card className="overflow-hidden">
            <div className="px-6 py-5 bg-gradient-to-r from-green-50 to-white border-b border-brand-border">
              <div className="flex items-center gap-2 text-green-700 font-black">
                <CheckCircle2 className="w-5 h-5" />
                Trip reserved — complete payment
              </div>
              <p className="text-sm text-brand-grey mt-1">
                Booking code{' '}
                <span className="font-mono font-bold text-brand-dark bg-brand-surface px-2 py-0.5 rounded-md">
                  {booking.bookingCode}
                </span>
              </p>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <TapPayButton bookingCode={booking.bookingCode} />
                <div className="relative my-5 text-center">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-brand-border" /></div>
                  <span className="relative bg-white px-3 text-xs font-bold uppercase tracking-wider text-brand-grey">or pay manually</span>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-8 rounded-xl bg-brand-warm text-brand-orange flex items-center justify-center">
                    <CreditCard size={16} />
                  </span>
                  <div>
                    <h3 className="font-black text-brand-black text-sm">Pay via STC Pay</h3>
                    <p className="text-xs text-brand-grey">Transfer the exact amount below</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-brand-border divide-y divide-brand-border overflow-hidden">
                  {[
                    { key: 'number', label: 'STC Pay number', value: instructions.stcPay.number || '—' },
                    { key: 'name', label: 'Recipient', value: instructions.stcPay.recipientName },
                    { key: 'ref', label: 'Reference (add as note)', value: instructions.reference, mono: true },
                  ].map(({ key, label, value, mono }) => (
                    <div key={key} className="flex items-center justify-between gap-3 px-4 py-3 bg-white">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold text-brand-grey uppercase tracking-wider">{label}</p>
                        <p className={`text-sm font-bold text-brand-dark truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyText(key, value)}
                        className="shrink-0 p-2 rounded-lg hover:bg-brand-surface text-brand-grey hover:text-brand-orange transition-colors cursor-pointer"
                        title="Copy"
                      >
                        {copied === key ? (
                          <CheckCircle2 size={16} className="text-green-600" />
                        ) : (
                          <Copy size={16} />
                        )}
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-4 bg-brand-warm">
                    <span className="text-sm font-bold text-brand-dark">Total to pay</span>
                    <span className="text-2xl font-black text-brand-orange tabular-nums">
                      SAR {Number(instructions.fare?.total ?? instructions.amount).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold text-brand-grey uppercase tracking-widest mb-3">How to pay</p>
                <ol className="space-y-2">
                  {instructions.instructions.map((s, i) => (
                    <li key={i} className="flex gap-3 text-sm text-brand-dark">
                      <span className="w-6 h-6 rounded-full bg-brand-orange/10 text-brand-orange text-xs font-black flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <span className="pt-0.5 leading-relaxed">{s}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <p className="text-[10px] font-bold text-brand-grey uppercase tracking-widest mb-3">Upload payment proof</p>
                <label
                  className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 cursor-pointer transition-colors ${
                    file
                      ? 'border-green-400 bg-green-50'
                      : 'border-brand-border bg-brand-muted hover:border-brand-orange/50 hover:bg-brand-warm/50'
                  }`}
                >
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="sr-only"
                  />
                  {file ? (
                    <>
                      <CheckCircle2 className="w-8 h-8 text-green-600" />
                      <span className="text-sm font-bold text-green-800">{file.name}</span>
                      <span className="text-xs text-green-700">Tap to change file</span>
                    </>
                  ) : (
                    <>
                      <FileImage className="w-8 h-8 text-brand-grey" />
                      <span className="text-sm font-bold text-brand-dark">Upload STC Pay screenshot</span>
                      <span className="text-xs text-brand-grey">PNG, JPG, or PDF</span>
                    </>
                  )}
                </label>
              </div>

              <button onClick={submitProof} disabled={busy || !file} className={btnPrimary + ' w-full py-4'}>
                {busy ? <Spinner className="!border-white/40 !border-t-white" /> : <><Upload className="w-4 h-4" /> Submit proof & start tracking</>}
              </button>

              {instructions.testMode && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-center font-medium">
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
