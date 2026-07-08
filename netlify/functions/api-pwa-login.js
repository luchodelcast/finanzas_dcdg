/**
 * POST /api/pwa-login — Canjea un Google ID token (Sign-In) por el token de
 * sesión propio de la PWA (HMAC, 12 h). Ver _lib/session.js.
 */
import { pwaLoginHandler } from './_lib/handlers.js';

export default pwaLoginHandler;

export const config = { path: '/api/pwa-login' };
