/**
 * services/auth.js — Autenticación de la PWA con Google Sign-In + token de sesión.
 *
 * Modelo (igual al del CRM/SilvIA): el navegador SOLO se identifica con Google
 * Sign-In (`google.accounts.id`, ID token) — NUNCA pide scopes de API. Ese ID
 * token se canjea en el backend (`/api/pwa-login`) por un token de sesión propio
 * (HMAC, 12 h) que se guarda en localStorage y se manda como Bearer en cada
 * request. Así se acaba la pantalla de autorización de Google recurrente: dentro
 * de la ventana de 12 h la app no vuelve a hablar con Google en cada recarga.
 *
 * Todas las escrituras/lecturas de Google Sheets ocurren ahora en el backend
 * (cuenta de servicio), por eso aquí ya no se pide el scope `spreadsheets`.
 *
 * Requiere la librería GIS en index.html:
 *   <script src="https://accounts.google.com/gsi/client" async></script>
 */

import { getConfig } from '../config/env.js';

const KEY = 'dcdg_session'; // { token, exp (ms), email, rol }

function readSession() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; }
}
function writeSession(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) { /* noop */ }
}
function clearSession() {
  try { localStorage.removeItem(KEY); } catch (_) { /* noop */ }
}

/** ¿Hay una sesión válida (con margen de 60 s antes de expirar)? */
export function isSignedIn() {
  const s = readSession();
  return !!(s && s.token && s.exp && Date.now() < s.exp - 60_000);
}

/** Usuario actual { email, rol } o null. */
export function currentUser() {
  const s = readSession();
  return s && s.token ? { email: s.email, rol: s.rol } : null;
}

/**
 * Devuelve el token de sesión vigente para usarlo como Bearer.
 * @returns {Promise<string>}
 * @throws Error con .status 401 si no hay sesión (el caller muestra el login).
 */
export function getSessionToken() {
  const s = readSession();
  if (s && s.token && s.exp && Date.now() < s.exp - 60_000) return Promise.resolve(s.token);
  return Promise.reject(Object.assign(new Error('Inicia sesión con Google (Luis o Carolina).'), { status: 401 }));
}

function gis() {
  // eslint-disable-next-line no-undef
  const g = typeof google !== 'undefined' ? google : null;
  if (!g?.accounts?.id) throw new Error('Google Identity Services no está cargado.');
  return g;
}

/** Resuelve cuando la librería GIS terminó de cargar (script async). */
export function gisReady() {
  return new Promise((resolve) => {
    // eslint-disable-next-line no-undef
    const ready = () => typeof google !== 'undefined' && google.accounts && google.accounts.id;
    if (ready()) return resolve();
    const t = setInterval(() => { if (ready()) { clearInterval(t); resolve(); } }, 100);
    setTimeout(() => { clearInterval(t); resolve(); }, 8000);
  });
}

let _inited = false;
let _onChange = null;

/** Canjea el ID token de Google por nuestro token de sesión (POST /api/pwa-login). */
async function exchange(credential) {
  const cfg = getConfig();
  const base = (cfg.apiBaseUrl || '').replace(/\/$/, '');
  const res = await fetch(`${base}/api/pwa-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id_token: credential }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `Login falló (${res.status})`), { status: res.status });
  }
  writeSession({
    token: data.token,
    email: data.email,
    rol: data.rol,
    exp: Date.now() + (Number(data.ttl) || 60 * 60 * 12) * 1000,
  });
  return currentUser();
}

/**
 * Inicializa Google Sign-In (idempotente). `onChange(user|null, err?)` se dispara
 * cuando cambia la sesión (login exitoso, fallo, o signOut).
 */
export function initSignIn({ onChange } = {}) {
  if (onChange) _onChange = onChange;
  if (_inited) return;
  const cfg = getConfig();
  if (!cfg.googleClientId) throw new Error('Falta GOOGLE_CLIENT_ID.');
  gis().accounts.id.initialize({
    client_id: cfg.googleClientId,
    auto_select: true,
    callback: async ({ credential }) => {
      try { const u = await exchange(credential); if (_onChange) _onChange(u); }
      catch (e) { if (_onChange) _onChange(null, e); }
    },
  });
  _inited = true;
}

/** Dibuja el botón oficial de Google Sign-In en el contenedor dado. */
export function renderSignInButton(el) {
  if (!el) return;
  initSignIn();
  gis().accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
}

/** Intenta One Tap (silencioso si el usuario ya inició antes y hay sesión de Google). */
export function promptOneTap() {
  try { initSignIn(); gis().accounts.id.prompt(); } catch (_) { /* noop */ }
}

/** Cierra la sesión local y desactiva el auto-select. */
export function signOut() {
  clearSession();
  try { gis().accounts.id.disableAutoSelect(); } catch (_) { /* noop */ }
  if (_onChange) _onChange(null);
}
