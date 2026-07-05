/**
 * services/finanzas.js — Consultas del dashboard contra el backend (Neon).
 *
 * La fuente de verdad es Postgres; la PWA pregunta al backend, autenticando al
 * usuario con su login de Google (mismo patrón que services/claude.js). Nunca
 * expone el token de servicio.
 */

import { getConfig } from '../config/env.js';
import { getAccessToken } from './auth.js';

async function getJSON(path, params = {}) {
  const token = await getAccessToken();
  const cfg = getConfig();
  const base = (cfg.apiBaseUrl || '').replace(/\/$/, '');
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString();
  const res = await fetch(`${base}${path}${qs ? '?' + qs : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Resumen de gastos de un periodo. periodo: 'mes' | 'semana' | 'YYYY-MM' | 'a..b'. */
export function getResumen(params = {}) {
  return getJSON('/api/pwa-resumen', params);
}

/** Lista de movimientos (filtros: desde, hasta, categoria, quien, texto, limit). */
export function getMovimientos(params = {}) {
  return getJSON('/api/pwa-movimientos', params);
}
