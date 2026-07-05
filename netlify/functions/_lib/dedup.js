// _lib/dedup.js — Detección de movimientos duplicados (función pura).
//
// NOTA: con la migración a Postgres, el camino vivo de registro usa
// `repo.findPosibleDuplicado` (misma lógica, en SQL). Esta función pura se
// conserva porque documenta y testea el criterio de forma aislada.
//
// Función pura y testeable: recibe las filas ya leídas del Sheet (A..L) y los
// datos del nuevo movimiento, y decide si hay un posible duplicado. Criterio
// (mismo que el EmailBot, fuente-agnóstico): fecha dentro de una ventana de
// ±3 días + monto (±1 COP) + primeros 6 caracteres del comercio/descripción.
// La ventana de fecha (no fecha exacta) atrapa el caso de "lo re-registro otro
// día sin dar la fecha" (queda con la fecha de hoy, distinta a la del recibo).
// NO usa el método de pago (evita falsos negativos cuando la cuenta se agrega
// después).

import { normalize } from '../../../app/src/config/rules.js';

// Diferencia en días entre dos fechas YYYY-MM-DD. Devuelve null si alguna no
// se puede interpretar como fecha.
function difDias(a, b) {
  const ma = Date.parse(a);
  const mb = Date.parse(b);
  if (Number.isNaN(ma) || Number.isNaN(mb)) return null;
  return Math.abs(ma - mb) / 86400000;
}

/**
 * Busca un posible duplicado en las filas (las más recientes primero).
 * @param {Array<Array>} rows  filas de Registro Gastos desde A2 (índice 0 = fila 2)
 * @param {{ fecha: string, monto: number, descripcion: string }} mov
 * @param {number} [ventana=80]  cuántas filas recientes revisar
 * @param {number} [ventanaDias=3]  tolerancia en días entre fechas
 * @returns {null | { rowNumber: number, metodoActual: string, tarjetaActual: string }}
 */
export function matchDuplicate(rows, mov, ventana = 80, ventanaDias = 3) {
  const list = Array.isArray(rows) ? rows : [];
  const monto = Number(mov.monto) || 0;
  const fecha = String(mov.fecha || '').slice(0, 10);
  const desc6 = normalize(mov.descripcion).slice(0, 6);
  if (!fecha || !monto || desc6.length < 3) return null;

  const start = Math.max(0, list.length - ventana);
  for (let i = list.length - 1; i >= start; i--) {
    const r = list[i] || [];
    const rFecha = String(r[0] || '').slice(0, 10);
    // Fecha dentro de la ventana de ±ventanaDias. Si alguna fecha no es
    // interpretable, no descartamos por fecha (matcheamos por monto+comercio).
    const dd = difDias(fecha, rFecha);
    if (dd != null && dd > ventanaDias) continue;
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
