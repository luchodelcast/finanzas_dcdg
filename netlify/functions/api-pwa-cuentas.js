/**
 * GET /api/pwa-cuentas — Catálogo `⚙️ CUENTAS` (cuentas/tarjetas activas) leído
 * en el backend con la cuenta de servicio, autenticado con el login de la PWA.
 */
import { pwaCuentasHandler } from './_lib/handlers.js';

export default pwaCuentasHandler;

export const config = { path: '/api/pwa-cuentas' };
