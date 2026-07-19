// ---------------------------------------------------------------------
// The MapLibre GL map behind RideMap — Grab-style interactive vector map:
// smooth WebGL pan/zoom, rotate + tilt gestures, 3D buildings at street
// zoom, the brand pins/route/camera behaviors ported 1:1 from the old
// Leaflet renderer. This file is the LAZY CHUNK: maplibre-gl and its CSS
// are imported here (not in main.jsx) so only map screens download them.
//
// Props (same subset RideMap forwards): markers, line, follow, followTarget.
// ---------------------------------------------------------------------
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { RIYADH_CENTER } from '../../lib/constants';
import { haversineKm } from '../../lib/geo';
import { buildPinEl, refreshPinEl, updateDriverHeading, pinSignature } from './pinHtml';

// Vector style. Default: OpenFreeMap "positron" (free, keyless — matches the
// old CARTO-light look). Prod can flip to the self-hosted KSA tiles on the VPS
// (style JSON whose sources use pmtiles://) with just this env var.
const STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// --- One-time module setup --------------------------------------------------
// pmtiles protocol: registered unconditionally (a no-op unless a style source
// actually uses pmtiles://) so the Phase-B self-hosted tiles need zero code.
try {
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
} catch {
  /* already registered (HMR) */
}
// Arabic street names need the RTL text plugin or letters render disconnected.
// lazy:true defers the download until RTL glyphs are actually on screen.
try {
  if (maplibregl.getRTLTextPluginStatus?.() === 'unavailable') {
    maplibregl.setRTLTextPlugin(
      'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js',
      true
    );
  }
} catch {
  /* already set (HMR) */
}

function firstSymbolLayerId(map) {
  try {
    return (map.getStyle()?.layers || []).find((l) => l.type === 'symbol')?.id;
  } catch {
    return undefined;
  }
}

// Route source + the two-line casing effect (white base under orange dashes),
// inserted below the first symbol layer so street labels stay readable on top.
function addRouteLayers(map) {
  if (map.getSource('sm-route')) return;
  map.addSource('sm-route', { type: 'geojson', data: EMPTY_FC });
  const before = firstSymbolLayerId(map);
  map.addLayer(
    {
      id: 'sm-route-casing',
      type: 'line',
      source: 'sm-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FFFFFF', 'line-width': 8, 'line-opacity': 0.85 },
    },
    before
  );
  map.addLayer(
    {
      id: 'sm-route-line',
      type: 'line',
      source: 'sm-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#FF7E21',
        'line-width': 4,
        'line-opacity': 0.9,
        // dasharray is in multiples of line-width: 10px/8px at width 4.
        'line-dasharray': [2.5, 2],
      },
    },
    before
  );
}

// Grab-style 3D buildings: extrude the OpenMapTiles `building` layer from
// street zoom, growing in between z15.5 and z16.5. Skipped when the style
// already ships its own extrusions or has no vector source.
function add3dBuildings(map) {
  try {
    const style = map.getStyle();
    if (!style || (style.layers || []).some((l) => l.type === 'fill-extrusion')) return;
    const srcEntry = Object.entries(style.sources || {}).find(([, s]) => s.type === 'vector');
    if (!srcEntry) return;
    map.addLayer(
      {
        id: 'sm-3d-buildings',
        type: 'fill-extrusion',
        source: srcEntry[0],
        'source-layer': 'building',
        minzoom: 15.5,
        paint: {
          'fill-extrusion-color': '#e6e2da',
          'fill-extrusion-height': [
            'interpolate', ['linear'], ['zoom'],
            15.5, 0,
            16.5, ['coalesce', ['get', 'render_height'], 4],
          ],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.75,
        },
      },
      firstSymbolLayerId(map)
    );
  } catch {
    /* style without a building layer — 2D only, no harm */
  }
}

export default function MapLibreMap({
  markers = [],
  line = null,
  follow = false,
  followTarget = null,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const styleReadyRef = useRef(null);
  const markerStoreRef = useRef(new Map()); // id -> { marker, el, sig, isDriver, label }
  const driverPosRef = useRef(null); // live (tweened) driver position
  const rafRef = useRef(null);
  const didFollowFitRef = useRef(false); // framed the follow view once yet?

  const valid = markers.filter((m) => m && m.lat != null && m.lng != null);
  const driver = valid.find((m) => m.type === 'driver') || null;

  // --- 1. Create the map once (full cleanup for StrictMode/HMR) -------------
  useEffect(() => {
    const first = valid[0] || RIYADH_CENTER;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [first.lng, first.lat],
      zoom: 12,
      maxPitch: 60,
      attributionControl: { compact: true },
    });
    // Rotate/tilt gestures are on by default; the compass (with pitch arrow)
    // is the reset-north/reset-tilt affordance once the user rotates.
    map.addControl(
      new maplibregl.NavigationControl({ showZoom: false, showCompass: true, visualizePitch: true }),
      'top-right'
    );
    styleReadyRef.current = new Promise((resolve) => map.on('load', resolve));
    styleReadyRef.current.then(() => {
      if (mapRef.current !== map) return; // unmounted before the style loaded
      addRouteLayers(map);
      add3dBuildings(map);
    });
    mapRef.current = map;
    const store = markerStoreRef.current;
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      store.clear(); // map.remove() destroys the marker instances
      driverPosRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 2. Marker reconciler (create / update / remove, no leaks) ------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const store = markerStoreRef.current;
    const seen = new Set();

    valid.forEach((m, i) => {
      const id = String(m.key ?? `${m.type || 'pin'}:${i}`);
      seen.add(id);
      const sig = pinSignature(m);
      let entry = store.get(id);

      if (!entry) {
        const { el, size, isDriver } = buildPinEl(m);
        if (isDriver) el.style.zIndex = '1000'; // float over static pins
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, 2] })
          .setLngLat([m.lng, m.lat])
          .addTo(map);
        entry = { marker, el, sig, isDriver, label: null };
        if (!isDriver && m.label) {
          el.style.cursor = 'pointer';
          const span = document.createElement('span');
          span.className = 'sm-map-popup-label';
          span.textContent = m.label;
          marker.setPopup(
            new maplibregl.Popup({ offset: size + 4, closeButton: false }).setDOMContent(span)
          );
          entry.label = m.label;
        }
        store.set(id, entry);
        if (isDriver) driverPosRef.current = { lat: m.lat, lng: m.lng };
        return;
      }

      if (entry.sig !== sig) {
        refreshPinEl(entry.el, m);
        entry.sig = sig;
      }
      if (entry.isDriver) {
        // Position is handled by the tween effect; heading rotates in place.
        updateDriverHeading(entry.el, m.heading);
      } else {
        entry.marker.setLngLat([m.lng, m.lat]);
        if (m.label && m.label !== entry.label) {
          const span = document.createElement('span');
          span.className = 'sm-map-popup-label';
          span.textContent = m.label;
          entry.marker.getPopup()?.setDOMContent(span);
          entry.label = m.label;
        }
      }
    });

    for (const [id, entry] of store) {
      if (!seen.has(id)) {
        entry.marker.remove();
        store.delete(id);
      }
    }
  }, [markers]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- 3. Driver tween: glide 1200ms between GPS fixes (Grab/Waze feel) -----
  useEffect(() => {
    if (!driver) return undefined;
    let entry = null;
    for (const e of markerStoreRef.current.values()) {
      if (e.isDriver) { entry = e; break; }
    }
    if (!entry) return undefined;

    const from = driverPosRef.current || { lat: driver.lat, lng: driver.lng };
    const to = { lat: driver.lat, lng: driver.lng };
    const jump = Math.abs(to.lat - from.lat) + Math.abs(to.lng - from.lng);
    // Snap instantly on the first fix or an implausible jump (test/teleport data).
    if (jump === 0 || jump > 0.5) {
      entry.marker.setLngLat([to.lng, to.lat]);
      driverPosRef.current = to;
      return undefined;
    }
    const duration = 1200;
    const start = performance.now();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const lat = from.lat + (to.lat - from.lat) * t;
      const lng = from.lng + (to.lng - from.lng) * t;
      entry.marker.setLngLat([lng, lat]);
      driverPosRef.current = { lat, lng };
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.lat, driver?.lng]);

  // --- 4. Route line data ----------------------------------------------------
  // Keyed on a coordinate signature, not the array reference — consumers build
  // fresh line arrays every render (GPS pings), and identical data must not
  // re-trigger a setData.
  const lineSig =
    line && line.length >= 2 ? JSON.stringify(line.map((p) => [p.lat, p.lng])) : '';
  useEffect(() => {
    const map = mapRef.current;
    const ready = styleReadyRef.current;
    if (!map || !ready) return undefined;
    let cancelled = false;
    ready.then(() => {
      if (cancelled || mapRef.current !== map) return;
      const src = map.getSource('sm-route');
      if (!src) return;
      src.setData(
        line && line.length >= 2
          ? {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: line.map((p) => [p.lng, p.lat]) },
            }
          : EMPTY_FC
      );
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineSig]);

  // --- 5. Camera: fit-all (default) ------------------------------------------
  const pointsSig = JSON.stringify(valid.map((p) => [p.lat, p.lng]));
  useEffect(() => {
    const map = mapRef.current;
    if (!map || (follow && driver) || valid.length === 0) return;
    // Preserve the user's rotation — fitBounds would otherwise snap north.
    const bearing = map.getBearing();
    if (valid.length === 1) {
      map.easeTo({ center: [valid[0].lng, valid[0].lat], zoom: 14 });
      return;
    }
    let maxSpread = 0;
    for (let i = 0; i < valid.length; i += 1) {
      for (let j = i + 1; j < valid.length; j += 1) {
        const d = haversineKm(valid[i], valid[j]);
        if (d != null && d > maxSpread) maxSpread = d;
      }
    }
    // Points on different continents (e.g. test GPS) — stay local, not world zoom.
    if (maxSpread > 80) {
      const d = valid.find((p) => p.type === 'driver') || valid[0];
      map.easeTo({ center: [d.lng, d.lat], zoom: 14 });
      return;
    }
    const bounds = valid.reduce(
      (b, p) => b.extend([p.lng, p.lat]),
      new maplibregl.LngLatBounds([valid[0].lng, valid[0].lat], [valid[0].lng, valid[0].lat])
    );
    map.fitBounds(bounds, { padding: 48, maxZoom: 15, bearing });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsSig, follow, !!driver]);

  // --- 6. Camera: follow the driver + leg target ------------------------------
  // Frame driver+target ONCE when follow engages, then gently PAN to the driver
  // at a stable zoom on each subsequent GPS ping (matching the marker's 1200ms
  // glide). Re-fitting on every ping made the camera re-zoom/jitter as the
  // driver neared the target.
  useEffect(() => {
    if (!follow) { didFollowFitRef.current = false; return; }
  }, [follow]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !follow || !driver) return;
    const bearing = map.getBearing();
    const hasTarget = followTarget && followTarget.lat != null && followTarget.lng != null;

    // Test/teleport data on far-apart points: stay local, don't world-zoom.
    if (hasTarget) {
      const dist = haversineKm(driver, followTarget);
      if (dist != null && dist > 80) {
        map.easeTo({ center: [driver.lng, driver.lat], zoom: 14, duration: 1200 });
        return;
      }
    }

    // First frame after follow engages: fit driver (+ target) once.
    if (!didFollowFitRef.current) {
      didFollowFitRef.current = true;
      if (hasTarget) {
        const bounds = new maplibregl.LngLatBounds(
          [driver.lng, driver.lat],
          [driver.lng, driver.lat]
        ).extend([followTarget.lng, followTarget.lat]);
        map.fitBounds(bounds, { padding: 72, maxZoom: 15, bearing });
      } else {
        map.easeTo({ center: [driver.lng, driver.lat], zoom: Math.max(map.getZoom(), 14) });
      }
      return;
    }

    // Subsequent pings: gentle pan to the driver, keeping the current zoom.
    map.easeTo({ center: [driver.lng, driver.lat], zoom: map.getZoom(), duration: 1200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, driver?.lat, driver?.lng, followTarget?.lat, followTarget?.lng]);

  return (
    <div
      ref={containerRef}
      className="sm-ride-map"
      style={{ height: '100%', width: '100%', background: '#F3F4F6' }}
    />
  );
}
