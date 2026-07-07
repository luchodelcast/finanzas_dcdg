/**
 * GET|POST /api/pwa-extracto — Carga (POST) o lista (GET) extractos bancarios
 * en CSV, autenticado con el login de Google del usuario (equipo financiero).
 * Primer paso del cargador de extractos (docs/conciliacion.md): solo deja las
 * líneas cargadas y visibles; el motor de cruce automático es una fase futura.
 * POST body: { cuenta, csv, periodo?, fecha_desde?, fecha_hasta?, saldo_inicial?, saldo_final?, moneda? }
 * GET query: { cuenta? } (lista extractos) | { extracto_id } (líneas de uno)
 */
import { pwaExtractoHandler } from './_lib/handlers.js';

export default pwaExtractoHandler;

export const config = { path: '/api/pwa-extracto' };
