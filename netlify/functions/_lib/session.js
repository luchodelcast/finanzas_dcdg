/**
 * _lib/session.js — Token de sesión propio de la PWA (HMAC-SHA256), estilo CRM.
 *
 * La PWA hace Google Sign-In (identidad, sin scopes de API) y manda el ID token
 * a /api/pwa-login; el backend lo valida y emite ESTE token de sesión (12 h),
 * que el navegador guarda en localStorage y manda como Bearer en cada request.
 * Así se acaba la pantalla de autorización de Google recurrente: dentro de la
 * ventana de 12 h la app no vuelve a hablar con Google en cada recarga.
 *
 * Sin dependencias externas: usa node:crypto (Node 22). Firma con AUTH_SECRET.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (o) => b64url(JSON.stringify(o));

/**
 * Secreto de firma. Sin AUTH_SECRET no se pueden emitir tokens (login cae con
 * 503); la verificación devuelve null (no lanza) para que el carril de
 * compatibilidad con el access token de Google siga funcionando.
 */
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw Object.assign(new Error('Servidor sin AUTH_SECRET configurado'), { status: 503 });
  return s;
}

/** ¿Está configurado AUTH_SECRET? (para que /api/pwa-login avise con claridad). */
export function sessionSecretConfigured() {
  return !!process.env.AUTH_SECRET;
}

/**
 * Firma un token de sesión { ...payload, iat, exp }.
 * @param {object} payload  p.ej. { email }
 * @param {number} [ttlSec] vida en segundos (por defecto 12 h)
 * @param {number} [now]    epoch ms (inyectable en tests)
 */
export function signSession(payload, ttlSec = 60 * 60 * 12, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const body = { ...payload, iat, exp: iat + ttlSec };
  const head = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const data = `${head}.${b64urlJson(body)}`;
  const sig = b64url(createHmac('sha256', secret()).update(data).digest());
  return `${data}.${sig}`;
}

/**
 * Verifica firma + expiración. Devuelve el payload o null (nunca lanza).
 * @param {string} token
 * @param {number} [now] epoch ms (inyectable en tests)
 */
export function verifySession(token, now = Date.now()) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [head, body, sig] = parts;
    const expected = b64url(createHmac('sha256', secret()).update(`${head}.${body}`).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(
      Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    );
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Math.floor(now / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}
