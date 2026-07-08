/**
 * _lib/contabilizar.js — Contabilización automática (T4). Convierte cada
 * movimiento/ingreso capturado en un asiento de partida doble balanceado,
 * usando las reglas de mapeo (categoría/cédula/medio → cuenta PUC).
 *
 * El mapeo (`buildLineasMovimiento` / `buildLineasIngreso`) es puro y testeable.
 * `contabilizarMovimiento` / `contabilizarIngreso` orquestan: buscan la fila,
 * arman las líneas y guardan el asiento (idempotente: uno por movimiento/ingreso).
 */
import {
  getMovimiento, getIngreso, listReglasContables, entidadIdPorNombre,
} from './repo.js';
import { crearAsiento } from './asientos.js';

/** Índice de reglas → Map('ambito:clave' → cuenta). */
export function indexarReglas(rows) {
  const m = new Map();
  for (const r of rows || []) m.set(`${r.ambito}:${String(r.clave).toLowerCase()}`, r.cuenta);
  return m;
}

function cuentaPara(reglas, ambito, clave) {
  const k = String(clave || '').toLowerCase().trim();
  return reglas.get(`${ambito}:${k}`) || reglas.get(`${ambito}:default`) || null;
}

/** Medio de pago (texto libre) → cuenta de activo/pasivo. */
function cuentaMedio(reglas, metodo) {
  const m = String(metodo || '').toLowerCase();
  if (/efectivo|cash/.test(m)) return cuentaPara(reglas, 'medio', 'efectivo');
  if (/cr[eé]dito|\btc\b/.test(m)) return cuentaPara(reglas, 'medio', 'tarjeta credito');
  return cuentaPara(reglas, 'medio', 'default');
}

/** Arma los renglones del asiento de un MOVIMIENTO (puro). */
export function buildLineasMovimiento(mov, reglas) {
  const monto = Math.abs(Number(mov.monto) || 0);
  if (!(monto > 0)) throw new Error('monto inválido para contabilizar');
  if (mov.tipo === 'transferencia') {
    const origen = cuentaMedio(reglas, mov.metodo_pago);
    const destino = cuentaMedio(reglas, mov.cuenta_destino);
    if (!origen || !destino) throw new Error('faltan cuentas de medio para la transferencia');
    return [
      { cuenta: destino, debito: monto, credito: 0, movimiento_id: mov.id },
      { cuenta: origen, debito: 0, credito: monto, movimiento_id: mov.id },
    ];
  }
  // gasto | pago | factura → débito gasto (por categoría) / crédito medio de pago.
  const gasto = cuentaPara(reglas, 'categoria', mov.categoria);
  const medio = cuentaMedio(reglas, mov.metodo_pago);
  if (!gasto || !medio) throw new Error('faltan reglas de cuenta para el movimiento');
  return [
    { cuenta: gasto, debito: monto, credito: 0, movimiento_id: mov.id },
    { cuenta: medio, debito: 0, credito: monto, movimiento_id: mov.id },
  ];
}

/** Arma los renglones del asiento de un INGRESO (puro). */
export function buildLineasIngreso(ing, reglas) {
  const monto = Math.abs(Number(ing.monto) || 0);
  if (!(monto > 0)) throw new Error('monto inválido para contabilizar');
  const ingreso = cuentaPara(reglas, 'cedula', ing.cedula);
  const medio = cuentaMedio(reglas, ing.medio); // los ingresos no traen nombre de cuenta → 'default' (bancos)
  if (!ingreso || !medio) throw new Error('faltan reglas de cuenta para el ingreso');
  return [
    { cuenta: medio, debito: monto, credito: 0, ingreso_id: ing.id },
    { cuenta: ingreso, debito: 0, credito: monto, ingreso_id: ing.id },
  ];
}

/** Contabiliza un movimiento por id (idempotente). Devuelve el resultado de crearAsiento. */
export async function contabilizarMovimiento(movId, sqlArg) {
  const mov = await getMovimiento(movId, sqlArg);
  if (!mov) throw new Error(`movimiento ${movId} no encontrado`);
  const reglas = indexarReglas(await listReglasContables(sqlArg));
  const lineas = buildLineasMovimiento(mov, reglas);
  const entidad_id = await entidadIdPorNombre(mov.quien_pago, sqlArg);
  return crearAsiento({
    fecha: String(mov.fecha).slice(0, 10), descripcion: mov.descripcion || `Movimiento #${movId}`,
    entidad_id, origen: 'automatico', lineas, idempotency_key: `auto:mov:${movId}`,
  }, sqlArg);
}

/** Contabiliza un ingreso por id (idempotente). */
export async function contabilizarIngreso(ingId, sqlArg) {
  const ing = await getIngreso(ingId, sqlArg);
  if (!ing) throw new Error(`ingreso ${ingId} no encontrado`);
  const reglas = indexarReglas(await listReglasContables(sqlArg));
  const lineas = buildLineasIngreso(ing, reglas);
  return crearAsiento({
    fecha: String(ing.fecha).slice(0, 10), descripcion: ing.concepto || `Ingreso #${ingId}`,
    entidad_id: ing.entidad_id || null, origen: 'automatico', lineas, idempotency_key: `auto:ing:${ingId}`,
  }, sqlArg);
}
