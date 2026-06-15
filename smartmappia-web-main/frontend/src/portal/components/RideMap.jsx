// ---------------------------------------------------------------------
// Leaflet map styled for Smart Mappia (warm light tiles, brand pins).
// ---------------------------------------------------------------------
import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { RIYADH_CENTER } from '../lib/constants';

const BRAND = {
  orange: '#FF7E21',
  red: '#E62B25',
  dark: '#1F2937',
  grey: '#6B7280',
};

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

function resolvePinStyle(marker) {
  if (marker.type === 'driver') {
    return { kind: 'driver', color: BRAND.orange, glyph: '●' };
  }
  if (marker.type === 'pickup' || marker.glyph === 'P') {
    return { kind: 'pickup', color: BRAND.orange, glyph: marker.glyph || 'P' };
  }
  if (marker.type === 'dropoff' || marker.glyph === 'D') {
    return { kind: 'dropoff', color: BRAND.dark, glyph: marker.glyph || 'D' };
  }
  if (marker.type === 'home' || marker.glyph === 'H') {
    return { kind: 'home', color: BRAND.orange, glyph: 'H' };
  }
  if (marker.type === 'airport' || marker.glyph === 'A') {
    return { kind: 'airport', color: BRAND.dark, glyph: 'A' };
  }
  return {
    kind: 'default',
    color: marker.color || BRAND.orange,
    glyph: marker.glyph || '•',
  };
}

function pin(marker) {
  const { kind, color, glyph } = resolvePinStyle(marker);
  const isDriver = kind === 'driver';
  const size = isDriver ? 40 : 36;

  const inner = isDriver
    ? `<div class="sm-map-driver-core">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2.7-5.4A2 2 0 0 0 13.5 3h-3A2 2 0 0 0 8.7 4.6L6 10l-2.5 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/>
          <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
        </svg>
      </div>`
    : `<span class="sm-map-pin-glyph">${glyph}</span>`;

  return L.divIcon({
    className: `sm-map-pin-wrap ${isDriver ? 'sm-map-pin-wrap--driver' : ''}`,
    html: `<div class="sm-map-pin sm-map-pin--${kind}" style="--pin-color:${color};--pin-size:${size}px">
      <div class="sm-map-pin-body">${inner}</div>
      <div class="sm-map-pin-tail"></div>
    </div>`,
    iconSize: [size, size + 10],
    iconAnchor: [size / 2, size + 8],
    popupAnchor: [0, -(size + 4)],
  });
}

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    const valid = points.filter((p) => p && p.lat != null && p.lng != null);
    if (valid.length === 0) return;
    if (valid.length === 1) {
      map.setView([valid[0].lat, valid[0].lng], 14, { animate: true });
    } else {
      map.fitBounds(valid.map((p) => [p.lat, p.lng]), { padding: [48, 48], maxZoom: 15 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points.map((p) => [p?.lat, p?.lng]))]);
  return null;
}

function MapLegend({ items }) {
  if (!items?.length) return null;
  return (
    <div className="absolute bottom-3 left-3 z-[400] flex flex-wrap gap-2 pointer-events-none">
      {items.map((item) => (
        <span
          key={item.label}
          className="inline-flex items-center gap-1.5 bg-white/95 backdrop-blur-sm border border-brand-border rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-brand-dark shadow-sm"
        >
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white font-black shrink-0"
            style={{ backgroundColor: item.color }}
          >
            {item.glyph}
          </span>
          {item.label}
        </span>
      ))}
    </div>
  );
}

export default function RideMap({
  markers = [],
  line = null,
  height = 320,
  className = '',
  legend = null,
}) {
  const valid = markers.filter((m) => m && m.lat != null && m.lng != null);
  const center = valid[0] ? [valid[0].lat, valid[0].lng] : [RIYADH_CENTER.lat, RIYADH_CENTER.lng];

  const linePositions = line && line.length >= 2 ? line.map((p) => [p.lat, p.lng]) : null;

  return (
    <div
      className={`relative rounded-2xl overflow-hidden border border-brand-border bg-brand-surface shadow-inner ${className}`}
      style={{ height }}
    >
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom
        style={{ height: '100%', width: '100%', background: '#F3F4F6' }}
        className="sm-ride-map"
      >
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
        {linePositions && (
          <>
            <Polyline
              positions={linePositions}
              pathOptions={{ color: '#FFFFFF', weight: 8, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }}
            />
            <Polyline
              positions={linePositions}
              pathOptions={{
                color: BRAND.orange,
                weight: 4,
                opacity: 0.9,
                dashArray: '10 8',
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </>
        )}
        {valid.map((m, i) => (
          <Marker key={m.key || i} position={[m.lat, m.lng]} icon={pin(m)}>
            {m.label && (
              <Popup>
                <span className="text-sm font-bold text-brand-dark">{m.label}</span>
              </Popup>
            )}
          </Marker>
        ))}
        <FitBounds points={valid} />
      </MapContainer>

      {legend && <MapLegend items={legend} />}
    </div>
  );
}
