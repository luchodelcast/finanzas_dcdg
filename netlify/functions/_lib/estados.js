/**
 * _lib/estados.js — Estado de Resultados (T6) y Balance General (T7),
 * derivados del Balance de Comprobación (T5) — solo lectura, sin esquema nuevo.
 */
import { balanceComprobacion } from './mayor.js';

/** Pesos → "centavos" enteros, mismo criterio que mayor.js/asientos.js. */
const cents = (n) => Math.round((Number(n) || 0) * 100);

/**
 * Estado de Resultados (puro): ingresos (clase 4) − gastos (clase 5) − costos
 * (clase 6), a partir de las cuentas ya agregadas del Balance de Comprobación.
 * @param {Array<{codigo,nombre,clase,naturaleza,saldo}>} cuentas
 */
export function construirEstadoResultados(cuentas) {
  const ingresos = []; const gastos = []; const costos = [];
  let totalIngresos = 0; let totalGastos = 0; let totalCostos = 0;
  for (const c of cuentas || []) {
    const saldo = cents(c.saldo);
    if (c.clase === 4) { ingresos.push(c); totalIngresos += saldo; }
    else if (c.clase === 5) { gastos.push(c); totalGastos += saldo; }
    else if (c.clase === 6) { costos.push(c); totalCostos += saldo; }
  }
  const resultado = totalIngresos - totalGastos - totalCostos;
  return {
    ingresos, gastos, costos,
    totalIngresos: totalIngresos / 100,
    totalGastos: totalGastos / 100,
    totalCostos: totalCostos / 100,
    resultado: resultado / 100,
  };
}

/** Estado de Resultados de un periodo: agrega el comprobante (T5) y clasifica clases 4/5/6. */
export async function estadoResultados({ desde, hasta, entidad_id, soloSinEntidad }, sqlArg) {
  const { cuentas } = await balanceComprobacion({ desde, hasta, entidad_id, soloSinEntidad }, sqlArg);
  return construirEstadoResultados(cuentas);
}

/**
 * Balance General (puro): Activo (1) = Pasivo (2) + Patrimonio (3) a una fecha.
 * `resultadoEjercicio` (utilidad/pérdida del periodo corrido hasta la fecha,
 * de `construirEstadoResultados`) se suma al patrimonio — antes del cierre
 * mensual (T12) el resultado del periodo vive en las cuentas de resultado
 * (4/5/6), no en patrimonio, así que sin sumarlo la ecuación nunca cuadraría
 * mientras haya movimiento de ingresos/gastos sin cerrar.
 */
export function construirBalanceGeneral(cuentas, resultadoEjercicio = 0) {
  const activo = []; const pasivo = []; const patrimonio = [];
  let totalActivo = 0; let totalPasivo = 0; let totalPatrimonio = 0;
  for (const c of cuentas || []) {
    const saldo = cents(c.saldo);
    if (c.clase === 1) { activo.push(c); totalActivo += saldo; }
    else if (c.clase === 2) { pasivo.push(c); totalPasivo += saldo; }
    else if (c.clase === 3) { patrimonio.push(c); totalPatrimonio += saldo; }
  }
  const resultado = cents(resultadoEjercicio);
  const totalPatrimonioConResultado = totalPatrimonio + resultado;
  return {
    activo, pasivo, patrimonio,
    resultadoEjercicio: resultado / 100,
    totalActivo: totalActivo / 100,
    totalPasivo: totalPasivo / 100,
    totalPatrimonio: totalPatrimonioConResultado / 100,
    cuadra: totalActivo === totalPasivo + totalPatrimonioConResultado,
  };
}

/**
 * Balance General a una fecha: comprobante acumulado (sin `desde`) + resultado
 * del periodo. `soloSinEntidad` filtra los asientos sin dueño individual
 * (bolsillo "Común", #115) — tiene prioridad sobre `entidad_id` si ambos llegan.
 */
export async function balanceGeneral({ fecha, entidad_id, soloSinEntidad }, sqlArg) {
  const { cuentas } = await balanceComprobacion({ hasta: fecha, entidad_id, soloSinEntidad }, sqlArg);
  const { resultado } = construirEstadoResultados(cuentas);
  return construirBalanceGeneral(cuentas, resultado);
}
