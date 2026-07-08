// _lib/google-auth.js — Verifica la identidad del usuario de la PWA y lo autoriza.
//
// Dos carriles de credencial que la PWA puede mandar como Bearer:
//   1) Token de sesión propio (HMAC, 12 h) emitido por /api/pwa-login tras un
//      Google Sign-In (ID token). Es el camino nuevo: el navegador no pide
//      scopes de API ni vuelve a ver la pantalla de autorización en cada carga.
//   2) Access token de Google (flujo viejo, scope openid/email[/spreadsheets]).
//      Se sigue aceptando por compatibilidad durante la transición.
// En ambos casos exigimos que el email esté en FINANZAS_USERS y resolvemos su rol.
import { config } from './env.js';
import { getUsuarioRolPorEmail } from './repo.js';
import { verifySession } from './session.js';

const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';

/**
 * Rol de un email cuando no tiene fila en `usuarios` (o la tabla no responde):
 * preserva el criterio de "quién escribe" que ya regía por `FINANZAS_OWNERS`
 * antes de que existieran roles, para que nadie pierda ni gane acceso el día
 * que se active esta tabla.
 */
function rolLegacy(email) {
  return config.finanzasOwners().includes(email) ? 'owner' : 'solo_lectura';
}

/** Rol efectivo: la tabla `usuarios` manda; si no hay fila, el criterio legacy. */
async function resolverRol(email) {
  return (await getUsuarioRolPorEmail(email)) || rolLegacy(email);
}

/**
 * Valida los datos comunes de un token de Google (ya parseado por tokeninfo):
 * que fue emitido para NUESTRO client_id, que trae email y que el email está
 * autorizado. Devuelve el email normalizado.
 */
function gateGoogleInfo(info) {
  const aud = info.aud || info.azp;
  const clientId = config.googleClientId();
  if (clientId && aud && aud !== clientId) {
    throw Object.assign(new Error('Token emitido para otra aplicación'), { status: 401 });
  }
  const email = String(info.email || '').toLowerCase().trim();
  if (!email) {
    throw Object.assign(
      new Error('El token no incluye email (falta el scope "email" en la PWA)'),
      { status: 403 }
    );
  }
  if (!config.finanzasUsers().includes(email)) {
    throw Object.assign(new Error('Usuario no autorizado para finanzas'), { status: 403 });
  }
  return email;
}

/** Consulta tokeninfo con el parámetro dado (access_token | id_token). */
async function tokeninfo(param, value) {
  const res = await fetch(`${TOKENINFO}?${param}=${encodeURIComponent(value)}`);
  if (!res.ok) throw new Error('tokeninfo ' + res.status);
  return res.json();
}

/**
 * Verifica el ACCESS token de Google (flujo viejo) y autoriza al usuario.
 * @param {string} accessToken
 * @returns {Promise<{ email: string, rol: string }>}
 * @throws Error con .status (401/403) si no es válido/autorizado.
 */
export async function verifyFinanceUser(accessToken) {
  const token = String(accessToken || '').trim();
  if (!token) throw Object.assign(new Error('Falta el token de Google'), { status: 401 });
  let info;
  try {
    info = await tokeninfo('access_token', token);
  } catch (_) {
    throw Object.assign(new Error('Token de Google inválido o expirado'), { status: 401 });
  }
  const email = gateGoogleInfo(info);
  return { email, rol: await resolverRol(email) };
}

/**
 * Verifica un ID token de Google Sign-In (para /api/pwa-login) y autoriza.
 * @param {string} idToken
 * @returns {Promise<{ email: string, rol: string }>}
 * @throws Error con .status (401/403) si no es válido/autorizado.
 */
export async function verifyGoogleIdToken(idToken) {
  const token = String(idToken || '').trim();
  if (!token) throw Object.assign(new Error('Falta el ID token de Google'), { status: 401 });
  let info;
  try {
    info = await tokeninfo('id_token', token);
  } catch (_) {
    throw Object.assign(new Error('ID token de Google inválido o expirado'), { status: 401 });
  }
  if (info.email_verified != null && String(info.email_verified) !== 'true') {
    throw Object.assign(new Error('El email de Google no está verificado'), { status: 403 });
  }
  const email = gateGoogleInfo(info);
  return { email, rol: await resolverRol(email) };
}

/**
 * Resuelve el usuario de una petición de la PWA a partir del Bearer, aceptando
 * el token de sesión propio (preferente) o, por compatibilidad, el access token
 * de Google. Reemplaza el uso directo de verifyFinanceUser en los handlers pwa-*.
 * @param {string} bearer  header Authorization o el token ya extraído.
 * @returns {Promise<{ email: string, rol: string }>}
 */
export async function resolvePwaUser(bearer) {
  const token = String(bearer || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw Object.assign(new Error('Falta el token'), { status: 401 });
  const sess = verifySession(token);
  if (sess && sess.email) {
    const email = String(sess.email).toLowerCase().trim();
    if (!config.finanzasUsers().includes(email)) {
      throw Object.assign(new Error('Usuario no autorizado para finanzas'), { status: 403 });
    }
    return { email, rol: await resolverRol(email) };
  }
  return verifyFinanceUser(token);
}
