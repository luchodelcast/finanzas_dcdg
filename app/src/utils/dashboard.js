/**
 * utils/dashboard.js — Agregaciones puras para el 📊 Dashboard de la PWA.
 * Módulo puro (testeable con node --test); opera sobre las filas crudas de
 * `Registro Gastos` (A-J) ya leídas con `readRange`.
 */

import { hoyISO } from './formatters.js';

const ISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

/**
 * Calcula el rango [desde, hasta] para un periodo del dashboard.
 * @param {'mes'|'mes-anterior'|'3-meses'} periodo
 * @param {Date} [hoy] fecha de referencia (inyectable para tests)
 * @returns {{desde: string, hasta: string, etiqueta: string}}
 */
export function rangoDashboard(periodo, hoy = new Date()) {
  const p = String(periodo || 'mes').toLowerCase().trim();

  if (p === 'mes-anterior') {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    return { desde: ISO(ini), hasta: ISO(fin), etiqueta: 'mes anterior' };
  }

  if (p === '3-meses') {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1);
    return { desde: ISO(ini), hasta: hoyISO(hoy), etiqueta: 'últimos 3 meses' };
  }

  const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  return { desde: ISO(ini), hasta: hoyISO(hoy), etiqueta: 'mes actual' };
}

/**
 * Top comercios/descripciones por monto dentro de un rango de fechas.
 * @param {Array<Array>} rows  filas crudas de `Registro Gastos` A-J
 *   (A fecha, B mes, C categoría, D subcategoría, E descripción, F monto, …)
 * @param {Object} [opts]
 * @param {string} [opts.desde]  YYYY-MM-DD (inclusive)
 * @param {string} [opts.hasta]  YYYY-MM-DD (inclusive)
 * @param {number} [opts.limite] cuántos comercios devolver (def 5)
 * @returns {Array<{descripcion: string, monto: number}>}
 */
export function topComercios(rows, { desde, hasta, limite = 5 } = {}) {
  const porDescripcion = {};

  for (const r of rows || []) {
    const fecha = r[0];
    if (!fecha) continue;
    if (desde && fecha < desde) continue;
    if (hasta && fecha > hasta) continue;
    const descripcion = (r[4] || '').trim();
    if (!descripcion) continue;
    const monto = Number(r[5]) || 0;
    porDescripcion[descripcion] = (porDescripcion[descripcion] || 0) + monto;
  }

  return Object.entries(porDescripcion)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([descripcion, monto]) => ({ descripcion, monto }));
}
