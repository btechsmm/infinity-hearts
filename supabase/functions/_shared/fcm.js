// Firebase Cloud Messaging (HTTP v1) sender for the Android app. Uses only Web Crypto + fetch, so it runs in Deno and Node.
// The service-account JSON lives ONLY in the Edge Function secret FCM_SERVICE_ACCOUNT; it never reaches the browser or the app.
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const strB64u = (s) => b64u(new TextEncoder().encode(s));

export function parseServiceAccount(raw) {
    try {
        const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!o?.client_email || !o?.private_key || !o?.project_id) return null;
        return { client_email: o.client_email, private_key: String(o.private_key).replace(/\\n/g, '\n'), project_id: o.project_id };
    } catch { return null; }
}

async function importKey(pem) {
    const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** Signed JWT that Google exchanges for a short-lived access token. */
export async function signJwt(sa, nowSec = Math.floor(Date.now() / 1000)) {
    const head = strB64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = strB64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600 }));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importKey(sa.private_key), new TextEncoder().encode(`${head}.${claim}`));
    return `${head}.${claim}.${b64u(sig)}`;
}

let cached = { token: '', exp: 0 };
async function accessToken(sa, fetchFn) {
    if (cached.token && cached.exp > Date.now() + 60000) return cached.token;
    const res = await fetchFn('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${await signJwt(sa)}`,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`FCM auth failed: ${res.status} ${j.error_description || j.error || ''}`);
    cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return cached.token;
}

export const CHAT_CHANNEL = 'infinity-hearts-chat';
export const DAILY_CHANNEL = 'infinity-hearts-daily';

/** The FCM message for one phone. `notification` makes Android show it itself even when the app is closed. */
export function buildFcmMessage(token, { title, body, url = '/#/messages', tag = 'ih', channelId = CHAT_CHANNEL, kind = 'chat' }) {
    return {
        message: {
            token,
            notification: { title: String(title).slice(0, 80), body: String(body).slice(0, 200) },
            data: { url, kind, tag },
            android: { priority: 'HIGH', ttl: '86400s', notification: { channel_id: channelId, tag, sound: 'default' } },
        },
    };
}

/** Returns { ok, gone }. gone=true means the token is dead and the row should be deleted. */
export async function sendFcm(sa, token, msg, fetchFn = fetch) {
    const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken(sa, fetchFn)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildFcmMessage(token, msg)),
    });
    if (res.ok) return { ok: true, gone: false };
    const j = await res.json().catch(() => ({}));
    const code = j?.error?.details?.find?.((d) => d.errorCode)?.errorCode || j?.error?.status || '';
    return { ok: false, gone: res.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT' && /token/i.test(j?.error?.message || ''), status: res.status, code };
}
export const resetFcmCache = () => { cached = { token: '', exp: 0 }; };