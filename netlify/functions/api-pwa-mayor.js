/**
 * GET /api/pwa-mayor — Libro Mayor de una cuenta (T5), solo lectura.
 * Autenticado con el login de Google del equipo financiero.
 */
import { pwaMayorHandler } from './_lib/handlers.js';

export default pwaMayorHandler;

export const config = { path: '/api/pwa-mayor' };
