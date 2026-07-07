/**
 * POST /api/registrar-transferencia — Registra una transferencia entre cuentas propias.
 * Body: { monto, cuenta_origen, cuenta_destino, moneda?, fecha?, descripcion?, quien_pago?, notas? }
 * No es un gasto: se excluye de los totales del resumen. Soporta COP y USD.
 * Auth: Bearer DCDG_API_TOKEN + header X-DCDG-User (correo autorizado).
 */
import { makeRegistrarHandler } from './_lib/handlers.js';

export default makeRegistrarHandler('transferencia');

export const config = { path: '/api/registrar-transferencia' };
