/**
 * GET|POST /api/pwa-aportes — Reporte mensual de aportes IBC por persona
 * (Fase 3.2 del roadmap contable), solo lectura. Autenticado con el login de
 * Google del usuario (equipo financiero). No registra pagos ni concilia.
 * Query/body: { periodo? }  'mes' (def) | 'YYYY-MM' | 'YYYY-MM-DD..YYYY-MM-DD'
 */
import { pwaAportesHandler } from './_lib/handlers.js';

export default pwaAportesHandler;

export const config = { path: '/api/pwa-aportes' };
