/**
 * _lib/metas.js — Metas financieras (issue #117, Contab. familiar E, `auto-ok`).
 *
 * Módulo de metas/objetivos (Fondo de emergencia, Retiro, Educación de los
 * hijos, Pensión/ahorro voluntario de Carolina) con barra de progreso: el
 * saldo actual se calcula sumando el saldo de la(s) cuenta(s) PUC vinculadas
 * (Libro Mayor, T5) contra el `monto_objetivo` de la meta. Solo lectura sobre
 * los asientos existentes — vincular/desvincular cuentas es la única escritura
 * nueva (la meta misma), sin tocar la contabilización.
 */
import { listMetas, getMeta, insertMeta, updateMeta, entidadIdPorNombre } from './repo.js';
import { mayorCuenta } from './mayor.js';
import { formatCOP } from '../../../app/src/utils/formatters.js';

export const CATEGORIAS_META = ['emergencia', 'retiro', 'educacion', 'pension_carolina', 'otra'];

/** Metas semilla (issue #117): se crean una sola vez, si no existen ya por nombre. */
const SEMILLAS_META = [
  {
    nombre: 'Fondo de emergencia', categoria: 'emergencia', monto_objetivo: 10000000,
    notas: 'Meta semilla — ajusta el monto objetivo y vincula una cuenta de respaldo (Libro Mayor).',
  },
  {
    nombre: 'Retiro', categoria: 'retiro', monto_objetivo: 50000000,
    notas: 'Meta semilla — ajusta el monto objetivo y vincula una cuenta de respaldo (Libro Mayor).',
  },
  {
    nombre: 'Educación de los hijos', categoria: 'educacion', monto_objetivo: 30000000,
    notas: 'Meta semilla — ajusta el monto objetivo y vincula una cuenta de respaldo (Libro Mayor).',
  },
];

/**
 * Crea las metas semilla la primera vez (idempotente: si ya existe una meta
 * con ese nombre, no la duplica). Incluye la pensión/ahorro voluntario de
 * Carolina, ligada a su entidad si existe.
 */
export async function asegurarMetasSemilla(sqlArg) {
  const existentes = await listMetas({}, sqlArg);
  const nombres = new Set(existentes.map((m) => m.nombre));
  let creadas = 0;
  for (const s of SEMILLAS_META) {
    if (nombres.has(s.nombre)) continue;
    await insertMeta(s, sqlArg);
    creadas += 1;
  }
  const nombrePension = 'Pensión / ahorro voluntario de Carolina';
  if (!nombres.has(nombrePension)) {
    let entidad_id = null;
    try { entidad_id = await entidadIdPorNombre('Carolina', sqlArg); } catch (_) { /* sin entidad, meta queda sin dueño */ }
    await insertMeta({
      nombre: nombrePension, categoria: 'pension_carolina', monto_objetivo: 50000000, entidad_id,
      notas: 'Ahorro voluntario / pensión de Carolina — para construir su patrimonio.',
    }, sqlArg);
    creadas += 1;
  }
  return creadas;
}

const codigosCuentas = (meta) => String(meta.cuentas_puc || '').split(',').map((c) => c.trim()).filter(Boolean);

/**
 * Progreso de una meta dado su saldo actual (puro, testeable): % de avance
 * (topado a 100) y si ya está cumplida.
 */
export function calcularProgresoMeta(meta, saldoActual) {
  const objetivo = Number(meta.monto_objetivo) || 0;
  const saldo = Number(saldoActual) || 0;
  const pct_avance = objetivo > 0 ? Math.min(100, Math.round((saldo / objetivo) * 1000) / 10) : null;
  return { saldo_actual: saldo, monto_objetivo: objetivo, pct_avance, cumplida: objetivo > 0 && saldo >= objetivo };
}

/**
 * Saldo actual de una meta: suma el saldo (Libro Mayor) de sus cuentas PUC
 * vinculadas. Sin cuentas vinculadas, o si alguna no existe/no tiene
 * movimientos, no rompe el cálculo — simplemente no suma esa cuenta.
 */
export async function saldoActualMeta(meta, sqlArg) {
  const codigos = codigosCuentas(meta);
  if (!codigos.length) return 0;
  let total = 0;
  for (const codigo of codigos) {
    try {
      const { saldoFinal } = await mayorCuenta({ cuenta: codigo }, sqlArg);
      total += saldoFinal;
    } catch (_) { /* cuenta PUC sin fila en el plan o sin movimientos */ }
  }
  return total;
}

/** Lista de metas (con su progreso) para la pantalla PWA. Crea las semillas si aún no existen. */
export async function listarMetasConProgreso({ incluirInactivas } = {}, sqlArg) {
  await asegurarMetasSemilla(sqlArg);
  const metas = await listMetas({ soloActivas: !incluirInactivas }, sqlArg);
  const conProgreso = [];
  for (const m of metas) {
    const saldo = await saldoActualMeta(m, sqlArg);
    const progreso = calcularProgresoMeta(m, saldo);
    conProgreso.push({
      ...m,
      ...progreso,
      saldo_actual_fmt: formatCOP(progreso.saldo_actual),
      monto_objetivo_fmt: formatCOP(progreso.monto_objetivo),
    });
  }
  return { ok: true, metas: conProgreso };
}

/** Crea una meta nueva (solo owners). */
export async function crearMeta({ nombre, categoria, monto_objetivo, fecha_objetivo, cuentas_puc, entidad_id, notas }, sqlArg) {
  const nombreLimpio = String(nombre || '').trim();
  if (!nombreLimpio) throw new Error('nombre de la meta requerido');
  const objetivo = Number(monto_objetivo);
  if (!(objetivo > 0)) throw new Error('monto objetivo inválido');
  const row = await insertMeta({
    nombre: nombreLimpio,
    categoria: CATEGORIAS_META.includes(categoria) ? categoria : 'otra',
    monto_objetivo: objetivo,
    fecha_objetivo: fecha_objetivo || null,
    cuentas_puc: cuentas_puc || '',
    entidad_id: entidad_id || null,
    notas: notas || null,
  }, sqlArg);
  return { ok: true, id: row.id, mensaje: `Meta "${row.nombre}" creada ✅` };
}

/** Edita una meta existente (solo owners): monto objetivo, fecha, cuentas vinculadas, activa/inactiva. */
export async function editarMeta(id, patch, sqlArg) {
  const meta = await getMeta(id, sqlArg);
  if (!meta) throw new Error(`meta ${id} no encontrada`);
  if (patch.monto_objetivo != null && !(Number(patch.monto_objetivo) > 0)) {
    throw new Error('monto objetivo inválido');
  }
  const row = await updateMeta(id, patch, sqlArg);
  return { ok: true, id: row.id, mensaje: `Meta "${row.nombre}" actualizada ✅` };
}
