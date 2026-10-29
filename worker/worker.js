import { createChallenge } from '../docs/words.js';

// Cloudflare Worker: signed, immutable share pages without a database.
// The signing secret must be added with `npx wrangler secret put SIGNING_SECRET`.
const MIN_TEST_DURATION_MS = 60_000;
const MAX_SUBMISSION_DELAY_MS = 10 * 60_000;
const WORD_COUNT = 300;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function toBase64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(encodedPayload, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPayload)));
}

async function createToken(payload, secret) {
  const encodedPayload = toBase64url(encoder.encode(JSON.stringify(payload)));
  return `${encodedPayload}.${toBase64url(await hmac(encodedPayload, secret))}`;
}

async function readToken(value, secret) {
  if (typeof value !== 'string' || value.length > 8_000) return null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return null;
  try {
    const supplied = fromBase64url(match[2]);
    const expected = await hmac(match[1], secret);
    if (supplied.length !== expected.length) return null;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i += 1) mismatch |= supplied[i] ^ expected[i];
    if (mismatch !== 0) return null;
    return JSON.parse(decoder.decode(fromBase64url(match[1])));
  } catch {
    return null;
  }
}

function json(value, status = 200, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(value), { status, headers });
}

function configuredOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim())
    .filter(Boolean).map((item) => {
      try { return new URL(item).origin; } catch { return ''; }
    }).filter(Boolean));
}

function getPermittedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  return configuredOrigins(env).has(origin) ? origin : '';
}

async function requestJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 16_000) throw new Error('Die Anfrage ist zu groß.');
  const raw = await request.text();
  if (raw.length > 16_000) throw new Error('Die Anfrage ist zu groß.');
  try { return JSON.parse(raw); }
  catch { throw new Error('Ungültige JSON-Anfrage.'); }
}

function calculateResult(target, typed) {
  let correct = 0;
  for (let index = 0; index < typed.length; index += 1) {
    if (typed[index] === target[index]) correct += 1;
  }
  return {
    wpm: Math.round(correct * 2) / 10,
    accuracy: typed.length ? Math.round(correct / typed.length * 1000) / 10 : 0,
    correct,
    errors: typed.length - correct
  };
}

function escaped(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function resultHtml(receipt, siteUrl) {
  const date = new Date(receipt.finishedAt).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  let safeSite = '';
  try {
    const parsed = new URL(siteUrl);
    if (parsed.protocol === 'https:') safeSite = parsed.href;
  } catch { /* An omitted site link is better than a malformed URL. */ }
  const items = [
    ['Wörter pro Minute', receipt.wpm.toLocaleString('de-DE'), 'WPM'],
    ['Genauigkeit', receipt.accuracy.toLocaleString('de-DE'), '%'],
    ['Richtige Zeichen', receipt.correct.toLocaleString('de-DE'), ''],
    ['Fehler', receipt.errors.toLocaleString('de-DE'), '']
  ];
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/><meta name="referrer" content="no-referrer"/>
<title>Signiertes Tippklar-Ergebnis</title>
<style>
:root{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#24312b;background:#f7f8f7}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:min(100%,620px);background:#fff;border:1px solid #dee5df;border-radius:10px;padding:34px}
.brand{font-size:18px;font-weight:720;letter-spacing:-.04em}.brand span{color:#356f55}
.badge{display:inline-flex;margin:30px 0 3px;color:#356f55;font-size:12px;font-weight:650}
h1{font-size:27px;letter-spacing:-.04em;line-height:1.2;margin:14px 0 9px;font-weight:660}
.intro{color:#69766f;font-size:13px;line-height:1.6}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:25px 0}
.tile{background:#f7f9f7;padding:18px;border:1px solid #dee5df;border-radius:6px}
.label{color:#69766f;font-size:11px;font-weight:690}
.value{display:block;font-size:40px;font-weight:650;letter-spacing:-.06em;color:#24312b;margin-top:8px}
.unit{font-size:17px;letter-spacing:0;color:#69766f}
.details{border-top:1px solid #dee5df;padding-top:18px;font-size:12px;color:#69766f;line-height:1.9}
.details strong{color:#24312b}.note{font-size:11px;color:#69766f;line-height:1.75;margin-top:18px}
.back{display:inline-flex;margin-top:18px;color:#356f55;font-size:13px;font-weight:650;text-decoration:none}
@media(max-width:520px){main{padding:23px}.grid{gap:8px}.tile{padding:12px}.value{font-size:34px}}
</style></head><body><main>
<div class="brand">tippklar<span>.</span></div>
<div class="badge">✓ Serversignatur gültig</div>
<h1>Ergebnis: 60 Sekunden.</h1>
<p class="intro">Dieser Ergebnisdatensatz wurde vom Tippklar-Prüfdienst erstellt. Die angezeigten Werte sind durch eine digitale Signatur gegen nachträgliche Änderungen geschützt.</p>
<div class="grid">${items.map(([label, value, unit]) => `<div class="tile"><span class="label">${label}</span><strong class="value">${value}${unit ? ` <span class="unit">${unit}</span>` : ''}</strong></div>`).join('')}</div>
<div class="details"><div><strong>Dauer:</strong> 60 Sekunden</div><div><strong>Ausgestellt am:</strong> ${escaped(date)} (Berlin)</div><div><strong>Ergebnis-ID:</strong> ${escaped(receipt.id.slice(0, 12))}</div></div>
<p class="note">Die Signatur schützt die geteilten Zahlen vor Manipulation. Sie ist kein Beweis dafür, dass eine Person ohne technische Hilfsmittel getippt hat. Es werden keine persönlichen Bestwerte oder Nutzerkonten gespeichert.</p>
${safeSite ? `<a class="back" href="${escaped(safeSite)}" rel="noreferrer">Selbst den Test machen ↗</a>` : ''}
</main></body></html>`;
}

function resultResponse(html) {
  return new Response(html, { status: 200, headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'tippklar-signatures' });
    }

    if (request.method === 'GET' && url.pathname.startsWith('/r/')) {
      if (!env.SIGNING_SECRET) return new Response('Service not configured.', { status: 503 });
      const receipt = await readToken(url.pathname.slice(3), env.SIGNING_SECRET);
      if (!receipt || receipt.type !== 'result' || receipt.v !== 1 ||
          !Number.isSafeInteger(receipt.finishedAt) ||
          !Number.isFinite(receipt.wpm) || !Number.isFinite(receipt.accuracy) ||
          !Number.isSafeInteger(receipt.correct) || !Number.isSafeInteger(receipt.errors) ||
          typeof receipt.id !== 'string' || receipt.id.length > 100) {
        return new Response('Ungültiger oder veränderter Ergebnislink.', { status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      return resultResponse(resultHtml(receipt, env.SITE_URL || ''));
    }

    const isStart = url.pathname === '/api/start';
    const isFinish = url.pathname === '/api/finish';
    if (!isStart && !isFinish) return json({ error: 'Nicht gefunden.' }, 404);
    const origin = getPermittedOrigin(request, env);
    if (!origin) return json({ error: 'Dieser Website-Ursprung ist nicht freigegeben.' }, 403);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400', 'Vary': 'Origin'
      } });
    }
    if (request.method !== 'POST') return json({ error: 'Methode nicht erlaubt.' }, 405, origin);
    if (typeof env.SIGNING_SECRET !== 'string' || env.SIGNING_SECRET.length < 32) {
      return json({ error: 'Der Signaturschlüssel fehlt oder ist zu kurz.' }, 503, origin);
    }

    let data;
    try { data = await requestJson(request); }
    catch (error) { return json({ error: error.message }, 400, origin); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return json({ error: 'Ungültige Anfrage.' }, 400, origin);
    }

    if (isStart) {
      const issuedAt = Date.now();
      const challenge = createChallenge(WORD_COUNT);
      const token = await createToken({
        v: 1, type: 'run', id: crypto.randomUUID(), issuedAt, challenge
      }, env.SIGNING_SECRET);
      return json({ challenge, token, durationSeconds: 60 }, 200, origin);
    }

    const session = await readToken(data.token, env.SIGNING_SECRET);
    if (!session || session.type !== 'run' || session.v !== 1 ||
        !Number.isSafeInteger(session.issuedAt) ||
        typeof session.challenge !== 'string' || session.challenge.length > 5_000 ||
        typeof session.id !== 'string' || session.id.length > 100) {
      return json({ error: 'Ungültige Testsitzung.' }, 400, origin);
    }

    const elapsed = Date.now() - session.issuedAt;
    if (elapsed < MIN_TEST_DURATION_MS) {
      return json({ error: 'Der 60-Sekunden-Test ist noch nicht beendet.' }, 400, origin);
    }
    if (elapsed > MAX_SUBMISSION_DELAY_MS) {
      return json({ error: 'Die Sitzung ist abgelaufen. Bitte starte einen neuen Test.' }, 400, origin);
    }
    if (typeof data.typed !== 'string' || data.typed.length > session.challenge.length ||
        /[\r\n\t]/.test(data.typed)) {
      return json({ error: 'Ungültiger Eingabetext.' }, 400, origin);
    }

    const result = calculateResult(session.challenge, data.typed);
    const receipt = {
      v: 1, type: 'result', id: session.id, finishedAt: Date.now(),
      durationSeconds: 60, ...result
    };
    const resultToken = await createToken(receipt, env.SIGNING_SECRET);
    const resultUrl = `${url.origin}/r/${resultToken}`;
    return json({ result, url: resultUrl }, 200, origin);
  }
};
