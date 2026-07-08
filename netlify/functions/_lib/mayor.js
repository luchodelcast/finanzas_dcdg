/**
 * _lib/mayor.js — Libro Mayor + Balance de Comprobación (T5), derivados del
 * libro diario (T2). Cierra la Semana 1 del motor contable: son la base de
 * los estados financieros (T6/T7) — solo lectura, sin esquema nuevo.
 */
import { queryLineasCuenta, queryComprobacion, getPlanCuenta } from './repo.js';

/** Pesos → “centavos” enteros, mismo criterio que asientos.js para cuadrar sin ruido de punto flotante. */
const cents = (n) => Math.round((Number(n) || 0) * 100);

/** Saldo de un renglón según la naturaleza de la cuenta (qué lado la aumenta). */
function saldoRenglon(naturaleza, debito, credito) {
  const d = cents(debito); const c = cents(credito);
  return naturaleza === 'credito' ? c - d : d - c;
}

/**
 * Arma el Libro Mayor de una cuenta (puro): renglones con saldo corrido.
 * @param {Array<{fecha, asiento_id, descripcion, debito, credito}>} lineas ya ordenadas por fecha asc
 * @param {'debito'|'credito'} naturaleza de la cuenta
 * @returns {{lineas: Array, saldoFinal: number}}
 */
export function construirMayor(lineas, naturaleza) {
  let saldo = 0;
  const filas = (lineas || []).map((l) => {
    saldo += saldoRenglon(naturaleza, l.debito, l.credito);
    return { ...l, debito: cents(l.debito) / 100, credito: cents(l.credito) / 100, saldo: saldo / 100 };
  });
  return { lineas: filas, saldoFinal: saldo / 100 };
}

/**
 * Arma el Balance de Comprobación (puro): saldo por cuenta con movimiento,
 * y valida el cuadre Σdébito = Σcrédito.
 * @param {Array<{codigo, nombre, clase, naturaleza, debito, credito}>} filas agregadas por cuenta
 * @returns {{cuentas: Array, totalDebito: number, totalCredito: number, cuadra: boolean}}
 */
export function construirComprobacion(filas) {
  let totalDebito = 0; let totalCredito = 0;
  const cuentas = [];
  for (const f of filas || []) {
    const d = cents(f.debito); const c = cents(f.credito);
    if (d === 0 && c === 0) continue;
    totalDebito += d; totalCredito += c;
    cuentas.push({
      codigo: f.codigo, nombre: f.nombre, clase: f.clase, naturaleza: f.naturaleza,
      debito: d / 100, credito: c / 100, saldo: saldoRenglon(f.naturaleza, f.debito, f.credito) / 100,
    });
  }
  return { cuentas, totalDebito: totalDebito / 100, totalCredito: totalCredito / 100, cuadra: totalDebito === totalCredito };
}

/** Libro Mayor de una cuenta: valida que exista en el plan y arma el saldo corrido. */
export async function mayorCuenta({ cuenta, desde, hasta, entidad_id }, sqlArg) {
  const codigo = String(cuenta || '').trim();
  if (!codigo) throw new Error('cuenta requerida');
  const plan = await getPlanCuenta(codigo, sqlArg);
  if (!plan) throw new Error(`La cuenta "${codigo}" no existe en el plan de cuentas.`);
  const lineas = await queryLineasCuenta({ cuenta: codigo, desde, hasta, entidad_id }, sqlArg);
  const { lineas: filas, saldoFinal } = construirMayor(lineas, plan.naturaleza);
  return { cuenta: plan, lineas: filas, saldoFinal };
}

/** Balance de Comprobación: agrega todas las cuentas con movimiento en el rango. */
export async function balanceComprobacion({ desde, hasta, entidad_id }, sqlArg) {
  const filas = await queryComprobacion({ desde, hasta, entidad_id }, sqlArg);
  return construirComprobacion(filas);
}
