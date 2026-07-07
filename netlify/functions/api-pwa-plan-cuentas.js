/**
 * GET /api/pwa-plan-cuentas — Plan de cuentas (PUC simplificado) para consulta,
 * autenticado con el login de Google del equipo financiero. Opcional ?clase=1..6.
 */
import { pwaPlanCuentasHandler } from './_lib/handlers.js';

export default pwaPlanCuentasHandler;

export const config = { path: '/api/pwa-plan-cuentas' };
