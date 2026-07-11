/**
 * _lib/costos.js — Captura y reporte de costos de actividad económica
 * (issue #154; p.ej. Ahinoa: tejedoras, proveedores de prendas).
 *
 * `costos_actividad` ya se leía de forma agregada en el reporte de aportes
 * IBC (`_lib/aportes.js` vía `queryAportesBase`), pero no existía ningún
 * endpoint/handler que escribiera ahí — Carolina no tenía forma de registrar
 * un costo de Ahinoa. Este módulo agrega el reporte de solo lectura (lista +
 * mini-P&L por negocio); la escritura vive en `insertCostoActividad`
 * (`_lib/repo.js`), llamada desde `pwaCostoActividadHandler`.
 *
 * Consolidación en la base IBC de la persona dueña (issue #154, decisión de
 * Luis): `reporteAportes()` ya suma automáticamente el neto de cada negocio
 * (por `propietario_id`) a la base IBC de su dueña. El mini-P&L de acá sigue
 * siendo el reporte informativo por negocio (no reemplaza esa consolidación).
 */

import { listEntidades, listCostosActividad, queryAportesBase } from './repo.js';
import { rangoPeriodo } from './finanzas.js';
import { formatCOP } from '../../../app/src/utils/formatters.js';

/**
 * @param {Object} q
 * @param {string} [q.periodo]    'mes' (def) | 'YYYY-MM' | 'YYYY-MM-DD..YYYY-MM-DD'
 * @param {number} [q.entidad_id] filtra la lista y el mini-P&L a una sola entidad
 * @param {number} [q.limit]      límite de la lista de costos (def. 50)
 * @param {Date}   [q.hoy]        fecha de referencia (inyectable para tests)
 */
export async function reporteCostosActividad(q = {}) {
  const hoy = q.hoy instanceof Date ? q.hoy : new Date();
  const { desde, hasta, etiqueta } = rangoPeriodo(q.periodo, hoy);
  const entidad_id = q.entidad_id ? Number(q.entidad_id) : undefined;

  const [entidades, costos, { ingresos }] = await Promise.all([
    listEntidades(),
    listCostosActividad({ entidad_id, desde, hasta, limit: q.limit }),
    queryAportesBase({ desde, hasta }),
  ]);

  const ingresosPorEntidad = new Map(ingresos.map((r) => [r.entidad_id, Number(r.total) || 0]));
  const negocios = entidades.filter((e) => e.tipo === 'negocio' && (!entidad_id || e.id === entidad_id));

  const por_negocio = negocios.map((e) => {
    const ingresosMonto = ingresosPorEntidad.get(e.id) || 0;
    const costosMonto = costos
      .filter((c) => c.entidad_id === e.id && c.deducible)
      .reduce((s, c) => s + (Number(c.monto) || 0), 0);
    const utilidad = ingresosMonto - costosMonto;
    return {
      entidad_id: e.id,
      entidad: e.nombre,
      ingresos: ingresosMonto,
      ingresos_fmt: formatCOP(ingresosMonto),
      costos_deducibles: costosMonto,
      costos_deducibles_fmt: formatCOP(costosMonto),
      utilidad,
      utilidad_fmt: formatCOP(utilidad),
    };
  });

  return {
    ok: true,
    periodo: etiqueta,
    desde,
    hasta,
    costos,
    por_negocio,
    nota: 'Solo lectura: costos capturados y un mini-P&L (ingresos − costos deducibles) por negocio. '
      + 'El neto de cada negocio ya se consolida automáticamente en la base IBC de su dueño '
      + '(ver el reporte de Aportes IBC).',
  };
}
