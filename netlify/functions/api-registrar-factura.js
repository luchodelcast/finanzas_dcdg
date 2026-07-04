/**
 * POST /api/registrar-factura — Registra una factura recibida / cuenta por pagar.
 * Mismo body que registrar-gasto; se etiqueta como "factura" en la columna Notas.
 */
import { makeRegistrarHandler } from './_lib/handlers.js';

export default makeRegistrarHandler('factura');

export const config = { path: '/api/registrar-factura' };
