/**
 * GET|POST /api/resumen — Totales de gastos (desde la DB).
 * Query/body: { periodo?, categoria?, quien? }
 * periodo: 'mes' (def) | 'semana' | 'YYYY-MM' | 'YYYY-MM-DD..YYYY-MM-DD'
 */
import { resumenHandler } from './_lib/handlers.js';

export default resumenHandler;

export const config = { path: '/api/resumen' };
