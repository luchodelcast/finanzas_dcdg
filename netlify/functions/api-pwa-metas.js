/**
 * GET/POST /api/pwa-metas — Metas financieras (issue #117, Contab. familiar E,
 * `auto-ok`): metas/objetivos con barra de progreso (saldo actual de sus
 * cuenta(s) vinculadas vs. monto objetivo) + pensión/ahorro voluntario de
 * Carolina. Auth Google.
 */
import { pwaMetasHandler } from './_lib/handlers.js';

export default pwaMetasHandler;

export const config = { path: '/api/pwa-metas' };
