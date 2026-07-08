/**
 * GET|POST /api/pwa-prestamos — Préstamos entre Luis y Carolina, saldo neto
 * (issue #77, Nocturno 6/7). GET es de lectura para todo el equipo; POST
 * (crear/marcar_saldado) es solo owners (Luis/Carolina).
 */
import { pwaPrestamosHandler } from './_lib/handlers.js';

export default pwaPrestamosHandler;

export const config = { path: '/api/pwa-prestamos' };
