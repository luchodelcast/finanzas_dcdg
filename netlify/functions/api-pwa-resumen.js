/**
 * GET|POST /api/pwa-resumen — Totales de gastos (desde la DB), autenticado con
 * el login de Google del usuario. Para el dashboard de la PWA.
 * Query/body: { periodo?, categoria?, quien? }
 */
import { pwaResumenHandler } from './_lib/handlers.js';

export default pwaResumenHandler;

export const config = { path: '/api/pwa-resumen' };
