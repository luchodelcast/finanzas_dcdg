/**
 * POST /api/pwa-movimiento — Corregir un movimiento ya registrado (anular /
 * recategorizar), con reverso contable. Solo owners. Ver _lib/corregir.js.
 */
import { pwaCorregirMovimientoHandler } from './_lib/handlers.js';

export default pwaCorregirMovimientoHandler;

export const config = { path: '/api/pwa-movimiento' };
