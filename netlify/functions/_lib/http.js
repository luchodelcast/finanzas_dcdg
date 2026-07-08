/**
 * _lib/http.js — Helpers de request/response y auth para las Functions.
 *
 * Modelo de seguridad (sección 9 del doc de integración):
 *   - Todas las rutas /api/* exigen `Authorization: Bearer <DCDG_API_TOKEN>`.
 *   - SilvIA envía además el `username` (correo) del usuario de WhatsApp; solo
 *     los correos en FINANZAS_USERS pueden operar el carril de finanzas.
 */

import { config } from './env.js';

const JSON_HEADERS = { 'content-type': 'application/json' };

export function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function ok(body) {
  return json(200, body);
}

export function bad(msg, status = 400) {
  return json(status, { ok: false, error: msg });
}

/** Respuesta de descarga CSV (issue #91). `filename` va en el header content-disposition. */
export function csv(filename, texto) {
  return new Response(texto, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}

/** Comparación de tokens en tiempo constante (evita timing attacks). */
function safeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifica el token de servicio y el rol del usuario.
 * @param {Request} req
 * @param {{ requireFinanceUser?: boolean }} [opts]
 * @returns {{ ok: true, username: string } | { ok: false, response: Response }}
 */
export function authorize(req, { requireFinanceUser = true } = {}) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  let expected;
  try {
    expected = config.apiToken();
  } catch (e) {
    return { ok: false, response: bad('Servidor sin DCDG_API_TOKEN configurado', 500) };
  }
  if (!token || !safeEqual(token, expected)) {
    return { ok: false, response: bad('No autorizado (token inválido)', 401) };
  }

  // Usuario: header explícito o campo en el body ya parseado por el caller.
  const username = String(req.headers.get('x-dcdg-user') || '').toLowerCase().trim();
  if (requireFinanceUser) {
    const allowed = config.finanzasUsers();
    if (!username || !allowed.includes(username)) {
      return { ok: false, response: bad('Usuario no autorizado para finanzas', 403) };
    }
  }
  return { ok: true, username };
}

/** Parsea el body JSON de forma tolerante. */
export async function parseBody(req) {
  try {
    const text = await req.text();
    return text ? JSON.parse(text) : {};
  } catch (_) {
    return {};
  }
}
