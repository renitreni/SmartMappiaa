// ---------------------------------------------------------------------
// RideMap — the shared map for every screen (tracking, booking, driver,
// food, location picker). This is a thin SHELL: the actual renderer is
// MapLibre GL (Grab-style interactive vector map) living in
// ./maplibre/MapLibreMap.jsx, lazy-loaded so the ~250KB map engine is
// only downloaded on screens that actually show a map.
//
// The prop contract is unchanged from the old Leaflet version — markers,
// line, height, className, legend, follow, followTarget — so no consumer
// ever needs to know the engine swapped.
// ---------------------------------------------------------------------
import { lazy, Suspense } from 'react';

const MapLibreMap = lazy(() => import('./maplibre/MapLibreMap.jsx'));

// MapLibre GL v5 needs WebGL2. Probe once per session BEFORE fetching the
// chunk — unsupported devices get a graceful placeholder and never pay the
// download. (maplibregl.supported() was removed in v3+, hence the manual probe.)
let webgl2Support = null;
function supportsWebGL2() {
  if (webgl2Support == null) {
    try {
      webgl2Support =
        typeof document !== 'undefined' &&
        !!document.createElement('canvas').getContext('webgl2');
    } catch {
      webgl2Support = false;
    }
  }
  return webgl2Support;
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
            {...(item.svg ? { dangerouslySetInnerHTML: { __html: item.svg } } : {})}
          >
            {item.svg ? null : item.glyph}
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
  follow = false,
  followTarget = null,
}) {
  return (
    <div
      className={`relative isolate rounded-2xl overflow-hidden border border-brand-border bg-brand-surface shadow-inner ${className}`}
      style={{ height }}
    >
      {supportsWebGL2() ? (
        <Suspense
          fallback={<div className="w-full h-full animate-pulse" style={{ background: '#F3F4F6' }} />}
        >
          <MapLibreMap markers={markers} line={line} follow={follow} followTarget={followTarget} />
        </Suspense>
      ) : (
        <div
          className="w-full h-full flex items-center justify-center"
          style={{ background: '#F3F4F6' }}
        >
          <p className="text-sm font-bold text-brand-grey px-6 text-center">
            The live map is not supported on this device or browser.
          </p>
        </div>
      )}

      {legend && <MapLegend items={legend} />}
    </div>
  );
}
