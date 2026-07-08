/**
 * GET /api/pwa-exportar — Exports contables en CSV (T12a), solo lectura.
 * Autenticado con el login de Google del equipo financiero.
 */
import { pwaExportarHandler } from './_lib/handlers.js';

export default pwaExportarHandler;

export const config = { path: '/api/pwa-exportar' };
