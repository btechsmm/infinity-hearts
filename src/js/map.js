import { CONFIG } from './config.js';
import { CITIES, greatCircleKm, greatCirclePoints, kmToMiles } from './core/geo.js';
import { h, fmtNum } from './util.js';
import { state } from './api.js';

let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = CONFIG.leafletCss;
    const js = document.createElement('script');
    js.src = CONFIG.leafletJs; js.async = true;
    js.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet missing')));
    js.onerror = () => { leafletPromise = null; reject(new Error('Leaflet failed to load')); };
    document.head.append(css, js);
  });
  return leafletPromise;
}

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text) e.textContent = text; return e; };

/** Local illustration: real coordinates on a lat/lon graticule (no coastlines are bundled). Used when tiles cannot load. */
function fallbackSvg(a, b) {
  const LON0 = 14, LON1 = 76, LAT0 = -10, LAT1 = 34, W = 600;
  const sx = W / (LON1 - LON0), H = (LAT1 - LAT0) * sx;
  const X = (lon) => (lon - LON0) * sx, Y = (lat) => (LAT1 - lat) * sx;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'fallback', preserveAspectRatio: 'xMidYMid slice', role: 'img', 'aria-label': `Illustration: ${a.name}, ${a.country} to ${b.name}, ${b.country}` });
  for (let lon = 20; lon <= 70; lon += 10) s.append(svg('line', { x1: X(lon), y1: 0, x2: X(lon), y2: H, stroke: '#2a1c21', 'stroke-width': 1 }));
  for (let lat = -10; lat <= 30; lat += 10) s.append(svg('line', { x1: 0, y1: Y(lat), x2: W, y2: Y(lat), stroke: '#2a1c21', 'stroke-width': 1 }));
  const pts = greatCirclePoints(a, b, 48).map(([la, lo]) => `${X(lo).toFixed(1)},${Y(la).toFixed(1)}`).join(' ');
  s.append(svg('polyline', { points: pts, fill: 'none', stroke: '#e0112b', 'stroke-width': 2.4, 'stroke-dasharray': '8 6', class: 'route-anim', 'stroke-linecap': 'round' }));
  for (const c of [a, b]) {
    s.append(svg('circle', { cx: X(c.lon), cy: Y(c.lat), r: 7, fill: '#e0112b', stroke: '#fff', 'stroke-width': 2 }));
    const left = c === a;
    s.append(svg('text', { x: X(c.lon) + (left ? 12 : -12), y: Y(c.lat) + 4, fill: '#f6f2f2', 'font-size': 17, 'font-weight': 600, 'text-anchor': left ? 'start' : 'end', 'font-family': 'system-ui,sans-serif' }, `${c.name}, ${c.country}`));
  }
  return s;
}

export function distanceKm() {
  return greatCircleKm(
    { lat: state.cfg.home.lat, lon: state.cfg.home.lon },
    { lat: state.cfg.destination.lat, lon: state.cfg.destination.lon });
}

/** Builds the map card body. Returns { el, destroy }. */
export function mapSection() {
  const a = { ...CITIES.nairobi, ...state.cfg.home };
  const b = { ...CITIES.manama, ...state.cfg.destination };
  const km = Math.round(distanceKm());
  const box = h('div', { class: 'mapbox' });
  const note = h('span', { class: 'mapnote', hidden: true });
  box.append(fallbackSvg(a, b), note);
  const el = h('div', {},
    box,
    h('div', { class: 'distance' },
      h('div', {}, h('b', {}, `≈ ${fmtNum(km)} km`), h('span', { class: 'sub' }, ` (${fmtNum(Math.round(kmToMiles(km)))} mi)`)),
      h('span', { class: 'script' }, 'Miles apart, connected by love.')),
    h('p', { class: 'hint' }, 'Approximate great-circle (straight-line over the Earth) distance between the two city centres. Not a flight distance.'));

  let map = null, destroyed = false;
  const showNote = (t) => { note.textContent = t; note.hidden = !t; };

  async function upgrade() {
    if (!navigator.onLine) { showNote('Offline: showing local map illustration'); return; }
    try {
      const L = await loadLeaflet();
      if (destroyed) return;
      box.replaceChildren(note);
      map = L.map(box, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, worldCopyJump: false });
      L.tileLayer(CONFIG.tileUrl, { maxZoom: 8, minZoom: 2, attribution: CONFIG.tileAttribution, crossOrigin: true }).addTo(map);
      const pts = greatCirclePoints(a, b, 64);
      L.polyline(pts, { color: '#e0112b', weight: 2.5, dashArray: '8 6', className: 'route-anim' }).addTo(map);
      for (const c of [a, b]) {
        L.circleMarker([c.lat, c.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#e0112b', fillOpacity: 1 }).addTo(map)
          .bindTooltip(`${c.name}, ${c.country} ♥`, { permanent: true, direction: c === a ? 'right' : 'left', className: 'pin-label', offset: [c === a ? 8 : -8, 0] });
      }
      map.fitBounds(L.latLngBounds(pts), { padding: [26, 26] });
      showNote('');
    } catch (e) {
      box.replaceChildren(fallbackSvg(a, b), note);
      showNote('Map tiles unavailable: showing local illustration');
    }
  }
  const onOffline = () => { if (!map) showNote('Offline: showing local map illustration'); else showNote('Offline: map may be partly cached'); };
  const onOnline = () => { if (!map) upgrade(); else showNote(''); };
  window.addEventListener('offline', onOffline); window.addEventListener('online', onOnline);
  upgrade();
  return { el, destroy() { destroyed = true; window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); map?.remove(); } };
}
