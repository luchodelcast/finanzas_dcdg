/**
 * GET /api/pwa-whoami — email y rol del usuario autenticado (Google login),
 * para que la PWA decida qué mostrar según el rol (T8, issue #97).
 */
import { pwaWhoamiHandler } from './_lib/handlers.js';

export default pwaWhoamiHandler;

export const config = { path: '/api/pwa-whoami' };
