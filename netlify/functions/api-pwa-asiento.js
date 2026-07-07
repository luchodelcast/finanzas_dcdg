/**
 * GET|POST /api/pwa-asiento — Libro diario de partida doble (T2).
 *   GET  → lista asientos (lectura, equipo financiero).
 *   POST → crea un asiento manual cuadrado (solo owners: Luis/Carolina).
 * Autenticado con el login de Google del equipo financiero.
 */
import { pwaAsientoHandler } from './_lib/handlers.js';

export default pwaAsientoHandler;

export const config = { path: '/api/pwa-asiento' };
