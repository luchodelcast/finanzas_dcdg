/**
 * GET /api/pwa-balance-general — Balance General (T7), solo lectura.
 * Autenticado con el login de Google del equipo financiero.
 */
import { pwaBalanceGeneralHandler } from './_lib/handlers.js';

export default pwaBalanceGeneralHandler;

export const config = { path: '/api/pwa-balance-general' };
