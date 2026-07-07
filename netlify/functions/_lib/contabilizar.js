/**
 * _lib/contabilizar.js — Contabilización automática (T4): cada movimiento o
 * ingreso capturado genera su asiento de partida doble, sin que quien registra
 * (SilvIA/PWA) tenga que pensar en cuentas contables.
 *
 * Dos mapeos independientes arman cada asiento:
 *   - `reglas_contables` (DB, sql/reglas-contables.sql): categoría → cuenta de
 *     gasto, cédula → cuenta de ingreso. Editable sin deploy.
 *   - `cuentaLiquidezPorMedioPago` (aquí, pura): medio de pago → cuenta de
 *     liquidez (banco/efectivo/tarjeta de crédito). Es una heurística sobre el
 *     texto libre de `metodo_pago`/`cuenta_destino` — la lista de medios de
 *     pago reales es corta y estable, así que no amerita tabla propia todavía.
 *
 * ALCANCE: solo movimientos/ingresos en **COP**. El PUC de T1 es simplificado
 * (una sola cuenta "1110 Bancos y billeteras" para todas las cuentas, sin
 * subcuenta por moneda) — sumar montos en USD y COP en la misma cuenta
 * falsearía el saldo, así que por ahora se omiten (best-effort, sin romper la
 * captura) hasta que haya un diseño de subcuentas por moneda.
 *
 * Todo lo que llama a este módulo debe tratarlo como **best-effort**: un fallo
 * aquí (regla faltante, DB caída) nunca debe impedir que el gasto/ingreso quede
 * capturado — ver el try/catch en `finanzas.js` y `handlers.js`.
 */
import { crearAsiento } from './asientos.js';
import { listReglasContables } from './repo.js';

const CUENTA_GASTO_FALLBACK = '5195';   // Otros gastos
const CUENTA_BANCO = '1110';            // Bancos y billeteras
const CUENTA_CAJA = '1105';             // Caja (efectivo)
const CUENTA_TARJETA_CREDITO = '2105';  // Tarjetas de crédito por pagar

/** Cuenta de liquidez a partir del medio de pago (puro). */
export function cuentaLiquidezPorMedioPago(metodoPago) {
  const m = String(metodoPago || '').trim();
  if (!m) return null;
  if (/^efectivo$/i.test(m)) return CUENTA_CAJA;
  if (/^tc\b/i.test(m) || /tarjeta\s+de\s+cr[eé]dito/i.test(m)) return CUENTA_TARJETA_CREDITO;
  return CUENTA_BANCO;
}

/** Busca una regla `tipo`+`criterio` en la lista cargada de la DB (puro). */
function buscarRegla(reglas, tipo, criterio) {
  const c = String(criterio || '').trim().toLowerCase();
  const r = (reglas || []).find((x) => x.tipo === tipo && String(x.criterio).trim().toLowerCase() === c);
  return r ? r.cuenta : null;
}

/**
 * Arma las 2 líneas de un gasto/pago/factura (puro). `null` si no se puede
 * contabilizar (moneda distinta de COP o sin medio de pago resuelto).
 */
export function lineasGasto(mov, reglas) {
  if (String(mov.moneda || 'COP').toUpperCase() !== 'COP') return null;
  const monto = Number(mov.monto) || 0;
  if (monto <= 0) return null;
  const cuentaGasto = buscarRegla(reglas, 'categoria', mov.categoria) || CUENTA_GASTO_FALLBACK;
  const cuentaLiquidez = cuentaLiquidezPorMedioPago(mov.metodo_pago);
  if (!cuentaLiquidez) return null;
  return [
    { cuenta: cuentaGasto, debito: monto, credito: 0, movimiento_id: mov.id },
    { cuenta: cuentaLiquidez, debito: 0, credito: monto, movimiento_id: mov.id },
  ];
}

/** Arma las 2 líneas de una transferencia entre cuentas propias (puro). */
export function lineasTransferencia(mov) {
  if (String(mov.moneda || 'COP').toUpperCase() !== 'COP') return null;
  const monto = Number(mov.monto) || 0;
  if (monto <= 0) return null;
  const destino = cuentaLiquidezPorMedioPago(mov.cuenta_destino);
  const origen = cuentaLiquidezPorMedioPago(mov.metodo_pago);
  if (!destino || !origen || destino === origen) return null; // no arma un "asiento" de una sola cuenta
  return [
    { cuenta: destino, debito: monto, credito: 0, movimiento_id: mov.id },
    { cuenta: origen, debito: 0, credito: monto, movimiento_id: mov.id },
  ];
}

/**
 * Arma las 2 líneas de un ingreso (puro). `null` si la cédula no tiene regla
 * (se omite en vez de adivinar una cuenta de ingreso incorrecta).
 */
export function lineasIngreso(ing, reglas) {
  if (String(ing.moneda || 'COP').toUpperCase() !== 'COP') return null;
  const monto = Number(ing.monto) || 0;
  if (monto <= 0) return null;
  const cuentaIngreso = buscarRegla(reglas, 'cedula', ing.cedula);
  if (!cuentaIngreso) return null;
  return [
    { cuenta: CUENTA_BANCO, debito: monto, credito: 0, ingreso_id: ing.id },
    { cuenta: cuentaIngreso, debito: 0, credito: monto, ingreso_id: ing.id },
  ];
}

/**
 * Contabiliza un movimiento ya guardado (gasto/pago/factura/transferencia).
 * Idempotente por `movimiento_id` (una sola vez por fila). Nunca lanza por
 * "no se pudo contabilizar" — devuelve `{ok:true, omitido:true, motivo}`; solo
 * lanza si la propia escritura del asiento falla (lo atrapa el llamador).
 */
export async function contabilizarMovimiento(mov, sqlArg) {
  const reglas = await listReglasContables(sqlArg);
  const lineas = mov.tipo === 'transferencia' ? lineasTransferencia(mov) : lineasGasto(mov, reglas);
  if (!lineas) return { ok: true, omitido: true, motivo: 'sin regla o moneda no soportada' };
  return crearAsiento({
    fecha: mov.fecha, descripcion: mov.descripcion, origen: 'automatico',
    lineas, idempotency_key: `contable:movimiento:${mov.id}`,
  }, sqlArg);
}

/** Contabiliza un ingreso ya guardado. Idempotente por `ingreso_id`. */
export async function contabilizarIngreso(ing, sqlArg) {
  const reglas = await listReglasContables(sqlArg);
  const lineas = lineasIngreso(ing, reglas);
  if (!lineas) return { ok: true, omitido: true, motivo: 'sin regla o moneda no soportada' };
  return crearAsiento({
    fecha: ing.fecha, descripcion: ing.concepto || `Ingreso #${ing.id}`, entidad_id: ing.entidad_id,
    origen: 'automatico', lineas, idempotency_key: `contable:ingreso:${ing.id}`,
  }, sqlArg);
}
