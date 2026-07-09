/**
 * GET /api/pwa-patrimonio — Patrimonio por persona (T7 filtrado por dueño,
 * issue #115), solo lectura. Autenticado con el login de Google del equipo
 * financiero.
 */
import { pwaPatrimonioHandler } from './_lib/handlers.js';

export default pwaPatrimonioHandler;

export const config = { path: '/api/pwa-patrimonio' };
