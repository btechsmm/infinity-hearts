// Generates a Web Push (VAPID) key pair with Node's built-in crypto. No npm packages needed.
//   node scripts/gen-vapid.mjs
// Public key  -> VAPID_PUBLIC_KEY in the Render environment (safe to expose to browsers).
// Private key -> `supabase secrets set VAPID_PRIVATE_KEY=...` ONLY. Never commit it, never put it in browser code.
import { createECDH } from 'node:crypto';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const b64u = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
console.log('VAPID_PUBLIC_KEY=' + b64u(ecdh.getPublicKey()));
console.log('VAPID_PRIVATE_KEY=' + b64u(ecdh.getPrivateKey()));
