/**
 * POST /api/pwa-recontabilizar — backfill de contabilización automática (T4):
 * genera el asiento de los movimientos/ingresos ya capturados que aún no lo
 * tienen. Solo owners (Luis/Carolina). Auth Google.
 */
import { pwaRecontabilizarHandler } from './_lib/handlers.js';

export default pwaRecontabilizarHandler;

export const config = { path: '/api/pwa-recontabilizar' };
