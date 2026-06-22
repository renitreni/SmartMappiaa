// ---------------------------------------------------------------------
// Geo helpers + a browser geolocation hook.
// ---------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { AIRPORTS, RIYADH_CENTER } from './constants';

const RIYADH_DISTRICTS = {
  malaz: { lat: 24.6872, lng: 46.7438 },
  olaya: { lat: 24.6905, lng: 46.6853 },
  sulamania: { lat: 24.6782, lng: 46.7127 },
  batha: { lat: 24.6315, lng: 46.7155 },
};

export function parseCoord(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Best-effort coords when the booking saved an address but no GPS pin. */
export function resolveCoordsFromAddress(address, lat, lng) {
  const resolvedLat = parseCoord(lat);
  const resolvedLng = parseCoord(lng);
  if (resolvedLat != null && resolvedLng != null) {
    return { lat: resolvedLat, lng: resolvedLng };
  }
  if (!address) return null;

  const lower = String(address).toLowerCase();
  for (const airport of AIRPORTS) {
    const name = airport.name.toLowerCase();
    if (lower.includes(name) || lower.includes('king khalid') || lower.includes('kkia')) {
      return { lat: airport.lat, lng: airport.lng };
    }
  }
  for (const [district, coords] of Object.entries(RIYADH_DISTRICTS)) {
    if (lower.includes(district)) return coords;
  }
  if (lower.includes('riyadh')) return RIYADH_CENTER;
  return null;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function etaMinutes(distanceKm, avgSpeedKmh = 30) {
  if (distanceKm == null) return null;
  return Math.max(1, Math.round((distanceKm / avgSpeedKmh) * 60));
}

// Compass bearing in degrees (0 = North, 90 = East) from point a to point b.
// Used to point the moving vehicle icon in its direction of travel.
export function bearingDeg(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI; // -180..180; CSS rotate handles negatives fine
}

// Speed + "is the vehicle moving?" between two points captured dtSeconds apart.
// Absurd speeds (GPS glitches or teleport test data) are ignored for the read.
export function movementFrom(prev, curr, dtSeconds, movingThresholdKmh = 3) {
  const km = haversineKm(prev, curr);
  if (km == null || !dtSeconds || dtSeconds <= 0) return { speedKmh: null, moving: false };
  const speed = (km / dtSeconds) * 3600;
  const speedKmh = speed > 400 ? null : speed;
  return { speedKmh, moving: speedKmh != null && speedKmh >= movingThresholdKmh };
}

// Watch (or one-shot) the device location.
//   useGeolocation({ watch: true, enabled: isOnline })
export function useGeolocation({ watch = false, enabled = true } = {}) {
  const [coords, setCoords] = useState(null);
  const [error, setError] = useState(null);
  const idRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setError('Geolocation is not available in this browser.');
      return undefined;
    }
    const onOk = (pos) => {
      // A fresh fix clears any earlier transient error (e.g. a watch "Timeout
      // expired") so we don't keep showing a stale warning once we have a spot.
      setError(null);
      setCoords({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
    };
    const onErr = (e) => setError(e.message || 'Could not get your location.');
    const opts = { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 };

    if (watch) {
      idRef.current = navigator.geolocation.watchPosition(onOk, onErr, opts);
    } else {
      navigator.geolocation.getCurrentPosition(onOk, onErr, opts);
    }
    return () => {
      if (idRef.current != null) navigator.geolocation.clearWatch(idRef.current);
    };
  }, [watch, enabled]);

  return { coords, error };
}
