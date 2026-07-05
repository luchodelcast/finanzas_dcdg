// _lib/google-auth.js — Verifica el token de Google de la PWA y autoriza al usuario.
//
// La PWA obtiene un access token de Google (scope openid/email/spreadsheets) con
// GIS y lo manda como Bearer. Aquí lo validamos contra el endpoint tokeninfo de
// Google: comprobamos que fue emitido para NUESTRO client_id, que trae un email, y
// que ese email esté en FINANZAS_USERS. Así el navegador nunca necesita la API key
// de Anthropic: clasifica llamando al backend, autenticado con su login de Google.
import { config } from './env.js';

const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';

/**
 * Verifica el access token de Google y que el usuario esté autorizado.
 * @param {string} accessToken
 * @returns {Promise<{ email: string }>}
 * @throws Error con .status (401/403) si no es válido/autorizado.
 */
export async function verifyFinanceUser(accessToken) {
  const token = String(accessToken || '').trim();
  if (!token) throw Object.assign(new Error('Falta el token de Google'), { status: 401 });

  let info;
  try {
    const res = await fetch(`${TOKENINFO}?access_token=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error('tokeninfo ' + res.status);
    info = await res.json();
  } catch (_) {
    throw Object.assign(new Error('Token de Google inválido o expirado'), { status: 401 });
  }

  // El token debe haber sido emitido para nuestra app (evita tokens de otras apps).
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
  return { email };
}
