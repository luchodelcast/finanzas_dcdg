/**
 * GET/POST /api/pwa-presupuesto — Presupuesto mensual por categoría (issue
 * #135, `auto-ok`): PTTO fijado por categoría/mes vs. ejecutado real, con
 * variación. Auth Google.
 */
import { pwaPresupuestoHandler } from './_lib/handlers.js';

export default pwaPresupuestoHandler;

export const config = { path: '/api/pwa-presupuesto' };
