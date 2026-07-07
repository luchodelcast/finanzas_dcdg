/**
 * POST /api/pwa-recontabilizar — Genera los asientos faltantes de los
 * movimientos/ingresos capturados antes de la contabilización automática (T4).
 * Procesa un lote acotado por llamada y reporta cuántos quedan. Solo owners.
 */
import { pwaRecontabilizarHandler } from './_lib/handlers.js';

export default pwaRecontabilizarHandler;

export const config = { path: '/api/pwa-recontabilizar' };
