/**
 * GET/POST /api/pwa-cierre-mes — "Cierre del mes" (issue #118): resumen
 * consolidado del ritual mensual de revisión de la pareja, solo lectura
 * (GET) + envío opcional del resumen por WhatsApp (POST). Auth Google.
 */
import { pwaCierreMesHandler } from './_lib/handlers.js';

export default pwaCierreMesHandler;

export const config = { path: '/api/pwa-cierre-mes' };
