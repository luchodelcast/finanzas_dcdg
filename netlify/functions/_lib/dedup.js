// _lib/dedup.js — Detección de movimientos duplicados en Registro Gastos.
//
// Función pura y testeable: recibe las filas ya leídas del Sheet (A..L) y los
// datos del nuevo movimiento, y decide si hay un posible duplicado. Criterio
// (mismo que el EmailBot, fuente-agnóstico): misma fecha + monto (±1 COP) +
// primeros 6 caracteres del comercio/descripción. NO usa el método de pago
// (evita falsos negativos cuando la cuenta se agrega después).

import { normalize } from '../../../app/src/config/rules.js';

/**
 * Busca un posible duplicado en las filas (las más recientes primero).
 * @param {Array<Array>} rows  filas de Registro Gastos desde A2 (índice 0 = fila 2)
 * @param {{ fecha: string, monto: number, descripcion: string }} mov
 * @param {number} [ventana=80]  cuántas filas recientes revisar
 * @returns {null | { rowNumber: number, metodoActual: string, tarjetaActual: string }}
 */
export function matchDuplicate(rows, mov, ventana = 80) {
  const list = Array.isArray(rows) ? rows : [];
  const monto = Number(mov.monto) || 0;
  const fecha = String(mov.fecha || '').slice(0, 10);
  const desc6 = normalize(mov.descripcion).slice(0, 6);
  if (!fecha || !monto || desc6.length < 3) return null;

  const start = Math.max(0, list.length - ventana);
  for (let i = list.length - 1; i >= start; i--) {
    const r = list[i] || [];
    const rFecha = String(r[0] || '').slice(0, 10);
    if (rFecha !== fecha) continue;
    const rMonto = Number(String(r[5] != null ? r[5] : '').replace(/[^\d.-]/g, '')) || 0;
    if (Math.abs(rMonto - monto) > 1) continue; // ±1 COP (tolera redondeo)
    const rDesc6 = normalize(r[4] || '').slice(0, 6);
    if (rDesc6 !== desc6) continue;
    return {
      rowNumber: i + 2, // los datos empiezan en la fila 2 del Sheet
      metodoActual: String(r[6] || '').trim(), // col G (método de pago)
      tarjetaActual: String(r[9] || '').trim(), // col J (tarjeta)
    };
  }
  return null;
}
