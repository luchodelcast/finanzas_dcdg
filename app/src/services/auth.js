/**
 * services/auth.js — Google OAuth vía Google Identity Services (GIS) para la PWA.
 *
 * Migra la autenticación del monolito. Usa el token client de GIS con el scope
 * de spreadsheets. El token se cachea en memoria hasta su expiración.
 *
 * Requiere que la librería GIS esté cargada en index.html:
 *   <script src="https://accounts.google.com/gsi/client" async defer></script>
 */

import { getConfig } from '../config/env.js';

// openid+email → el backend puede identificar al usuario (clasificación server-side
// sin exponer la API key). spreadsheets → escribir en el Sheet desde la PWA.
const SCOPE = 'openid email https://www.googleapis.com/auth/spreadsheets';

// Marca en localStorage de que el usuario YA autorizó una vez en este dispositivo.
// Con eso, en aperturas siguientes pedimos el token en SILENCIO (sin la pantalla
// de consentimiento), y solo se muestra la primera vez o si se fuerza.
const GRANTED_KEY = 'dcdg_oauth_granted';
const yaAutorizo = () => { try { return localStorage.getItem(GRANTED_KEY) === '1'; } catch (_) { return false; } };

let _token = null;
let _expiresAt = 0;
let _tokenClient = null;

function gis() {
  // eslint-disable-next-line no-undef
  const g = typeof google !== 'undefined' ? google : null;
  if (!g?.accounts?.oauth2) {
    throw new Error('Google Identity Services no está cargado.');
  }
  return g;
}

function ensureTokenClient() {
  if (_tokenClient) return _tokenClient;
  const cfg = getConfig();
  if (!cfg.googleClientId) throw new Error('Falta GOOGLE_CLIENT_ID.');
  _tokenClient = gis().accounts.oauth2.initTokenClient({
    client_id: cfg.googleClientId,
    scope: SCOPE,
    callback: () => {}, // se sobreescribe por request en getAccessToken
  });
  return _tokenClient;
}

/**
 * Devuelve un access token válido, solicitando consentimiento si hace falta.
 * @param {{ forcePrompt?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export function getAccessToken({ forcePrompt = false } = {}) {
  const now = Date.now();
  if (_token && now < _expiresAt - 60_000 && !forcePrompt) {
    return Promise.resolve(_token);
  }
  return new Promise((resolve, reject) => {
    try {
      const client = ensureTokenClient();
      client.callback = (resp) => {
        if (resp.error) {
          reject(new Error('OAuth: ' + resp.error));
          return;
        }
        _token = resp.access_token;
        _expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        try { localStorage.setItem(GRANTED_KEY, '1'); } catch (_) { /* noop */ }
        resolve(_token);
      };
      // Si ya autorizó antes en este dispositivo, renueva el token en SILENCIO
      // (prompt vacío = sin popup, mientras la sesión de Google siga activa).
      // La pantalla de consentimiento solo aparece la primera vez o si se fuerza.
      const prompt = (forcePrompt || !yaAutorizo()) ? 'consent' : '';
      client.requestAccessToken({ prompt });
    } catch (e) {
      reject(e);
    }
  });
}

/** Revoca el token actual (logout). */
export function signOut() {
  if (_token) {
    try {
      gis().accounts.oauth2.revoke(_token, () => {});
    } catch (_) {
      /* noop */
    }
  }
  _token = null;
  _expiresAt = 0;
  try { localStorage.removeItem(GRANTED_KEY); } catch (_) { /* noop */ }
}

/** ¿Hay una sesión activa? */
export function isSignedIn() {
  return !!_token && Date.now() < _expiresAt;
}
