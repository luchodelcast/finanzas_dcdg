/**
 * GET|POST /api/pwa-pagos — Pagos del mes: qué se ha pagado y qué falta (T2
 * nocturno, issue #73). GET es de lectura para todo el equipo; POST (marcar/
 * desmarcar/crear/editar) es solo owners (Luis/Carolina).
 */
import { pwaPagosHandler } from './_lib/handlers.js';

export default pwaPagosHandler;

export const config = { path: '/api/pwa-pagos' };
