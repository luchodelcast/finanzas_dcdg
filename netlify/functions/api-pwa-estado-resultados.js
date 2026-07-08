/**
 * GET /api/pwa-estado-resultados — Estado de Resultados (T6), solo lectura.
 * Autenticado con el login de Google del equipo financiero.
 */
import { pwaEstadoResultadosHandler } from './_lib/handlers.js';

export default pwaEstadoResultadosHandler;

export const config = { path: '/api/pwa-estado-resultados' };
