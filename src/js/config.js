// Runtime configuration. /config.js (generated at build time from environment variables) sets window.IH_CONFIG.
// Only the PUBLIC anon key and VAPID public key belong here. Never put a service-role key in the browser.
const c = (typeof window !== 'undefined' && window.IH_CONFIG) || {};

const isReal = (v) => typeof v === 'string' && v.length > 8 && !v.startsWith('YOUR_') && !v.includes('placeholder');

export const CONFIG = {
  supabaseUrl: isReal(c.SUPABASE_URL) ? c.SUPABASE_URL : '',
  supabaseAnonKey: isReal(c.SUPABASE_ANON_KEY) ? c.SUPABASE_ANON_KEY : '',
  vapidPublicKey: isReal(c.VAPID_PUBLIC_KEY) ? c.VAPID_PUBLIC_KEY : '',
  supabaseLib: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  leafletJs: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  leafletCss: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: '&copy; OpenStreetMap contributors',
};
export const CLOUD = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

export const APP = {
  name: 'Infinity Hearts',
  couple: 'Becam & Faith',
  tagline: 'Two cities. One love. One journey back to each other.',
  support: 'Every second brings us closer to the day we meet again.',
};
