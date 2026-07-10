/**
 * GET|POST /api/pwa-costo-actividad — Registra (POST) o lista/reporta (GET)
 * costos de una actividad económica (issue #154; p.ej. Ahinoa: tejedoras,
 * proveedores), autenticado con el login de Google del usuario (equipo
 * financiero).
 * POST body: { entidad_id, fecha, concepto, monto, tercero_nombre?,
 *              tercero_nit?, deducible?, actividad?, notas? }
 * GET query: { entidad_id?, periodo?, desde?, hasta?, limit? }
 */
import { pwaCostoActividadHandler } from './_lib/handlers.js';

export default pwaCostoActividadHandler;

export const config = { path: '/api/pwa-costo-actividad' };
