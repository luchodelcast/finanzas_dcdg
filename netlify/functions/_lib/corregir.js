/**
 * _lib/corregir.js — Corrección de movimientos ya registrados: **anular**
 * (borrado suave) y **recategorizar**, con su **reverso contable** para que el
 * libro de partida doble quede consistente.
 *
 * SilvIA y la captura solo saben AGREGAR; esto permite CORREGIR sin destruir
 * datos: el movimiento se marca `anulado` (no se borra la fila) y su asiento se
 * neutraliza con un asiento espejo (débitos↔créditos), auditable. Recategorizar
 * = reversar el asiento actual + actualizar campos + volver a contabilizar con
 * una nueva versión de llave idempotente.
 */
import {
  getMovimiento, anularMovimiento, updateMovimientoCampos, getAsientoByKey,
  ensureCorreccionSchema, listReglasContables, entidadIdPorNombre,
} from './repo.js';
import { crearAsiento } from './asientos.js';
import { indexarReglas, buildLineasMovimiento } from './contabilizar.js';

const iso = (d) => String(d || '').slice(0, 10);
/** Llave del asiento automático vigente de un movimiento según su versión. */
export const activeKey = (id, ver) => (Number(ver) > 1 ? `auto:mov:${id}:v${ver}` : `auto:mov:${id}`);

/** Invierte los renglones (débito↔crédito) para neutralizar un asiento. */
export function reversarLineas(lineas) {
  return (lineas || []).map((l) => ({
    cuenta: l.cuenta, debito: Number(l.credito) || 0, credito: Number(l.debito) || 0,
  }));
}

/** Crea el asiento espejo del asiento vigente del movimiento (idempotente). */
async function reversarAsiento(mov, ver, sqlArg) {
  const a = await getAsientoByKey(activeKey(mov.id, ver), sqlArg);
  if (!a || !Array.isArray(a.lineas) || a.lineas.length < 2) return null; // no había asiento: nada que reversar
  return crearAsiento({
    fecha: iso(mov.fecha),
    descripcion: `Reverso: ${mov.descripcion || ('Movimiento #' + mov.id)}`.slice(0, 200),
    entidad_id: a.entidad_id || null,
    origen: 'reverso',
    lineas: reversarLineas(a.lineas),
    idempotency_key: `rev:mov:${mov.id}:v${ver}`,
  }, sqlArg);
}

/** Anula un movimiento (borrado suave) y reversa su asiento. Idempotente. */
export async function anularMovimientoCompleto(id, motivo, sqlArg) {
  await ensureCorreccionSchema(sqlArg);
  const mov = await getMovimiento(id, sqlArg);
  if (!mov) throw Object.assign(new Error('Movimiento no encontrado'), { status: 404 });
  if (mov.anulado) return { ok: true, id, ya_anulado: true, mensaje: 'Ese movimiento ya estaba anulado.' };
  const ver = Number(mov.contab_version) || 1;
  try { await reversarAsiento(mov, ver, sqlArg); } catch (_) { /* best-effort: no bloquear la anulación */ }
  const row = await anularMovimiento(id, motivo, sqlArg);
  return { ok: true, id, anulado: true, movimiento: row, mensaje: `Movimiento #${id} anulado ✅` };
}

/** Recategoriza un movimiento: reversa el asiento actual, actualiza y recontabiliza. */
export async function recategorizarMovimiento(id, campos, sqlArg) {
  await ensureCorreccionSchema(sqlArg);
  const mov = await getMovimiento(id, sqlArg);
  if (!mov) throw Object.assign(new Error('Movimiento no encontrado'), { status: 404 });
  if (mov.anulado) throw Object.assign(new Error('No se puede recategorizar un movimiento anulado.'), { status: 409 });
  const ver = Number(mov.contab_version) || 1;
  try { await reversarAsiento(mov, ver, sqlArg); } catch (_) { /* best-effort */ }
  const nver = ver + 1;
  const row = await updateMovimientoCampos(id, {
    tipo: campos.tipo, categoria: campos.categoria, subcategoria: campos.subcategoria,
    descripcion: campos.descripcion, contab_version: nver,
  }, sqlArg);
  // Re-contabiliza con la nueva versión (best-effort, igual que la captura: si el
  // nuevo tipo/categoría no mapea a una regla, queda actualizado sin asiento).
  try {
    const reglas = indexarReglas(await listReglasContables(sqlArg));
    const lineas = buildLineasMovimiento(row, reglas);
    const entidad_id = await entidadIdPorNombre(row.quien_pago, sqlArg);
    await crearAsiento({
      fecha: iso(row.fecha), descripcion: row.descripcion || `Movimiento #${id}`,
      entidad_id, origen: 'automatico', lineas, idempotency_key: activeKey(id, nver),
    }, sqlArg);
  } catch (_) { /* sin regla para el nuevo tipo → sin asiento, no bloquea */ }
  return { ok: true, id, movimiento: row, mensaje: `Movimiento #${id} recategorizado ✅` };
}
