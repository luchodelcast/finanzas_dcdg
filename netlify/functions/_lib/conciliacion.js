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
