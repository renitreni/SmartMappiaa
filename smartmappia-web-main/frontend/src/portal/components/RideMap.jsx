// ---------------------------------------------------------------------
// RideMap — the shared map for every screen (tracking, booking, driver,
// food, location picker). This is a thin SHELL: the actual renderer is the
// Google Maps JS API living in ./google/GoogleMap.jsx, lazy-loaded so the
// map engine is only downloaded on screens that actually show a map. One
// integration serves the website AND the Capacitor APK webview.
//
// The prop contract is unchanged from the old Leaflet/MapLibre versions —
// markers, line, height, className, legend, follow, followTarget — so no
// consumer ever needs to know the engine swapped. `interactive` + `onIdle`
// are new: they opt into free panning with a center-idle callback, for the
// "adjust pin on map" flow (LocationPicker draws its own fixed center pin).
// ---------------------------------------------------------------------
import { lazy, Suspense } from 'react';

const GoogleMap = lazy(() => import('./google/GoogleMap.jsx'));

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
  interactive = false,
  onIdle = null,
  initialCenter = null,
  children = null,
}) {
  return (
    <div
      className={`relative isolate rounded-2xl overflow-hidden border border-brand-border bg-brand-surface shadow-inner ${className}`}
      style={{ height }}
    >
      <Suspense
        fallback={<div className="w-full h-full animate-pulse" style={{ background: '#F3F4F6' }} />}
      >
        <GoogleMap
          markers={markers}
          line={line}
          follow={follow}
          followTarget={followTarget}
          interactive={interactive}
          onIdle={onIdle}
          initialCenter={initialCenter}
        />
      </Suspense>

      {legend && <MapLegend items={legend} />}
      {children}
    </div>
  );
}
