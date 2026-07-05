/**
 * GET|POST /api/pwa-movimientos — Lista/busca movimientos (desde la DB),
 * autenticado con el login de Google del usuario. Para el dashboard de la PWA.
 * Query/body: { desde?, hasta?, categoria?, quien?, texto?, limit? }
 */
import { pwaMovimientosHandler } from './_lib/handlers.js';

export default pwaMovimientosHandler;

export const config = { path: '/api/pwa-movimientos' };
