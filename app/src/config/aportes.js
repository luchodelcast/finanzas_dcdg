/**
 * config/aportes.js — Config versionada de SMMLV y tarifas de aportes (Fase 3.2
 * del roadmap contable, ver docs/roadmap-contable.md §3 y §9).
 *
 * Módulo puro (sin DB ni APIs de navegador), en el mismo espíritu que
 * config/rules.js y config/categories.js: las tarifas/topes se actualizan aquí,
 * cada año, sin tocar la lógica de cálculo (netlify/functions/_lib/aportes.js).
 *
 * ⚠️ VALIDAR CON EL CONTADOR (Santiago): estos son los últimos valores
 * confirmados al escribir este módulo. Revisa/actualiza `SMMLV_POR_ANIO` cada
 * enero cuando salga el decreto del Gobierno. Si el año consultado no está en
 * la tabla, se usa el último año conocido y el resultado se marca
 * `smmlvAproximado: true` para que quede visible en el reporte.
 *
 * Simplificaciones de esta primera versión (ver decisiones abiertas en el PR
 * y en docs/roadmap-contable.md §3):
 *   - Usa COSTOS REALES (`costos_actividad` con deducible=true), NO el esquema
 *     de presunción de costos de la DIAN.
 *   - El FSP (Fondo de Solidaridad Pensional) se modela con una tarifa PLANA
 *     de 1% desde 4 SMMLV. El FSP real es progresivo por tramos de IBC
 *     (4–16, 16–17, 17–18, 18–19, 19–20 SMMLV con tarifas crecientes) — el
 *     contador debe confirmar si este reporte necesita ese desglose completo.
 *   - ARL no se calcula (depende de la clase de riesgo de la actividad, aún
 *     sin definir por persona/actividad); se deja `arlPendiente: true`.
 */

// SMMLV (Salario Mínimo Mensual Legal Vigente) por año, en COP.
// Fuente: decretos de fin de año del Gobierno de Colombia.
export const SMMLV_POR_ANIO = {
  2023: 1160000,
  2024: 1300000,
  2025: 1423500,
  // 2026: aún no incluido aquí — agrega la línea cuando el contador confirme
  // el decreto del SMMLV 2026. Mientras tanto, smmlvDe() usa 2025 (último año
  // conocido) y marca el resultado como aproximado.
};

const ULTIMO_ANIO_CONOCIDO = Math.max(...Object.keys(SMMLV_POR_ANIO).map(Number));

/**
 * SMMLV vigente para `anio`. Si no está confirmado en la tabla, devuelve el
 * del último año conocido con `aproximado: true` (para avisar en el reporte).
 */
export function smmlvDe(anio) {
  const y = Number(anio) || ULTIMO_ANIO_CONOCIDO;
  if (SMMLV_POR_ANIO[y] != null) return { valor: SMMLV_POR_ANIO[y], anio: y, aproximado: false };
  return { valor: SMMLV_POR_ANIO[ULTIMO_ANIO_CONOCIDO], anio: ULTIMO_ANIO_CONOCIDO, aproximado: true };
}

// Reglas del IBC de independientes (Ley 100 de 1993 y decretos reglamentarios).
export const REGLAS_IBC = {
  porcentajeBase: 0.40, // IBC = 40% × (ingresos − costos deducibles)
  pisoEnSMMLV: 1,
  techoEnSMMLV: 25,
};

// Tarifas de aportes sobre el IBC.
export const TARIFAS_APORTES = {
  salud: 0.125,
  pension: 0.16,
  fsp: {
    umbralEnSMMLV: 4, // aplica si IBC >= 4 SMMLV
    tarifa: 0.01, // simplificado (ver nota de cabecera sobre tramos progresivos)
  },
};

/**
 * Calcula el IBC mensual: 40% × (ingresos − costos deducibles), acotado a
 * [piso, techo] en SMMLV del año dado.
 * @param {Object} p
 * @param {number} [p.ingresos]
 * @param {number} [p.costosDeducibles]
 * @param {number} [p.anio]  año del periodo reportado (para el SMMLV vigente)
 */
export function calcularIBC({ ingresos = 0, costosDeducibles = 0, anio } = {}) {
  const { valor: smmlv, anio: smmlvAnio, aproximado } = smmlvDe(anio);
  const base = Math.max(0, Number(ingresos) - Number(costosDeducibles));
  const ibcCrudo = base * REGLAS_IBC.porcentajeBase;
  const piso = smmlv * REGLAS_IBC.pisoEnSMMLV;
  const techo = smmlv * REGLAS_IBC.techoEnSMMLV;
  const ibc = Math.min(Math.max(ibcCrudo, piso), techo);
  const topado = ibcCrudo < piso ? 'piso' : ibcCrudo > techo ? 'techo' : null;
  return { ibc, ibcCrudo, base, smmlv, smmlvAnio, smmlvAproximado: aproximado, piso, techo, topado };
}

/**
 * Calcula el desglose de aportes (salud, pensión, FSP) sobre un IBC ya
 * calculado. ARL no se calcula en esta versión (ver nota de cabecera).
 * @param {Object} p
 * @param {number} p.ibc
 * @param {number} p.smmlv
 */
export function calcularAportes({ ibc = 0, smmlv = 0 } = {}) {
  const salud = ibc * TARIFAS_APORTES.salud;
  const pension = ibc * TARIFAS_APORTES.pension;
  const fspAplica = smmlv > 0 && ibc >= smmlv * TARIFAS_APORTES.fsp.umbralEnSMMLV;
  const fsp = fspAplica ? ibc * TARIFAS_APORTES.fsp.tarifa : 0;
  const total = salud + pension + fsp;
  return { salud, pension, fsp, fspAplica, total, arlPendiente: true };
}
