// ---------------------------------------------------------------------
// Geo helpers + a browser geolocation hook.
// ---------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { AIRPORTS, RIYADH_CENTER } from './constants';
import { confirmAction } from './notify';

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

    const onOk = (pos) => {
      // A fresh fix clears any earlier transient error (e.g. a watch "Timeout
      // expired") so we don't keep showing a stale warning once we have a spot.
      if (!pos) return;
      setError(null);
      setCoords({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
    };
    const onErr = (e) => setError(e?.message || 'Could not get your location.');
    const opts = { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 };

    // Native (Capacitor) path: the Geolocation plugin gives reliable GPS and
    // triggers the Android runtime permission prompt. watchPosition() resolves a
    // watch id asynchronously, so guard against teardown while awaiting.
    if (Capacitor.isNativePlatform()) {
      let watchId = null;
      let cancelled = false;
      (async () => {
        try {
          let perm = await Geolocation.checkPermissions();
          if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
            perm = await Geolocation.requestPermissions();
          }
          if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
            setError('Location permission denied.');
            return;
          }
          if (watch) {
            const id = await Geolocation.watchPosition(opts, (pos, err) => {
              if (err) onErr(err);
              else onOk(pos);
            });
            if (cancelled) Geolocation.clearWatch({ id });
            else watchId = id;
          } else {
            const pos = await Geolocation.getCurrentPosition(opts);
            if (!cancelled) onOk(pos);
          }
        } catch (e) {
          if (!cancelled) onErr(e);
        }
      })();
      return () => {
        cancelled = true;
        if (watchId != null) Geolocation.clearWatch({ id: watchId });
      };
    }

    // Web/browser path.
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setError('Geolocation is not available in this browser.');
      return undefined;
    }
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

// One-shot high-accuracy fix, Capacitor-aware. Unlike useGeolocation (a React
// hook for continuous watching), this is a plain promise for button actions like
// the location picker's "Use current location". On native it uses the Capacitor
// plugin (Fused Location Provider + runtime permission), on web the browser API —
// so merchant/user pin-drop gets the SAME high-accuracy GPS the driver already has.
export async function getCurrentPositionOnce(opts = {}) {
  const options = { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000, ...opts };

  if (Capacitor.isNativePlatform()) {
    let perm = await Geolocation.checkPermissions();
    if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
      perm = await Geolocation.requestPermissions();
    }
    if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
      throw new Error('Location permission denied.');
    }
    const pos = await Geolocation.getCurrentPosition(options);
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
  }

  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    throw new Error('Location is not available in this browser.');
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(err?.message || 'Could not get your location.')),
      options
    );
  });
}

// Proactively ask for location permission ONCE (e.g. right after sign-in), with
// a friendly explainer before the browser's native prompt. Safe to call
// repeatedly and never throws: it no-ops if geolocation is unavailable, the
// user already decided (granted/denied), or we've asked before. This is why
// the location picker no longer fails cold the first time it needs a fix.
const GEO_PROMPT_KEY = 'sm_geo_prompted';

export async function ensureLocationPermission() {
  try {
    const native = Capacitor.isNativePlatform();
    if (!native && (typeof navigator === 'undefined' || !('geolocation' in navigator))) return;
    if (localStorage.getItem(GEO_PROMPT_KEY)) return; // asked before — don't nag

    // If the user already granted/denied, record it and skip the explainer.
    if (native) {
      try {
        const perm = await Geolocation.checkPermissions();
        // Treat "granted if either fine OR coarse is granted" — same rule as
        // useGeolocation, so the stored prompt flag matches actual behavior.
        const granted = perm.location === 'granted' || perm.coarseLocation === 'granted';
        const denied = perm.location === 'denied' && perm.coarseLocation === 'denied';
        const state = granted ? 'granted' : denied ? 'denied' : 'prompt';
        if (state === 'granted' || state === 'denied') {
          localStorage.setItem(GEO_PROMPT_KEY, state);
          return;
        }
      } catch {
        /* not decidable here — fall through and ask. */
      }
    } else if (navigator.permissions?.query) {
      try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        if (status.state === 'granted' || status.state === 'denied') {
          localStorage.setItem(GEO_PROMPT_KEY, status.state);
          return;
        }
      } catch {
        /* geolocation not queryable here — fall through and ask. */
      }
    }

    // Mark asked up front so a reload mid-prompt never double-asks.
    localStorage.setItem(GEO_PROMPT_KEY, '1');
    const ok = await confirmAction({
      title: 'Share your location?',
      text: 'SmartMappia uses your location to show nearby places and match you with nearby drivers.',
      confirmText: 'Allow location',
      cancelText: 'Not now',
      icon: 'info',
    });
    if (!ok) return;

    if (native) {
      // Native: this is what actually surfaces the Android runtime prompt.
      try { await Geolocation.requestPermissions(); } catch { /* ignore */ }
    } else {
      // Fire the browser's native prompt (result handled elsewhere when needed).
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => {},
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
      );
    }
  } catch {
    /* never let the permission prompt break sign-in */
  }
}
