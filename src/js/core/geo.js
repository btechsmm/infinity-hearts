export const CITIES = {
  nairobi: { name: 'Nairobi', country: 'Kenya', lat: -1.2921, lon: 36.8219, timezone: 'Africa/Nairobi' },
  manama: { name: 'Manama', country: 'Bahrain', lat: 26.2235, lon: 50.5876, timezone: 'Asia/Bahrain' },
};

const R_KM = 6371.0088; // mean Earth radius

const rad = (d) => (d * Math.PI) / 180;

/** Great-circle (haversine) distance in km. Not a flight distance. */
export function greatCircleKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Intermediate points along the great circle, for drawing the route on a real map. */
export function greatCirclePoints(a, b, steps = 64) {
  const [la1, lo1, la2, lo2] = [rad(a.lat), rad(a.lon), rad(b.lat), rad(b.lon)];
  const d = greatCircleKm(a, b) / R_KM;
  if (d === 0) return [[a.lat, a.lon]];
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    pts.push([(Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, (Math.atan2(y, x) * 180) / Math.PI]);
  }
  return pts;
}

export const kmToMiles = (km) => km * 0.621371;
