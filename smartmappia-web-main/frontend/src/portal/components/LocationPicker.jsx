import { useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, MapPin, Search, Share2, X } from 'lucide-react';
import { api } from '../lib/api';
import { getCurrentPositionOnce, haversineKm } from '../lib/geo';
import RideMap from './RideMap';
import { btnGhost, btnPrimary, inputClass, Spinner } from './ui';

function mapsLink(coords) {
  if (!coords?.lat || !coords?.lng) return '';
  return `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
}

export default function LocationPicker({
  label = 'Location',
  placeholder = 'Search nearby locations',
  address,
  coords,
  onChange,
  showMap = true,
  className = '',
}) {
  const [query, setQuery] = useState(address || '');
  const [results, setResults] = useState([]);
  const [nearby, setNearby] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setQuery(address || '');
  }, [address]);

  // Google Places session token: shared across the autocomplete keystrokes and
  // the final Details lookup so the whole pick bills as ONE cheap session. Reset
  // after each successful pick (Details ends the session).
  const sessionTokenRef = useRef(null);
  function ensureToken() {
    if (!sessionTokenRef.current) {
      sessionTokenRef.current =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return sessionTokenRef.current;
  }

  const lastNearbyRef = useRef(null);
  useEffect(() => {
    if (!coords?.lat || !coords?.lng) {
      setNearby([]);
      lastNearbyRef.current = null;
      return undefined;
    }
    // Only refetch nearby when the pin moved a meaningful distance (~150m).
    // Small map nudges must NOT spam /nearby — that chattiness was a 429 driver.
    const prev = lastNearbyRef.current;
    const moved = !prev || (haversineKm(prev, { lat: coords.lat, lng: coords.lng }) ?? 1) > 0.15;
    if (!moved) return undefined;
    lastNearbyRef.current = { lat: coords.lat, lng: coords.lng };
    let alive = true;
    api.locationNearby(coords.lat, coords.lng)
      .then((data) => { if (alive) setNearby(data.places || []); })
      .catch(() => { if (alive) setNearby([]); });
    return () => { alive = false; };
  }, [coords?.lat, coords?.lng]);

  useEffect(() => {
    const q = query.trim();
    // Skip searching only when the query matches an address that is already a
    // confirmed selection (coords present). While the user is free-typing, coords
    // are null, so the autocomplete must still search — otherwise there is nothing
    // to pick and no way to attach real coordinates to the address.
    if (q.length < 3 || (q === (address || '').trim() && !!coords?.lat && !!coords?.lng)) {
      setResults([]);
      return undefined;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const data = await api.locationSearch(q, coords || {}, ensureToken());
        if (alive) setResults(data.results || []);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setSearching(false);
      }
    }, 550);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, address, coords?.lat, coords?.lng]);

  const markers = useMemo(() => {
    const selected = coords?.lat && coords?.lng
      ? [{ ...coords, type: 'home', label: address || 'Selected location', key: 'selected' }]
      : [];
    const places = nearby.slice(0, 12).map((p) => ({
      lat: p.lat,
      lng: p.lng,
      glyph: '•',
      color: '#2563EB',
      label: p.name,
      key: `nearby-${p.id}`,
    }));
    return [...selected, ...places];
  }, [address, coords, nearby]);

  // Google Autocomplete predictions carry no coords — resolve them with a
  // Details lookup (shares the session token) on selection.
  async function choose(place) {
    setResults([]);
    setSearching(true);
    setError(null);
    try {
      let coordsOut = null;
      let finalAddress = place.name || place.address || query;
      if (place.lat != null && place.lng != null) {
        coordsOut = { lat: place.lat, lng: place.lng };
      } else if (place.id) {
        const data = await api.locationDetails(place.id, sessionTokenRef.current);
        if (data.place?.lat != null && data.place?.lng != null) {
          coordsOut = { lat: data.place.lat, lng: data.place.lng };
          finalAddress = data.place.address || finalAddress;
        }
      }
      sessionTokenRef.current = null; // Details ends the session — next search starts fresh.
      if (!coordsOut) {
        setQuery(place.name || query);
        setError('Could not pin that place. Try another result or use your current location.');
        return;
      }
      setQuery(finalAddress);
      onChange?.({ address: finalAddress, coords: coordsOut });
    } catch (err) {
      setError(err.message || 'Could not pin that place.');
    } finally {
      setSearching(false);
    }
  }

  // One-shot high-accuracy fix via the shared, Capacitor-aware helper — so this
  // picker (merchant + user pin-drop) uses native GPS in the APK, not just the
  // browser API.
  async function useCurrentLocation() {
    setLocating(true);
    setError(null);
    try {
      const pos = await getCurrentPositionOnce();
      const nextCoords = { lat: pos.lat, lng: pos.lng };
      let nextAddress = 'My current location';
      try {
        const data = await api.locationReverse(nextCoords.lat, nextCoords.lng);
        nextAddress = data.place?.address || data.place?.name || nextAddress;
      } catch {
        /* GPS still works even if reverse geocoding fails. */
      }
      setQuery(nextAddress);
      onChange?.({ address: nextAddress, coords: nextCoords });
    } catch (err) {
      setError(err.message || 'Could not get your location. Please allow location access and try again.');
    } finally {
      setLocating(false);
    }
  }

  async function shareLocation() {
    if (!coords?.lat || !coords?.lng) return;
    const url = mapsLink(coords);
    const text = `${address || 'My location'}\n${url}`;
    if (navigator.share) {
      await navigator.share({ title: 'Smart Mappia location', text, url }).catch(() => {});
    } else {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <span className="text-xs font-bold text-brand-grey uppercase tracking-wider block mb-1.5">
          {label}
        </span>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-grey" />
          <input
            className={`${inputClass} pl-9 pr-10`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // A hand-typed string is not a geocoded point — drop any stale coords so
              // coordinates only ever come from picking a result or "Use current location".
              onChange?.({ address: e.target.value, coords: null });
            }}
            placeholder={placeholder}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults([]);
                onChange?.({ address: '', coords: null });
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-brand-grey hover:bg-brand-surface"
              aria-label="Clear location"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <button type="button" onClick={useCurrentLocation} disabled={locating} className={btnGhost + ' flex-1'}>
          {locating ? <Spinner /> : <LocateFixed className="w-4 h-4" />}
          {coords ? 'Update current location' : 'Use current location'}
        </button>
        <button type="button" onClick={shareLocation} disabled={!coords} className={btnPrimary + ' sm:w-auto'}>
          <Share2 className="w-4 h-4" />
          {copied ? 'Copied' : 'Share'}
        </button>
      </div>

      {(searching || results.length > 0 || error) && (
        <div className="rounded-2xl border border-brand-border bg-white overflow-hidden">
          {searching && <div className="px-3 py-2 text-xs text-brand-grey font-bold">Searching nearby...</div>}
          {error && <div className="px-3 py-2 text-xs text-red-600 font-bold">{error}</div>}
          {results.map((place) => (
            <button
              key={place.id}
              type="button"
              onClick={() => choose(place)}
              className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-brand-surface border-t first:border-t-0 border-brand-border"
            >
              <MapPin className="w-4 h-4 text-brand-orange shrink-0 mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-brand-dark truncate">{place.name}</span>
                <span className="block text-xs text-brand-grey truncate">{place.address}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {showMap && (
        <div className="space-y-2">
          <RideMap
            markers={markers}
            height={260}
            legend={[
              coords && { glyph: 'H', color: '#FF7E21', label: 'Selected location' },
              nearby.length > 0 && { glyph: '•', color: '#2563EB', label: 'Nearby places' },
            ].filter(Boolean)}
          />
          <p className="text-xs text-brand-grey">
            {nearby.length > 0
              ? `${nearby.length} nearby places found around this pin.`
              : 'Search or use your current location to show nearby places on the map.'}
          </p>
        </div>
      )}
    </div>
  );
}
