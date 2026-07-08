/**
 * GET|POST /api/pwa-solicitudes — "Solicitudes de mejoras" desde la PWA
 * (issue #78, Nocturno 7/7). GET es de lectura para todo el equipo; POST
 * (crear) es solo owners (Luis/Carolina).
 */
import { pwaSolicitudesHandler } from './_lib/handlers.js';

export default pwaSolicitudesHandler;

export const config = { path: '/api/pwa-solicitudes' };
