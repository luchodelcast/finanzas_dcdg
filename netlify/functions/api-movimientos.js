/**
 * GET|POST /api/movimientos — Lista/busca movimientos desde la DB.
 * Query/body: { desde?, hasta?, categoria?, quien?, texto?, limit? }
 * Para consultas puntuales de SilvIA y el dashboard.
 */
import { movimientosHandler } from './_lib/handlers.js';

export default movimientosHandler;

export const config = { path: '/api/movimientos' };
