/**
 * GET|POST /api/pwa-apertura — Saldos iniciales / asiento de apertura (T3).
 *   GET  → apertura existente para una entidad (o null).
 *   POST → arma y guarda el asiento de apertura cuadrado (solo owners).
 * Autenticado con el login de Google del equipo financiero.
 */
import { pwaAperturaHandler } from './_lib/handlers.js';

export default pwaAperturaHandler;

export const config = { path: '/api/pwa-apertura' };
