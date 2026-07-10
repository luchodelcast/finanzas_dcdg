/**
 * _lib/conciliacion.js — Motor de cruce automático de conciliación (fase 2 de
 * docs/conciliacion.md, issue #39). Módulo puro y testeable: recibe las
 * líneas `sin_conciliar` de un extracto y los movimientos/ingresos
 * `provisional` candidatos, y PROPONE cruces. Nunca escribe nada — eso lo
 * hace `repo.confirmarConciliacion`, siempre a pedido explícito del usuario.
 *
 * Criterio (mismo que ya usa el dedup de captura — ver `_lib/dedup.js` /
 * `repo.findPosibleDuplicado`): mismo signo (débito ↔ movimientos, crédito ↔
 * ingresos), monto con tolerancia ±1, fecha dentro de una ventana (±3–5 días,
 * para compras que postean después), y descripción/comercio como desempate
 * (NO como filtro: una línea puede matchear con distinta redacción).
 *
 * Ambigüedad (más de un candidato compatible): NO se auto-resuelve ni se
 * descarta. Se devuelve `caso: 'ambiguo'` con todos los candidatos para que
 * el usuario elija manualmente cuál es el correcto (decisión abierta anotada
 * en el issue #39 — este es el default conservador elegido).
 */

import { normalize } from '../../../app/src/config/rules.js';

export const VENTANA_DIAS_DEFAULT = 4; // dentro del rango 3–5 días que pide el issue

/**
 * Normaliza una fecha a 'YYYY-MM-DD' (o null). Postgres devuelve las columnas
 * `date` como objetos Date; sin esto, `String(date).slice(0,10)` da basura
 * ("Thu Mar 05") y revienta al construir una Date con "Invalid time value".
 */
export function toISODate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const m = String(v).match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/** Diferencia en días entre dos fechas YYYY-MM-DD. Infinity si alguna es inválida. */
function difDias(a, b) {
  const ma = Date.parse(a);
  const mb = Date.parse(b);
  if (Number.isNaN(ma) || Number.isNaN(mb)) return Infinity;
  return Math.abs(ma - mb) / 86400000;
}

/** 1 si los primeros 6 caracteres normalizados del comercio/descripción coinciden, si no 0. */
function descScore(descLinea, descCandidato) {
  const a = normalize(descLinea).slice(0, 6);
  const b = normalize(descCandidato).slice(0, 6);
  return a && b && a === b ? 1 : 0;
}

/**
 * Candidatos de un tipo (movimiento|ingreso) que matchean una línea por
 * monto (±1) + fecha (±ventanaDias). La descripción NO filtra, solo ordena
 * (mejor desempate primero).
 */
function candidatosPara(linea, capturados, tipo, ventanaDias) {
  const montoAbs = Math.abs(Number(linea.monto) || 0);
  return (capturados || [])
    .filter((c) => Math.abs(Number(c.monto) - montoAbs) <= 1)
    .filter((c) => difDias(linea.fecha, c.fecha) <= ventanaDias)
    .map((c) => ({
      tipo,
      id: c.id,
      fecha: c.fecha,
      descripcion: c.descripcion,
      monto: c.monto,
      score: descScore(linea.descripcion, c.descripcion),
    }))
    .sort((a, b) => b.score - a.score || difDias(linea.fecha, a.fecha) - difDias(linea.fecha, b.fecha));
}

/**
 * Propone cruces para las líneas `sin_conciliar` de un extracto.
 * @param {Array<{id, fecha, descripcion, monto}>} lineas  extracto_lineas (ya filtradas a `sin_conciliar`)
 * @param {Array<{id, fecha, descripcion, monto}>} movimientos  candidatos con estado_conciliacion='provisional' (monto siempre > 0: valor del gasto)
 * @param {Array<{id, fecha, descripcion, monto}>} ingresos  candidatos con estado_conciliacion='provisional'
 * @param {number} [ventanaDias]
 * @returns {Array<{linea_id, fecha, descripcion, monto, tipo_linea, caso: 'match'|'ambiguo'|'solo_extracto', candidatos}>}
 */
export function proponerCruces(lineas, movimientos, ingresos, ventanaDias = VENTANA_DIAS_DEFAULT) {
  return (lineas || []).map((linea) => {
    // Débito (monto < 0 en el extracto) ↔ movimientos (gasto/pago/factura, siempre positivos).
    // Crédito (monto > 0) ↔ ingresos.
    const esDebito = Number(linea.monto) < 0;
    const candidatos = esDebito
      ? candidatosPara(linea, movimientos, 'movimiento', ventanaDias)
      : candidatosPara(linea, ingresos, 'ingreso', ventanaDias);

    let caso;
    if (candidatos.length === 0) caso = 'solo_extracto';
    else if (candidatos.length === 1) caso = 'match';
    else caso = 'ambiguo';

    return {
      linea_id: linea.id,
      fecha: linea.fecha,
      descripcion: linea.descripcion,
      monto: linea.monto,
      tipo_linea: esDebito ? 'debito' : 'credito',
      caso,
      candidatos,
    };
  });
}

// Mismo margen de redondeo que ya usa el resto del motor de cruce (±1, ver
// `candidatosPara`) — algunos extractos de banco redondean distinto al peso.
export const TOLERANCIA_CUADRE_DEFAULT = 1;

/**
 * Cuadre de saldos (paso 4 de "El proceso de conciliación", docs/conciliacion.md):
 * valida que `saldo_inicial + Σ monto(lineas) ≈ saldo_final`. `lineas` debe ser
 * TODAS las líneas del extracto (conciliadas + sin_conciliar + solo_extracto) —
 * el saldo que reporta el banco ya incluye todo lo que pasó por la cuenta, esté
 * o no cruzado con algo capturado.
 * @param {{saldo_inicial: number|null, saldo_final: number|null}} extracto
 * @param {Array<{monto: number}>} lineas
 * @returns {null|{saldo_inicial: number, saldo_final: number, saldo_calculado: number, diferencia: number, cuadra: boolean}}
 *   `null` si el extracto no tiene `saldo_inicial`/`saldo_final` cargado (nunca los tuvo, no es un error).
 */
export function cuadreExtracto(extracto, lineas, tolerancia = TOLERANCIA_CUADRE_DEFAULT) {
  const saldoInicial = extracto && extracto.saldo_inicial != null ? Number(extracto.saldo_inicial) : null;
  const saldoFinal = extracto && extracto.saldo_final != null ? Number(extracto.saldo_final) : null;
  if (saldoInicial == null || saldoFinal == null || Number.isNaN(saldoInicial) || Number.isNaN(saldoFinal)) {
    return null;
  }

  const sumaLineas = (lineas || []).reduce((acc, l) => acc + (Number(l.monto) || 0), 0);
  const saldoCalculado = Math.round((saldoInicial + sumaLineas) * 100) / 100;
  const diferencia = Math.round((saldoCalculado - saldoFinal) * 100) / 100;
  return {
    saldo_inicial: saldoInicial,
    saldo_final: saldoFinal,
    saldo_calculado: saldoCalculado,
    diferencia,
    cuadra: Math.abs(diferencia) <= tolerancia,
  };
}
