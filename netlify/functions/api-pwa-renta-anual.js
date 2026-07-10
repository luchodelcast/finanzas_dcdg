/**
 * GET /api/pwa-renta-anual — Hoja de trabajo de renta por cédulas + patrimonio
 * fiscal a 31-dic, por persona (issue #130, Fase 3.3), solo lectura.
 * Autenticado con el login de Google del equipo financiero.
 * Query: { anio?, entidad_id?, formato? }
 */
import { pwaRentaAnualHandler } from './_lib/handlers.js';

export default pwaRentaAnualHandler;

export const config = { path: '/api/pwa-renta-anual' };
