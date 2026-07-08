/**
 * GET|POST /api/pwa-backfill — backfill de líneas `solo_extracto` (issue #72,
 * Nocturno 1/7): materializa como movimientos/ingresos ya contabilizados las
 * líneas que el banco registró pero que nunca se capturaron.
 * GET  ?extracto_id=NN → propone la materialización (solo lectura).
 * POST { extracto_id, lineas } → crea + contabiliza + marca materializado.
 */
import { pwaBackfillHandler } from './_lib/handlers.js';

export default pwaBackfillHandler;

export const config = { path: '/api/pwa-backfill' };
