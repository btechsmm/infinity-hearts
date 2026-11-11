import { toast } from './util.js';

function wrapLines(ctx, text, maxW) {
  const words = text.split(/\s+/); const lines = []; let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** Renders a LIBRARY quote as a shareable PNG. Private messages are never rendered by this function. */
export async function quoteImage(text, by = 'Infinity Hearts') {
  const W = 1080, H = 1350, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0a0b'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * 0.85, H, 50, W * 0.85, H, 900);
  g.addColorStop(0, 'rgba(224,17,43,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(224,17,43,0.35)'; ctx.lineWidth = 3; ctx.strokeRect(40, 40, W - 80, H - 80);
  ctx.fillStyle = '#e0112b'; ctx.font = '200px Georgia, serif'; ctx.fillText('“', 90, 330);
  ctx.fillStyle = '#f6f2f2'; ctx.font = '60px Georgia, serif';
  const lines = wrapLines(ctx, text, W - 220);
  const lh = 86; let y = Math.max(400, (H - lines.length * lh) / 2 + 40);
  for (const l of lines) { ctx.fillText(l, 110, y); y += lh; }
  ctx.fillStyle = '#e8a0ae'; ctx.font = 'italic 44px Georgia, serif'; ctx.fillText(`— ${by}`, 110, y + 40);
  ctx.fillStyle = '#a99ea1'; ctx.font = '600 28px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('INFINITY HEARTS', W / 2, H - 120);
  ctx.font = '500 24px system-ui, sans-serif'; ctx.fillText('BECAM & FAITH', W / 2, H - 80);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied', 'ok'); }
  catch { toast('Could not copy. Select the text and copy it manually.', 'error'); }
}

export async function shareText(text) {
  if (navigator.share) { try { await navigator.share({ text: `${text}\n\n— Infinity Hearts` }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  await copyText(text);
}

export async function shareQuoteImage(text, by) {
  const blob = await quoteImage(text, by);
  const file = new File([blob], 'infinity-hearts-quote.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text: 'Infinity Hearts' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'infinity-hearts-quote.png'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Image saved to your downloads', 'ok');
}
