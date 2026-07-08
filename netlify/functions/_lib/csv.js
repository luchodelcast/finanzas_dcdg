/**
 * _lib/csv.js — Arma los exports contables en CSV (T12a, issue #91).
 *
 * Puro: recibe las mismas estructuras que ya devuelven asientos.js/repo.js
 * (Libro Diario), mayor.js (Libro Mayor, Balance de Comprobación) y
 * estados.js (Estado de Resultados, Balance General) — sin tocar la DB ni
 * Sheets, sin escribir nada.
 */

/** Escapa una celda CSV (RFC 4180: comillas si trae coma, comilla o salto de línea). */
function celda(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function armarCSV(headers, rows) {
  const lineas = [headers.map(celda).join(',')];
  for (const r of rows) lineas.push(r.map(celda).join(','));
  return lineas.join('\r\n') + '\r\n';
}

/** Libro Diario: un renglón por línea de asiento (`queryAsientos`, cada asiento con sus `lineas`). */
export function csvLibroDiario(asientos) {
  const headers = ['asiento_id', 'fecha', 'descripcion', 'cuenta', 'debito', 'credito'];
  const rows = [];
  for (const a of asientos || []) {
    for (const l of a.lineas || []) {
      rows.push([a.id, a.fecha, a.descripcion || '', l.cuenta, l.debito || 0, l.credito || 0]);
    }
  }
  return armarCSV(headers, rows);
}

/** Libro Mayor de una cuenta: renglones con saldo corrido (`mayorCuenta`). */
export function csvLibroMayor(cuenta, lineas) {
  const headers = ['cuenta', 'nombre_cuenta', 'fecha', 'asiento_id', 'descripcion', 'debito', 'credito', 'saldo'];
  const rows = (lineas || []).map((l) => [
    cuenta.codigo, cuenta.nombre, l.fecha, l.asiento_id, l.descripcion || '', l.debito || 0, l.credito || 0, l.saldo,
  ]);
  return armarCSV(headers, rows);
}

/** Balance de Comprobación: saldo por cuenta + fila de totales (`balanceComprobacion`). */
export function csvComprobacion({ cuentas, totalDebito, totalCredito }) {
  const headers = ['codigo', 'nombre', 'clase', 'naturaleza', 'debito', 'credito', 'saldo'];
  const rows = (cuentas || []).map((c) => [c.codigo, c.nombre, c.clase, c.naturaleza, c.debito, c.credito, c.saldo]);
  rows.push(['', 'TOTAL', '', '', totalDebito, totalCredito, '']);
  return armarCSV(headers, rows);
}

/** Estado de Resultados: ingresos/gastos/costos + fila de resultado (`estadoResultados`). */
export function csvEstadoResultados({ ingresos, gastos, costos, totalIngresos, totalGastos, totalCostos, resultado }) {
  const headers = ['grupo', 'codigo', 'nombre', 'saldo'];
  const rows = [];
  for (const c of ingresos || []) rows.push(['Ingresos', c.codigo, c.nombre, c.saldo]);
  for (const c of gastos || []) rows.push(['Gastos', c.codigo, c.nombre, c.saldo]);
  for (const c of costos || []) rows.push(['Costos', c.codigo, c.nombre, c.saldo]);
  rows.push(['', '', 'Total ingresos', totalIngresos]);
  rows.push(['', '', 'Total gastos', totalGastos]);
  rows.push(['', '', 'Total costos', totalCostos]);
  rows.push(['', '', 'Resultado del periodo', resultado]);
  return armarCSV(headers, rows);
}

/** Balance General: activo/pasivo/patrimonio + cuadre (`balanceGeneral`). */
export function csvBalanceGeneral({ activo, pasivo, patrimonio, resultadoEjercicio, totalActivo, totalPasivo, totalPatrimonio }) {
  const headers = ['grupo', 'codigo', 'nombre', 'saldo'];
  const rows = [];
  for (const c of activo || []) rows.push(['Activo', c.codigo, c.nombre, c.saldo]);
  for (const c of pasivo || []) rows.push(['Pasivo', c.codigo, c.nombre, c.saldo]);
  for (const c of patrimonio || []) rows.push(['Patrimonio', c.codigo, c.nombre, c.saldo]);
  rows.push(['', '', 'Resultado del ejercicio', resultadoEjercicio]);
  rows.push(['', '', 'Total activo', totalActivo]);
  rows.push(['', '', 'Total pasivo', totalPasivo]);
  rows.push(['', '', 'Total patrimonio (con resultado)', totalPatrimonio]);
  return armarCSV(headers, rows);
}
