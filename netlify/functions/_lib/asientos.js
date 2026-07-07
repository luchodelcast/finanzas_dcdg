/**
 * _lib/asientos.js — Libro diario de partida doble (T2). Crear un asiento
 * cuadrado (Σ débito = Σ crédito) contra el plan de cuentas.
 *
 * La validación (`validarAsiento`) es pura y testeable; `crearAsiento` orquesta
 * la validación + el guardado idempotente (cabecera + renglones).
 */
import { listPlanCuentas, insertAsiento, insertAsientoLineas } from './repo.js';

/** Pesos → “centavos” enteros, para comparar sin errores de punto flotante. */
const cents = (n) => Math.round((Number(n) || 0) * 100);

/**
 * Valida un asiento (puro): cuentas existentes, montos ≥ 0, un solo lado por
 * renglón (débito O crédito), y que **cuadre** (Σ débito = Σ crédito).
 * @param {Array<{cuenta, debito?, credito?}>} lineas
 * @param {Set<string>} [cuentasValidas] códigos del plan de cuentas
 * @returns {{ok: boolean, error?: string, totalDebito?: number, totalCredito?: number}}
 */
export function validarAsiento(lineas, cuentasValidas) {
  if (!Array.isArray(lineas) || lineas.length < 2) {
    return { ok: false, error: 'Un asiento requiere al menos 2 renglones (un débito y un crédito).' };
  }
  let d = 0; let c = 0;
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i] || {};
    const cuenta = String(l.cuenta || '').trim();
    if (!cuenta) return { ok: false, error: `Renglón ${i + 1}: falta la cuenta.` };
    if (cuentasValidas && !cuentasValidas.has(cuenta)) {
      return { ok: false, error: `Renglón ${i + 1}: la cuenta "${cuenta}" no existe en el plan de cuentas.` };
    }
    const debito = cents(l.debito);
    const credito = cents(l.credito);
    if (debito < 0 || credito < 0) return { ok: false, error: `Renglón ${i + 1}: los montos no pueden ser negativos.` };
    if ((debito > 0) === (credito > 0)) {
      return { ok: false, error: `Renglón ${i + 1}: cada renglón debe tener débito O crédito (exactamente uno).` };
    }
    d += debito; c += credito;
  }
  if (d !== c) {
    return { ok: false, error: `El asiento no cuadra: débito ${(d / 100).toFixed(2)} ≠ crédito ${(c / 100).toFixed(2)}.` };
  }
  return { ok: true, totalDebito: d / 100, totalCredito: c / 100 };
}

/** Llave idempotente determinística si no se provee una explícita. */
function deriveAsientoKey({ fecha, origen, descripcion, lineas }) {
  const firma = lineas.map((l) => `${l.cuenta}:${cents(l.debito)}:${cents(l.credito)}`).join('|');
  return `asiento:${fecha}:${origen || 'manual'}:${(descripcion || '').slice(0, 40)}:${firma}`.slice(0, 250);
}

/**
 * Crea un asiento validado y cuadrado. Idempotente por idempotency_key.
 * @returns {Promise<{ok, registrado, ya_existia?, id, total?, mensaje}>}
 */
export async function crearAsiento({ fecha, descripcion, entidad_id, origen = 'manual', lineas, idempotency_key }, sqlArg) {
  if (!fecha) throw new Error('fecha requerida');
  const cuentas = await listPlanCuentas({}, sqlArg);
  const set = new Set(cuentas.map((c) => c.codigo));
  const v = validarAsiento(lineas, set);
  if (!v.ok) throw new Error(v.error);

  const key = idempotency_key || deriveAsientoKey({ fecha, origen, descripcion, lineas });
  const { inserted, row } = await insertAsiento({ fecha, descripcion, entidad_id, origen, idempotency_key: key }, sqlArg);
  if (!inserted) {
    return { ok: true, registrado: false, ya_existia: true, id: row && row.id, mensaje: 'Ese asiento ya estaba registrado (no se duplicó).' };
  }
  await insertAsientoLineas(row.id, lineas, sqlArg);
  return {
    ok: true, registrado: true, id: row.id, total: v.totalDebito,
    mensaje: `Asiento #${row.id} registrado ✅ (cuadra en ${v.totalDebito.toLocaleString('es-CO')}).`,
  };
}
