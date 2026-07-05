/**
 * _lib/sheet-mirror.js — Espejo de exportación al Google Sheet (best-effort).
 *
 * La fuente de verdad es Postgres. El Sheet quedó como copia para exportar/ver,
 * así que estas escrituras NUNCA deben tumbar una transacción: si el Sheet falla,
 * se registra el fallo y se sigue (los datos ya están seguros en la DB).
 */

import { config } from './env.js';
import { appendRow } from './sheets.js';

/** Agrega una fila al Sheet sin propagar errores. Devuelve true/false. */
async function mirror(sheetName, fila) {
  try {
    await appendRow(sheetName, fila);
    return true;
  } catch (e) {
    console.error(`[sheet-mirror] no se pudo espejar en "${sheetName}": ${e.message}`);
    return false;
  }
}

export function mirrorMovimiento(fila) {
  return mirror(config.sheetGastos(), fila);
}

export function mirrorEmpresa(fila) {
  return mirror(config.sheetEmpresas(), fila);
}
