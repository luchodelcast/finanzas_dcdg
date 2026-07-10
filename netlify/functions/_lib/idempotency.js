/**
 * _lib/idempotency.js — Llave de idempotencia de un movimiento.
 *
 * Identifica el MISMO evento de forma determinística para que la restricción
 * UNIQUE de la DB rechace reintentos y escrituras en carrera. Es fuente-agnóstica
 * (no incluye el origen) para que un mismo gasto reportado dos veces —o el
 * reintento de red de una misma petición— colapse en una sola fila.
 *
 * Si el llamador provee su propio id de evento (p. ej. el id del mensaje de
 * WhatsApp), se respeta: es la señal más fuerte de "esto es lo mismo".
 */

import { createHash } from 'node:crypto';
import { normalize } from '../../../app/src/config/rules.js';

/**
 * @param {{ tipo?: string, fecha: string, monto: number, descripcion: string,
 *           source_msg_id?: string, idempotency_key?: string }} mov
 * @returns {string} llave estable de 40 hex.
 */
export function deriveIdempotencyKey(mov = {}) {
  if (mov.idempotency_key) return String(mov.idempotency_key).slice(0, 80);
  if (mov.source_msg_id) return 'msg:' + String(mov.source_msg_id).slice(0, 74);

  const tipo = String(mov.tipo || 'gasto').toLowerCase();
  const fecha = String(mov.fecha || '').slice(0, 10);
  const monto = Math.round(Number(mov.monto) || 0);
  const desc = normalize(mov.descripcion).slice(0, 16);
  const base = `${tipo}|${fecha}|${monto}|${desc}`;
  return createHash('sha256').update(base).digest('hex').slice(0, 40);
}

/**
 * Llave de idempotencia de un INGRESO (entidad + fecha + monto + concepto + cédula).
 * @param {{ entidad_id, fecha, monto, concepto?, cedula?, idempotency_key? }} i
 * @returns {string}
 */
export function deriveIngresoKey(i = {}) {
  if (i.idempotency_key) return String(i.idempotency_key).slice(0, 80);
  const fecha = String(i.fecha || '').slice(0, 10);
  const monto = Math.round(Number(i.monto) || 0);
  const concepto = normalize(i.concepto).slice(0, 16);
  const base = `ing|${i.entidad_id}|${fecha}|${monto}|${concepto}|${i.cedula || ''}`;
  return createHash('sha256').update(base).digest('hex').slice(0, 40);
}

/**
 * Llave de idempotencia de un COSTO de actividad económica (issue #154,
 * p.ej. Ahinoa: tejedoras, proveedores).
 * @param {{ entidad_id, fecha, monto, concepto?, idempotency_key? }} c
 * @returns {string}
 */
export function deriveCostoActividadKey(c = {}) {
  if (c.idempotency_key) return String(c.idempotency_key).slice(0, 80);
  const fecha = String(c.fecha || '').slice(0, 10);
  const monto = Math.round(Number(c.monto) || 0);
  const concepto = normalize(c.concepto).slice(0, 16);
  const base = `costo|${c.entidad_id}|${fecha}|${monto}|${concepto}`;
  return createHash('sha256').update(base).digest('hex').slice(0, 40);
}

/**
 * Llave de idempotencia de un APORTE al fondo común del hogar (issue #113).
 * @param {{ entidad_id, fecha, monto, metodo_pago?, idempotency_key? }} a
 * @returns {string}
 */
export function deriveAporteHogarKey(a = {}) {
  if (a.idempotency_key) return String(a.idempotency_key).slice(0, 80);
  const fecha = String(a.fecha || '').slice(0, 10);
  const monto = Math.round(Number(a.monto) || 0);
  const metodo = normalize(a.metodo_pago).slice(0, 16);
  const base = `aporte|${a.entidad_id}|${fecha}|${monto}|${metodo}`;
  return createHash('sha256').update(base).digest('hex').slice(0, 40);
}

/**
 * Llave de idempotencia del flujo "pagar deuda del otro" (issue #116, Contab.
 * familiar D). Deriva DOS llaves distintas (una para el movimiento del pago,
 * otra para el préstamo que genera) a partir de los mismos datos, para que un
 * reintento de la misma operación no duplique ni el pago ni el préstamo.
 * @param {{ pagador, deudor, fecha, monto, concepto?, idempotency_key? }} p
 * @returns {{ movimiento: string, prestamo: string }}
 */
export function derivePagoDeOtroKeys(p = {}) {
  const fecha = String(p.fecha || '').slice(0, 10);
  const monto = Math.round(Number(p.monto) || 0);
  const concepto = normalize(p.concepto).slice(0, 16);
  const base = p.idempotency_key
    ? String(p.idempotency_key).slice(0, 60)
    : `${p.pagador}|${p.deudor}|${fecha}|${monto}|${concepto}`;
  return {
    movimiento: createHash('sha256').update(`pagootro:mov|${base}`).digest('hex').slice(0, 40),
    prestamo: createHash('sha256').update(`pagootro:prestamo|${base}`).digest('hex').slice(0, 40),
  };
}
