/**
 * _lib/asientos.js — Libro diario (asientos de partida doble). T2 del sprint
 * contable (ver docs/plan-partida-doble-jul2026.md). Depende de `plan_cuentas`
 * (T1): cada línea debe referenciar un código ya sembrado en ese catálogo.
 *
 * Invariante que protege este módulo: Σdébito = Σcrédito por asiento. No es un
 * constraint de la DB (el asiento se inserta en dos pasos: cabecera + líneas),
 * así que se valida aquí ANTES de escribir nada.
 */

import { insertAsiento, insertAsientoLineas, getPlanCuenta } from './repo.js';
import { deriveAsientoKey } from './idempotency.js';

const ORIGENES = new Set(['apertura', 'automatico', 'manual', 'ajuste']);

/** Redondea a 2 decimales para comparar sumas sin ruido de punto flotante. */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Crea un asiento validando que cuadre (Σdébito = Σcrédito) y que cada cuenta
 * exista en el plan de cuentas. Idempotente por `idempotency_key` (derivada si
 * no se provee): un reintento con la misma llave devuelve el asiento existente
 * sin insertar de nuevo.
 *
 * @param {Object} a
 * @param {string} a.fecha         YYYY-MM-DD
 * @param {string} a.descripcion
 * @param {number} [a.entidad_id]
 * @param {string} [a.origen]      apertura | automatico | manual | ajuste (default: manual)
 * @param {Array<{cuenta:string, debito?:number, credito?:number, tercero_id?:number,
 *                movimiento_id?:number, ingreso_id?:number}>} a.lineas
 * @param {string} [a.idempotency_key]
 * @returns {Promise<{ inserted: boolean, asiento: object, lineas: object[] }>}
 */
export async function crearAsiento(a = {}) {
  const fecha = String(a.fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('fecha inválida (YYYY-MM-DD)');
  const descripcion = String(a.descripcion || '').trim();
  if (!descripcion) throw new Error('descripcion requerida');
  const origen = String(a.origen || 'manual').toLowerCase();
  if (!ORIGENES.has(origen)) throw new Error(`origen inválido: "${a.origen}". Usa apertura | automatico | manual | ajuste.`);

  const lineas = a.lineas || [];
  if (lineas.length < 2) throw new Error('un asiento necesita al menos 2 líneas');

  let sumaDebito = 0;
  let sumaCredito = 0;
  for (const l of lineas) {
    const codigo = String(l.cuenta || '').trim();
    if (!codigo) throw new Error('cada línea requiere una cuenta');
    const debito = round2(l.debito);
    const credito = round2(l.credito);
    if (debito < 0 || credito < 0) throw new Error(`línea de la cuenta ${codigo}: débito/crédito no pueden ser negativos`);
    if (debito > 0 && credito > 0) throw new Error(`línea de la cuenta ${codigo}: no puede tener débito y crédito a la vez`);
    if (debito === 0 && credito === 0) throw new Error(`línea de la cuenta ${codigo}: debe tener débito o crédito`);
    const cuenta = await getPlanCuenta(codigo);
    if (!cuenta) throw new Error(`la cuenta "${codigo}" no existe en el plan de cuentas`);
    if (cuenta.activo === false) throw new Error(`la cuenta "${codigo}" está inactiva`);
    sumaDebito += debito;
    sumaCredito += credito;
  }
  sumaDebito = round2(sumaDebito);
  sumaCredito = round2(sumaCredito);
  if (sumaDebito !== sumaCredito) {
    throw new Error(`el asiento no cuadra: débito ${sumaDebito} ≠ crédito ${sumaCredito}`);
  }

  const idempotency_key = deriveAsientoKey({ ...a, fecha, descripcion, origen });
  const { inserted, row: asiento } = await insertAsiento({
    fecha, descripcion, entidad_id: a.entidad_id || null, origen,
    estado: a.estado, estado_conciliacion: a.estado_conciliacion, idempotency_key,
  });

  if (!inserted) {
    return { inserted: false, asiento, lineas: [] };
  }

  const lineasIns = await insertAsientoLineas(asiento.id, lineas);
  return { inserted: true, asiento, lineas: lineasIns };
}
