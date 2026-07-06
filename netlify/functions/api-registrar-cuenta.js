/**
 * POST /api/registrar-cuenta — Da de alta una cuenta/tarjeta en `⚙️ CUENTAS`.
 * Autenticado con el token de servicio (lo llama SilvIA).
 * body: { banco?, titular?, tarjeta? | tarjeta_ultimos4?, tipo?, moneda?, nombre? }
 */
import { registrarCuentaHandler } from './_lib/handlers.js';

export default registrarCuentaHandler;

export const config = { path: '/api/registrar-cuenta' };
