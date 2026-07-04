/**
 * POST /api/registrar-pago — Registra el pago de una obligación (servicio, tarjeta, cuota).
 * Mismo body que registrar-gasto; se etiqueta como "pago" en la columna Notas.
 */
import { makeRegistrarHandler } from './_lib/handlers.js';

export default makeRegistrarHandler('pago');

export const config = { path: '/api/registrar-pago' };
