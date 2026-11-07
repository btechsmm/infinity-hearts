// Pure helpers for chat push notifications and delivery acknowledgements (unit tested in Node, used by Edge Functions).
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Token that proves a delivery ack really came from a push we sent for this exact message. */
export async function ackToken(messageId, secret) {
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await crypto.subtle.sign('HMAC', key, enc.encode(`ack:${messageId}`)));
}
export async function verifyAck(messageId, token, secret) {
    if (!messageId || !token || !secret || typeof token !== 'string') return false;
    const want = await ackToken(messageId, secret);
    if (want.length !== token.length) return false;
    let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i);
    return diff === 0;
}

const PREVIEW = { quote: 'Sent you a message', milestone: 'Sent you a milestone', missing_you: 'Missing you', encouragement: 'Sent you encouragement' };

/** The notification body. Quote/milestone cards show their text; everything is cut to 110 characters. */
export function previewText(m) {
    const t = String(m.content || '').replace(/\s+/g, ' ').trim();
    const body = t || PREVIEW[m.message_type] || 'New message';
    return body.length > 110 ? body.slice(0, 107) + '…' : body;
}

/** The recipient's private nickname for the sender wins over the sender's real name. */
export const pushTitle = (nickname, senderName) => String(nickname || '').trim().slice(0, 30) || senderName || 'Infinity Hearts';

export async function buildMessagePush({ message, senderName, nickname, projectUrl, secret }) {
    return {
        title: pushTitle(nickname, senderName),
        body: previewText(message),
        kind: 'chat',
        tag: 'ih-chat',
        url: '/#/messages',
        ack: { id: message.id, token: await ackToken(message.id, secret), url: `${String(projectUrl).replace(/\/$/, '')}/functions/v1/ack-delivery` },
    };
}