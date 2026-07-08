/**
 * GET /api/pwa-comprobacion — Balance de Comprobación (T5), solo lectura.
 * Autenticado con el login de Google del equipo financiero.
 */
import { pwaComprobacionHandler } from './_lib/handlers.js';

export default pwaComprobacionHandler;

export const config = { path: '/api/pwa-comprobacion' };
