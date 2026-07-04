/**
 * POST /api/registrar-gasto — Registra un gasto familiar DCDG.
 * Body: { monto, descripcion, quien_pago?, metodo_pago?, fecha?, categoria?, subcategoria?, tarjeta_ultimos4?, notas? }
 * Auth: Bearer DCDG_API_TOKEN + header X-DCDG-User (correo autorizado).
 */
import { makeRegistrarHandler } from './_lib/handlers.js';

export default makeRegistrarHandler('gasto');

export const config = { path: '/api/registrar-gasto' };
