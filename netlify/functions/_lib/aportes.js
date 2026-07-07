/**
 * _lib/aportes.js — Reporte mensual de aportes IBC por persona (Fase 3.2 del
 * roadmap contable, docs/roadmap-contable.md). SOLO LECTURA: agrega
 * `ingresos` y `costos_actividad` (deducible=true) ya capturados en la Fase
 * 3.1 y aplica las reglas de `app/src/config/aportes.js`. No registra pagos
 * de aportes ni concilia nada.
 *
 * Alcance acotado de esta primera versión (ver PR y roadmap para el detalle
 * de las decisiones que faltan por confirmar con el contador):
 *   - Solo entidades tipo 'persona' (Luis, Carolina…) — se asume que cada una
 *     cotiza por separado (dos contribuyentes). Las entidades tipo 'negocio'
 *     (p.ej. Ahinoa) NO se consolidan automáticamente en su dueño todavía:
 *     si tienen ingresos/costos propios en la DB, quedan fuera de este
 *     reporte hasta que se confirme la metodología de consolidación.
 *   - Costos reales (no presunción de costos DIAN).
 *   - Sin tratamiento especial de ingresos irregulares (honorarios
 *     multi-mes, anticipos): se cuentan en el mes en que quedaron registrados.
 */

import { queryAportesBase, listEntidades } from './repo.js';
import { rangoPeriodo } from './finanzas.js';
import { calcularIBC, calcularAportes } from '../../../app/src/config/aportes.js';
import { formatCOP } from '../../../app/src/utils/formatters.js';

/**
 * @param {Object} q
 * @param {string} [q.periodo]  'mes' (def) | 'YYYY-MM' | 'YYYY-MM-DD..YYYY-MM-DD'
 * @param {Date}   [q.hoy]      fecha de referencia (inyectable para tests)
 */
export async function reporteAportes(q = {}) {
  const hoy = q.hoy instanceof Date ? q.hoy : new Date();
  const { desde, hasta, etiqueta } = rangoPeriodo(q.periodo, hoy);
  const anio = Number(desde.slice(0, 4)) || hoy.getFullYear();

  const [{ ingresos, costos }, entidades] = await Promise.all([
    queryAportesBase({ desde, hasta }),
    listEntidades(),
  ]);

  const ingresosPorEntidad = new Map(ingresos.map((r) => [r.entidad_id, Number(r.total) || 0]));
  const costosPorEntidad = new Map(costos.map((r) => [r.entidad_id, Number(r.total) || 0]));

  const personas = entidades.filter((e) => e.tipo === 'persona');
  const por_persona = personas.map((e) => {
    const ingresosMonto = ingresosPorEntidad.get(e.id) || 0;
    const costosMonto = costosPorEntidad.get(e.id) || 0;
    const ibcCalc = calcularIBC({ ingresos: ingresosMonto, costosDeducibles: costosMonto, anio });
    const aportes = calcularAportes({ ibc: ibcCalc.ibc, smmlv: ibcCalc.smmlv });

    return {
      entidad_id: e.id,
      entidad: e.nombre,
      ingresos: ingresosMonto,
      ingresos_fmt: formatCOP(ingresosMonto),
      costos_deducibles: costosMonto,
      costos_deducibles_fmt: formatCOP(costosMonto),
      ibc: ibcCalc.ibc,
      ibc_fmt: formatCOP(ibcCalc.ibc),
      ibc_topado: ibcCalc.topado, // 'piso' | 'techo' | null
      smmlv: ibcCalc.smmlv,
      smmlv_anio: ibcCalc.smmlvAnio,
      smmlv_aproximado: ibcCalc.smmlvAproximado,
      aportes: {
        salud: aportes.salud,
        salud_fmt: formatCOP(aportes.salud),
        pension: aportes.pension,
        pension_fmt: formatCOP(aportes.pension),
        fsp: aportes.fsp,
        fsp_fmt: formatCOP(aportes.fsp),
        fsp_aplica: aportes.fspAplica,
        arl_pendiente: aportes.arlPendiente,
        total: aportes.total,
        total_fmt: formatCOP(aportes.total),
      },
    };
  });

  return {
    ok: true,
    periodo: etiqueta,
    desde,
    hasta,
    por_persona,
    nota: 'Solo lectura, no registra pagos ni concilia. Costos reales (no presunción DIAN). '
      + 'No incluye ARL. Asume que cada persona cotiza por separado. Entidades tipo "negocio" '
      + '(p.ej. Ahinoa) no se consolidan aún en su dueño. Metodología pendiente de validar por el contador.',
  };
}
