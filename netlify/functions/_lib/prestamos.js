/**
 * _lib/prestamos.js — Préstamos entre Luis y Carolina (issue #77, Nocturno 6/7;
 * partida doble en issue #116, Contab. familiar D).
 *
 * Un préstamo {de:'Luis', para:'Carolina', monto} significa que Carolina le
 * debe ese monto a Luis. Un abono/pago es sencillamente un registro en el
 * sentido inverso (o marcar el original como `saldado`, que lo saca del neto).
 *
 * Partida doble: un préstamo real genera un asiento cuadrado usando las
 * cuentas inter-personas del PUC (`1315` CxC a socios / `2340` CxP a socios,
 * ver PLAN_CUENTAS_EXTRA_SEED en repo.js) — sin intentar modelar de dónde
 * salió físicamente el efectivo (eso, si aplica, se captura aparte como un
 * movimiento normal). El asiento no queda atado a una sola persona
 * (`entidad_id: null`) porque representa la relación entre los dos.
 */
import {
  getPrestamo, insertPrestamo as repoInsertPrestamo, marcarPrestamoSaldado as repoMarcarPrestamoSaldado,
  insertMovimiento,
} from './repo.js';
import { crearAsiento } from './asientos.js';
import { contabilizarMovimiento } from './contabilizar.js';
import { reversarLineas } from './corregir.js';
import { derivePagoDeOtroKeys } from './idempotency.js';
import { hoyISO } from '../../../app/src/utils/formatters.js';

/** Cuentas PUC inter-personas (ver PLAN_CUENTAS_EXTRA_SEED en repo.js, issue #112). */
export const CUENTA_CXC_SOCIOS = '1315'; // Cuentas por cobrar a empresas/socios
export const CUENTA_CXP_SOCIOS = '2340'; // Cuentas por pagar a empresas/socios

const PERSONAS_VALIDAS = ['Luis', 'Carolina'];

/**
 * Calcula el saldo neto por moneda a partir de los préstamos NO saldados.
 * @returns {Array<{moneda, neto, deudor}>} deudor: 'Carolina' | 'Luis' | null (null si neto = 0)
 */
export function calcularSaldoPrestamos(prestamos) {
  const porMoneda = new Map();
  for (const p of prestamos || []) {
    if (p.saldado) continue;
    const moneda = p.moneda || 'COP';
    const monto = Number(p.monto) || 0;
    const signo = p.de === 'Luis' ? 1 : -1; // Luis→Carolina suma, Carolina→Luis resta
    porMoneda.set(moneda, (porMoneda.get(moneda) || 0) + signo * monto);
  }
  return Array.from(porMoneda.entries()).map(([moneda, neto]) => ({
    moneda,
    neto: Math.abs(neto),
    deudor: neto > 0 ? 'Carolina' : neto < 0 ? 'Luis' : null,
  }));
}

/**
 * Arma las líneas del asiento de un préstamo (puro). Débito `1315` (quien
 * presta queda con una cuenta por cobrar) / crédito `2340` (quien recibe
 * queda con una cuenta por pagar) cuando `de === 'Luis'`; en sentido inverso
 * cuando `de === 'Carolina'` — así un abono en sentido contrario nettea sobre
 * el mismo par de cuentas, igual que hace `calcularSaldoPrestamos`.
 */
export function buildLineasPrestamo(prestamo) {
  const monto = Math.abs(Number(prestamo.monto) || 0);
  if (!(monto > 0)) throw new Error('monto inválido para contabilizar el préstamo');
  if (prestamo.de === 'Luis') {
    return [
      { cuenta: CUENTA_CXC_SOCIOS, debito: monto, credito: 0 },
      { cuenta: CUENTA_CXP_SOCIOS, debito: 0, credito: monto },
    ];
  }
  return [
    { cuenta: CUENTA_CXP_SOCIOS, debito: monto, credito: 0 },
    { cuenta: CUENTA_CXC_SOCIOS, debito: 0, credito: monto },
  ];
}

/** Contabiliza un préstamo por id (idempotente). */
export async function contabilizarPrestamo(prestamoId, sqlArg) {
  const prestamo = await getPrestamo(prestamoId, sqlArg);
  if (!prestamo) throw new Error(`préstamo ${prestamoId} no encontrado`);
  const lineas = buildLineasPrestamo(prestamo);
  return crearAsiento({
    fecha: String(prestamo.fecha).slice(0, 10),
    descripcion: prestamo.concepto || `Préstamo ${prestamo.de} → ${prestamo.para} #${prestamoId}`,
    entidad_id: null,
    origen: 'automatico',
    lineas,
    idempotency_key: `auto:prestamo:${prestamoId}`,
  }, sqlArg);
}

/** Registra un préstamo y lo contabiliza (best-effort: la captura nunca se cae por un fallo al contabilizar). */
export async function registrarPrestamoConAsiento(datos, sqlArg) {
  const prestamo = await repoInsertPrestamo(datos, sqlArg);
  try { await contabilizarPrestamo(prestamo.id, sqlArg); } catch (e) { console.error('contabilizar prestamo', prestamo.id, e.message); }
  return prestamo;
}

/**
 * Asiento de ajuste al marcar/desmarcar saldado un préstamo: reversa el
 * asiento original (`saldado: true`, "se pagó") o lo vuelve a aplicar
 * (`saldado: false`, "se reabrió"). Versionado con `contab_version` (lo
 * incrementa `marcarPrestamoSaldado` en cada transición real) para que
 * alternar el estado varias veces siga siendo idempotente y consistente con
 * el neto de `calcularSaldoPrestamos`.
 */
export async function contabilizarSaldoPrestamo(prestamo, sqlArg) {
  const lineas = buildLineasPrestamo(prestamo);
  const version = Number(prestamo.contab_version) || 1;
  return crearAsiento({
    fecha: String(prestamo.fecha).slice(0, 10),
    descripcion: `${prestamo.saldado ? 'Saldado' : 'Reapertura'}: préstamo #${prestamo.id}`,
    entidad_id: null,
    origen: 'reverso',
    lineas: prestamo.saldado ? reversarLineas(lineas) : lineas,
    idempotency_key: `prestamo:${prestamo.id}:saldo:v${version}`,
  }, sqlArg);
}

/** Marca (o desmarca) saldado un préstamo y ajusta el asiento (best-effort). */
export async function marcarSaldadoConAsiento(id, saldado, sqlArg) {
  const prev = await getPrestamo(id, sqlArg);
  if (!prev) return null;
  const target = !!saldado;
  const yaEstaba = !!prev.saldado; // capturado ANTES de actualizar: la fila de `prev` podría mutarse in-place
  const actualizado = await repoMarcarPrestamoSaldado(id, target, sqlArg);
  if (yaEstaba === target) return actualizado; // sin transición: nada que contabilizar
  try { await contabilizarSaldoPrestamo(actualizado, sqlArg); } catch (e) { console.error('contabilizar saldo prestamo', id, e.message); }
  return actualizado;
}

/**
 * "Pagar con mi plata algo del otro" (issue #116): en un solo toque, registra
 * el pago (un movimiento normal atribuido al deudor, pagado con la cuenta del
 * pagador) y el préstamo correspondiente (el pagador le presta al deudor el
 * monto pagado), ambos contabilizados. Idempotente: reintentar con los mismos
 * datos no duplica ni el pago ni el préstamo.
 */
export async function registrarPagoDeOtro({
  fecha, pagador, deudor, monto, categoria, subcategoria, metodo_pago, concepto, moneda, notas, idempotency_key,
}, sqlArg) {
  if (!PERSONAS_VALIDAS.includes(pagador) || !PERSONAS_VALIDAS.includes(deudor)) {
    throw new Error('"pagador" y "deudor" deben ser "Luis" o "Carolina".');
  }
  if (pagador === deudor) throw new Error('"pagador" y "deudor" no pueden ser la misma persona.');
  const montoNum = Number(monto);
  if (!(montoNum > 0)) throw new Error('El monto debe ser mayor a 0.');
  if (!String(metodo_pago || '').trim()) throw new Error('metodo_pago requerido (la cuenta con la que pagó el pagador).');

  const f = String(fecha || '').slice(0, 10) || hoyISO();
  const desc = String(concepto || '').trim() || `${pagador} pagó por ${deudor}`;
  const keys = derivePagoDeOtroKeys({ pagador, deudor, fecha: f, monto: montoNum, concepto: desc, idempotency_key });

  const { inserted, row: movimiento } = await insertMovimiento({
    fecha: f, tipo: 'pago', categoria: categoria || 'Imprevistos', subcategoria: subcategoria || 'Otros',
    descripcion: desc, monto: montoNum, moneda: moneda || 'COP',
    metodo_pago, quien_pago: deudor, tarjeta: null, notas: notas || null, origen: 'App',
    idempotency_key: keys.movimiento,
  }, sqlArg);
  if (inserted && movimiento) {
    try { await contabilizarMovimiento(movimiento.id, sqlArg); } catch (e) { console.error('contabilizar pago de otro', movimiento.id, e.message); }
  }

  const prestamo = await registrarPrestamoConAsiento({
    fecha: f, de: pagador, para: deudor, monto: montoNum, moneda: moneda || 'COP',
    concepto: desc, notas: notas || null, idempotency_key: keys.prestamo,
  }, sqlArg);

  return {
    ok: true, movimiento, prestamo, ya_existia: !inserted,
    mensaje: inserted
      ? `Pago registrado ✅ ${pagador} le prestó ${montoNum.toLocaleString('es-CO')} a ${deudor}.`
      : 'Ese pago ya estaba registrado (no lo dupliqué).',
  };
}
