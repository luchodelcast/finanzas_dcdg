/**
 * services/finanzas.js — Consultas y captura contra el backend (Neon).
 *
 * La fuente de verdad es Postgres; la PWA pregunta/escribe al backend,
 * autenticando al usuario con su login de Google (mismo patrón que claude.js).
 * Nunca expone el token de servicio.
 */

import { getConfig } from '../config/env.js';
import { getAccessToken } from './auth.js';

async function request(path, { method = 'GET', params = {}, body } = {}) {
  const token = await getAccessToken();
  const cfg = getConfig();
  const base = (cfg.apiBaseUrl || '').replace(/\/$/, '');
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString();
  const res = await fetch(`${base}${path}${qs ? '?' + qs : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Descarga un reporte como CSV (issue #91): pide el archivo con el login de Google y lo guarda en el dispositivo. */
export async function descargarCsv(path, params, nombreArchivo) {
  const token = await getAccessToken();
  const cfg = getConfig();
  const base = (cfg.apiBaseUrl || '').replace(/\/$/, '');
  const qs = new URLSearchParams(
    Object.entries({ ...params, formato: 'csv' }).filter(([, v]) => v != null && v !== '')
  ).toString();
  const res = await fetch(`${base}${path}?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const texto = await res.text();
  const blob = new Blob([texto], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Resumen de gastos de un periodo. */
export const getResumen = (params = {}) => request('/api/pwa-resumen', { params });

/** Lista de movimientos (gastos). */
export const getMovimientos = (params = {}) => request('/api/pwa-movimientos', { params });

/** Catálogos para el formulario de ingresos (entidades, terceros, cédulas). */
export const getCatalogos = () => request('/api/pwa-catalogos');

/** Email y rol (owner/solo_lectura/etc.) del usuario autenticado (T8b, issue #98). */
export const getWhoami = () => request('/api/pwa-whoami');

/** Lista de ingresos. */
export const getIngresos = (params = {}) => request('/api/pwa-ingreso', { params });

/** Registra un ingreso. */
export const registrarIngreso = (body) => request('/api/pwa-ingreso', { method: 'POST', body });

/** Lista de extractos bancarios cargados (o las líneas de uno, con extracto_id). */
export const getExtractos = (params = {}) => request('/api/pwa-extracto', { params });

/** Carga un extracto bancario en CSV. */
export const subirExtracto = (body) => request('/api/pwa-extracto', { method: 'POST', body });

/** Propone cruces de conciliación para un extracto (solo lectura). */
export const getPropuestasConciliacion = (extracto_id) =>
  request('/api/pwa-conciliacion', { params: { extracto_id } });

/** Confirma un cruce (o el elegido manualmente ante ambigüedad) → marca conciliado. */
export const confirmarCruce = (body) => request('/api/pwa-conciliacion', { method: 'POST', body });

/** Propone la materialización de las líneas `solo_extracto` de un extracto (solo lectura). */
export const getPropuestasBackfill = (extracto_id) =>
  request('/api/pwa-backfill', { params: { extracto_id } });

/** Contabiliza (crea + asienta) las líneas de backfill aceptadas por el usuario. */
export const materializarBackfill = (body) => request('/api/pwa-backfill', { method: 'POST', body });

/** Reporte mensual de aportes IBC por persona (Fase 3.2, solo lectura). */
export const getAportes = (params = {}) => request('/api/pwa-aportes', { params });

/** Plan de cuentas (PUC). Opcional ?clase=1..6. */
export const getPlanCuentas = (params = {}) => request('/api/pwa-plan-cuentas', { params });

/** Agrega una cuenta nueva de Activo o Pasivo al plan de cuentas (solo owners). */
export const crearCuentaPlan = (body) => request('/api/pwa-plan-cuentas', { method: 'POST', body });

/** Apertura existente de una entidad (o null). */
export const getApertura = (params = {}) => request('/api/pwa-apertura', { params });

/** Guarda el asiento de apertura (saldos iniciales). */
export const guardarApertura = (body) => request('/api/pwa-apertura', { method: 'POST', body });

/** Libro Mayor de una cuenta (T5, solo lectura). Requiere {cuenta}, opcional desde/hasta/entidad_id. */
export const getMayor = (params = {}) => request('/api/pwa-mayor', { params });

/** Balance de Comprobación (T5, solo lectura). Opcional desde/hasta/entidad_id. */
export const getComprobacion = (params = {}) => request('/api/pwa-comprobacion', { params });

/** Estado de Resultados (T6, solo lectura). Opcional desde/hasta/entidad_id. */
export const getEstadoResultados = (params = {}) => request('/api/pwa-estado-resultados', { params });

/** Balance General a una fecha (T7, solo lectura). Opcional fecha/entidad_id. */
export const getBalanceGeneral = (params = {}) => request('/api/pwa-balance-general', { params });

/** Pagos del mes (issue #73): catálogo + estado de un (anio, mes), y pendientes del mes anterior. */
export const getPagosDelMes = (params = {}) => request('/api/pwa-pagos', { params });

/** Marca un pago fijo como pagado en su mes (solo owners). */
export const marcarPagoFijo = (body) => request('/api/pwa-pagos', { method: 'POST', body: { accion: 'marcar', ...body } });

/** Desmarca un pago fijo (vuelve a pendiente, solo owners). */
export const desmarcarPagoFijo = (body) => request('/api/pwa-pagos', { method: 'POST', body: { accion: 'desmarcar', ...body } });

/** Agrega un pago fijo nuevo al catálogo (solo owners). */
export const crearPagoFijo = (body) => request('/api/pwa-pagos', { method: 'POST', body: { accion: 'crear', ...body } });

/** Edita (o desactiva, con {activo:false}) un pago fijo existente (solo owners). */
export const editarPagoFijo = (body) => request('/api/pwa-pagos', { method: 'POST', body: { accion: 'editar', ...body } });

/** Préstamos entre Luis y Carolina (issue #77): lista + saldo neto por moneda. */
export const getPrestamos = (params = {}) => request('/api/pwa-prestamos', { params });

/** Registra un préstamo (o un abono, con "de"/"para" invertidos). Solo owners. */
export const crearPrestamo = (body) => request('/api/pwa-prestamos', { method: 'POST', body: { accion: 'crear', ...body } });

/** Marca (o desmarca, con {saldado:false}) un préstamo como saldado. Solo owners. */
export const marcarPrestamoSaldado = (body) => request('/api/pwa-prestamos', { method: 'POST', body: { accion: 'marcar_saldado', ...body } });

/** Solicitudes de mejoras (issue #78): lista issues abiertos con label `autobuild`. */
export const getSolicitudes = () => request('/api/pwa-solicitudes');

/** Envía una solicitud de mejora nueva (crea el issue en GitHub). Solo owners. */
export const crearSolicitud = (body) => request('/api/pwa-solicitudes', { method: 'POST', body });
