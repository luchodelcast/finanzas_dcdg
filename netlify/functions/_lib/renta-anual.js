/**
 * _lib/renta-anual.js — Hoja de trabajo de renta por cédulas + patrimonio
 * fiscal a 31-dic, por persona (issue #130, Fase 3.3 del roadmap contable,
 * docs/roadmap-contable.md). SOLO LECTURA: agrega `ingresos` por cédula y
 * `costos_actividad` (deducible=true) del año, y reutiliza
 * `patrimonioPorPersona` (`_lib/patrimonio.js`) para el patrimonio a 31-dic.
 * No es una declaración de renta: es un insumo/borrador para que el contador
 * (Santiago) prepare la de verdad.
 *
 * Alcance acotado de esta primera versión (ver roadmap para el detalle de las
 * decisiones que faltan por confirmar con el contador):
 *   - Solo entidades tipo 'persona' (Luis, Carolina…). Las entidades tipo
 *     'negocio' (p.ej. Ahinoa) NO se consolidan automáticamente en su dueño
 *     todavía: si tienen ingresos/costos propios en la DB, quedan fuera de
 *     este reporte hasta que se confirme la metodología de consolidación.
 *   - Costos reales (no presunción de costos DIAN), y sin desglose por
 *     cédula: `costos_actividad` no tiene columna `cedula`, así que se
 *     muestra un único total anual deducible por persona (igual que en
 *     `aportes.js`).
 *   - Patrimonio fiscal = Balance General de `patrimonio.js` a 31-dic; el
 *     ajuste a valor patrimonial (avalúos, costo fiscal de acciones, etc.)
 *     queda a cargo del contador, fuera de este sistema.
 */

import { queryIngresosPorCedula, queryAportesBase, listEntidades } from './repo.js';
import { patrimonioPorPersona } from './patrimonio.js';
import { CEDULAS } from './cedulas.js';
import { formatCOP } from '../../../app/src/utils/formatters.js';

/**
 * @param {Object} q
 * @param {number} [q.anio]        año a reportar (def: año actual)
 * @param {number} [q.entidad_id]  si se pasa, filtra a una sola persona
 * @param {Date}   [q.hoy]         fecha de referencia (inyectable para tests)
 */
export async function reporteRentaAnual({ anio, entidad_id, hoy } = {}, sqlArg) {
  const hoyDate = hoy instanceof Date ? hoy : new Date();
  const anioReporte = Number(anio) || hoyDate.getFullYear();
  const desde = `${anioReporte}-01-01`;
  const hasta = `${anioReporte}-12-31`;

  const [ingresosCedula, { costos }, entidades, patrimonio] = await Promise.all([
    queryIngresosPorCedula({ desde, hasta }, sqlArg),
    queryAportesBase({ desde, hasta }, sqlArg),
    listEntidades(sqlArg),
    patrimonioPorPersona({ fecha: hasta }, sqlArg),
  ]);

  const costosPorEntidad = new Map(costos.map((r) => [r.entidad_id, Number(r.total) || 0]));
  const patrimonioPorEntidad = new Map(patrimonio.personas.map((p) => [p.entidad_id, p]));
  const labelCedula = new Map(CEDULAS.map((c) => [c.value, c.label]));

  let personas = entidades.filter((e) => e.tipo === 'persona');
  if (entidad_id) personas = personas.filter((e) => e.id === Number(entidad_id));

  const por_persona = personas.map((e) => {
    const cedulas = ingresosCedula
      .filter((r) => r.entidad_id === e.id)
      .map((r) => ({
        cedula: r.cedula,
        label: labelCedula.get(r.cedula) || r.cedula,
        total: Number(r.total) || 0,
        total_fmt: formatCOP(Number(r.total) || 0),
      }));
    const total_ingresos = cedulas.reduce((s, c) => s + c.total, 0);
    const costos_deducibles = costosPorEntidad.get(e.id) || 0;
    const pat = patrimonioPorEntidad.get(e.id) || { totalActivo: 0, totalPasivo: 0, neto: 0 };

    return {
      anio: anioReporte,
      entidad_id: e.id,
      entidad: e.nombre,
      cedulas,
      total_ingresos,
      total_ingresos_fmt: formatCOP(total_ingresos),
      costos_deducibles,
      costos_deducibles_fmt: formatCOP(costos_deducibles),
      patrimonio: {
        activo: pat.totalActivo,
        pasivo: pat.totalPasivo,
        neto: pat.neto,
        activo_fmt: formatCOP(pat.totalActivo),
        pasivo_fmt: formatCOP(pat.totalPasivo),
        neto_fmt: formatCOP(pat.neto),
      },
    };
  });

  return {
    ok: true,
    anio: anioReporte,
    por_persona,
    nota: 'Hoja de trabajo para el contador, no es la declaración de renta. Solo lectura, no calcula '
      + 'impuesto ni presenta nada a la DIAN. Costos reales (no presunción DIAN), sin desglose por '
      + 'cédula (`costos_actividad` no distingue cédula). Entidades tipo "negocio" (p.ej. Ahinoa) no '
      + 'se consolidan aún en su dueño. Patrimonio fiscal = Balance General a 31-dic (issue #115); el '
      + 'ajuste a valor patrimonial (avalúos, costo fiscal, etc.) lo hace el contador. Metodología '
      + 'pendiente de validar por Santiago antes de usar estos números en la declaración real.',
  };
}
