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

/** Resumen de gastos de un periodo. */
export const getResumen = (params = {}) => request('/api/pwa-resumen', { params });

/** Lista de movimientos (gastos). */
export const getMovimientos = (params = {}) => request('/api/pwa-movimientos', { params });

/** Catálogos para el formulario de ingresos (entidades, terceros, cédulas). */
export const getCatalogos = () => request('/api/pwa-catalogos');

/** Lista de ingresos. */
export const getIngresos = (params = {}) => request('/api/pwa-ingreso', { params });

/** Registra un ingreso. */
export const registrarIngreso = (body) => request('/api/pwa-ingreso', { method: 'POST', body });
