/**
 * _lib/backfill.js — Backfill de líneas `solo_extracto` (issue #72, Nocturno
 * 1/7): materializa como movimientos/ingresos ya contabilizados las líneas
 * que el banco registró pero que nunca se capturaron en la App/SilvIA.
 *
 * Módulo puro y testeable: dada una línea de extracto (`{id, fecha,
 * descripcion, monto}`), PROPONE cómo materializarla (tipo, categoría,
 * confianza) sin tocar la DB. La orquestación (crear el movimiento/ingreso,
 * contabilizarlo, marcar la línea) vive en `handlers.js`, igual que el resto
 * del motor de conciliación (`_lib/conciliacion.js`).
 */

import { normalize, classifyByRules } from '../../../app/src/config/rules.js';

/** Palabras que delatan un traslado entre cuentas propias (no un gasto/ingreso real). */
export const TRANSFER_KEYWORDS = ['transferencia', 'traslado', 'translado', 'trf '];

/** Umbral de confianza para auto-aceptar (regla determinística = 0.9). */
export const CONFIANZA_AUTO = 0.85;

/** Deduce el tipo de una línea de extracto: transferencia | gasto | ingreso. */
export function detectarTipoLinea(descripcion, monto) {
  const d = normalize(descripcion);
  if (TRANSFER_KEYWORDS.some((k) => d.includes(k))) return 'transferencia';
  return Number(monto) < 0 ? 'gasto' : 'ingreso';
}

/**
 * Propone cómo materializar una línea `solo_extracto` (sin escribir nada).
 * @param {{id, fecha, descripcion, monto}} linea
 * @param {{cuenta?: string}} [opts]  cuenta del extracto (metodo_pago del movimiento).
 * @returns {{linea_id, fecha, descripcion, monto, tipo, categoria, subcategoria,
 *            metodo_pago, confianza, auto, motivo}}
 */
export function proponerBackfillLinea(linea, { cuenta = '' } = {}) {
  const monto = Math.abs(Number(linea.monto) || 0);
  const tipo = detectarTipoLinea(linea.descripcion, linea.monto);
  const base = {
    linea_id: linea.id,
    fecha: linea.fecha,
    descripcion: linea.descripcion || '',
    monto,
    tipo,
    categoria: '',
    subcategoria: '',
    metodo_pago: cuenta || '',
    confianza: 0,
    auto: false,
    motivo: '',
  };

  if (tipo === 'transferencia') {
    return { ...base, motivo: 'Transferencia entre cuentas propias: elige la cuenta destino.' };
  }

  if (tipo === 'gasto') {
    const porRegla = classifyByRules(linea.descripcion);
    if (porRegla) {
      return {
        ...base,
        categoria: porRegla.categoria,
        subcategoria: porRegla.subcategoria,
        metodo_pago: porRegla.metodo_pago || cuenta || '',
        confianza: 0.9,
        auto: true,
      };
    }
    return { ...base, motivo: 'Sin regla de clasificación: revisa/ajusta la categoría.' };
  }

  // Crédito → ingreso: siempre requiere entidad + cédula (no se puede inferir del banco).
  return { ...base, motivo: 'Ingreso: elige entidad y cédula antes de aceptar.' };
}

/** Propone la materialización de todas las líneas `solo_extracto` de un extracto. */
export function proponerBackfillExtracto(lineasSoloExtracto, { cuenta = '' } = {}) {
  return (lineasSoloExtracto || []).map((l) => proponerBackfillLinea(l, { cuenta }));
}
