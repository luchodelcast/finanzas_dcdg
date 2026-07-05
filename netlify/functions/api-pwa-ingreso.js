/**
 * GET|POST /api/pwa-ingreso — Registra (POST) o lista (GET) ingresos en la DB,
 * autenticado con el login de Google del usuario (equipo financiero).
 * POST body: { entidad_id, fecha, cedula, monto, concepto?, tercero_nombre?,
 *              tercero_nit?, retencion_fuente?, actividad?, moneda?, notas? }
 * GET query: { entidad_id?, desde?, hasta?, limit? }
 */
import { pwaIngresoHandler } from './_lib/handlers.js';

export default pwaIngresoHandler;

export const config = { path: '/api/pwa-ingreso' };
