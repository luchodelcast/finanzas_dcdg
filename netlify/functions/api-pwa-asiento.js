/**
 * GET|POST /api/pwa-asiento — Libro diario (asientos de partida doble),
 * autenticado con el login de Google. GET lista/consulta (equipo financiero);
 * POST crea un asiento manual (solo dueños, ver FINANZAS_OWNERS).
 */
import { pwaAsientoHandler } from './_lib/handlers.js';

export default pwaAsientoHandler;

export const config = { path: '/api/pwa-asiento' };
