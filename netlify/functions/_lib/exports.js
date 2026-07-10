/**
 * _lib/exports.js — Exports contables en CSV (issue #91, sub-issue de #52,
 * T12a). Solo lectura: arma el CSV a partir de las mismas estructuras que ya
 * devuelven `_lib/repo.js` (queryAsientos), `_lib/mayor.js` y `_lib/estados.js`
 * — no agrega ninguna consulta nueva a la DB. Los montos van como número
 * plano (sin `$`/separador de miles) para que Excel/Sheets los lea como
 * numéricos, no como texto.
 */

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function filasACsv(headers, filas) {
  const lineas = [headers.map(csvEscape).join(',')];
  for (const fila of filas) lineas.push(fila.map(csvEscape).join(','));
  return lineas.join('\r\n');
}

/** Libro Diario: un renglón por línea de asiento (explota `asiento.lineas`). */
export function csvLibroDiario(asientos) {
  const headers = ['fecha', 'asiento_id', 'descripcion', 'entidad_id', 'origen', 'cuenta', 'debito', 'credito'];
  const filas = [];
  for (const a of asientos || []) {
    for (const l of a.lineas || []) {
      filas.push([a.fecha, a.id, a.descripcion || '', a.entidad_id ?? '', a.origen || '', l.cuenta, l.debito || 0, l.credito || 0]);
    }
  }
  return filasACsv(headers, filas);
}

/** Libro Mayor de una cuenta: un renglón por línea, con saldo corrido. */
export function csvLibroMayor(cuenta, lineas) {
  const headers = ['cuenta', 'nombre', 'fecha', 'asiento_id', 'descripcion', 'debito', 'credito', 'saldo'];
  const filas = (lineas || []).map((l) => [
    cuenta?.codigo || '', cuenta?.nombre || '', l.fecha, l.asiento_id, l.descripcion || '', l.debito || 0, l.credito || 0, l.saldo,
  ]);
  return filasACsv(headers, filas);
}

/** Balance de Comprobación: una fila por cuenta con movimiento en el rango. */
export function csvComprobacion(cuentas) {
  const headers = ['codigo', 'nombre', 'clase', 'naturaleza', 'debito', 'credito', 'saldo'];
  const filas = (cuentas || []).map((c) => [c.codigo, c.nombre, c.clase, c.naturaleza, c.debito || 0, c.credito || 0, c.saldo]);
  return filasACsv(headers, filas);
}

const GRUPO_ROW = (grupo, c) => [grupo, c.codigo, c.nombre, c.debito || 0, c.credito || 0, c.saldo];
const TOTAL_ROW = (etiqueta, valor) => ['total', '', etiqueta, '', '', valor];

/** Estado de Resultados: filas por cuenta (grupo ingresos/gastos/costos) + totales. */
export function csvEstadoResultados(estado) {
  const headers = ['grupo', 'codigo', 'nombre', 'debito', 'credito', 'saldo'];
  const e = estado || {};
  const filas = [
    ...(e.ingresos || []).map((c) => GRUPO_ROW('ingresos', c)),
    ...(e.gastos || []).map((c) => GRUPO_ROW('gastos', c)),
    ...(e.costos || []).map((c) => GRUPO_ROW('costos', c)),
    TOTAL_ROW('Total ingresos', e.totalIngresos),
    TOTAL_ROW('Total gastos', e.totalGastos),
    TOTAL_ROW('Total costos', e.totalCostos),
    TOTAL_ROW('Resultado del periodo', e.resultado),
  ];
  return filasACsv(headers, filas);
}

/** Balance General: filas por cuenta (grupo activo/pasivo/patrimonio) + totales. */
export function csvBalanceGeneral(balance) {
  const headers = ['grupo', 'codigo', 'nombre', 'debito', 'credito', 'saldo'];
  const b = balance || {};
  const filas = [
    ...(b.activo || []).map((c) => GRUPO_ROW('activo', c)),
    ...(b.pasivo || []).map((c) => GRUPO_ROW('pasivo', c)),
    ...(b.patrimonio || []).map((c) => GRUPO_ROW('patrimonio', c)),
    TOTAL_ROW('Total activo', b.totalActivo),
    TOTAL_ROW('Total pasivo', b.totalPasivo),
    TOTAL_ROW('Total patrimonio', b.totalPatrimonio),
    TOTAL_ROW('Resultado del ejercicio', b.resultadoEjercicio),
    TOTAL_ROW('Cuadra (Activo = Pasivo + Patrimonio)', b.cuadra),
  ];
  return filasACsv(headers, filas);
}

/**
 * Hoja de trabajo de renta por cédulas + patrimonio a 31-dic (issue #130):
 * una fila por (entidad × cédula), más una fila de costos deducibles y tres
 * de patrimonio (activo/pasivo/neto) por entidad.
 */
export function csvRentaAnual(porPersona) {
  const headers = ['anio', 'entidad', 'concepto', 'monto'];
  const filas = [];
  for (const p of porPersona || []) {
    for (const c of p.cedulas || []) filas.push([p.anio, p.entidad, c.cedula, c.total]);
    filas.push([p.anio, p.entidad, 'costos_deducibles', p.costos_deducibles]);
    filas.push([p.anio, p.entidad, 'patrimonio_activo', p.patrimonio.activo]);
    filas.push([p.anio, p.entidad, 'patrimonio_pasivo', p.patrimonio.pasivo]);
    filas.push([p.anio, p.entidad, 'patrimonio_neto', p.patrimonio.neto]);
  }
  return filasACsv(headers, filas);
}
