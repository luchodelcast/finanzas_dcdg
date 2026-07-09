/**
 * GET /api/pwa-mi-patrimonio — Neto y evolución mensual de la persona
 * logueada (issue #115), solo lectura. Autenticado con el login de Google
 * del equipo financiero.
 */
import { pwaMiPatrimonioHandler } from './_lib/handlers.js';

export default pwaMiPatrimonioHandler;

export const config = { path: '/api/pwa-mi-patrimonio' };
