/**
 * _lib/aportes-hogar.js — Fondo común del hogar (issue #113, Contab. familiar
 * A). Cada persona registra un aporte al fondo común (distinto de una
 * transferencia genérica); el reporte mensual muestra cuánto aportó cada
 * quien, su cuota proporcional sugerida (según su ingreso del periodo) y el
 * % cumplido de esa cuota.
 *
 * La cuota sugerida reparte el TOTAL aportado por la familia ese mes entre
 * las personas en proporción a su ingreso (no un objetivo externo): si Luis
 * ganó el doble que Carolina, su cuota "justa" del total aportado es el
 * doble. Sin ingresos registrados, se reparte por partes iguales.
 */
import {
  listReglasContables, listCuentasMeta, listEntidades, queryAportesBase,
  insertAporteHogar, getAporteHogar, listAportesHogarPeriodo,
} from './repo.js';
import { indexarReglas, indexarCuentasMeta, cuentaMedio } from './contabilizar.js';
import { crearAsiento } from './asientos.js';
import { rangoPeriodo } from './finanzas.js';
import { formatCOP } from '../../../app/src/utils/formatters.js';

/** Cuenta PUC del fondo común del hogar (activo, ver PLAN_CUENTAS_EXTRA_SEED en repo.js). */
export const CUENTA_FONDO_COMUN = '1115';

/** Arma las líneas del asiento de un aporte al fondo común (puro). */
export function buildLineasAporteHogar(aporte, reglas, cuentasMeta) {
  const monto = Math.abs(Number(aporte.monto) || 0);
  if (!(monto > 0)) throw new Error('monto inválido para contabilizar el aporte');
  const origen = cuentaMedio(reglas, aporte.metodo_pago, cuentasMeta);
  if (!origen) throw new Error('falta la cuenta de origen del aporte');
  return [
    { cuenta: CUENTA_FONDO_COMUN, debito: monto, credito: 0 },
    { cuenta: origen, debito: 0, credito: monto },
  ];
}

/** Contabiliza un aporte por id (idempotente). */
export async function contabilizarAporteHogar(aporteId, sqlArg) {
  const aporte = await getAporteHogar(aporteId, sqlArg);
  if (!aporte) throw new Error(`aporte ${aporteId} no encontrado`);
  const reglas = indexarReglas(await listReglasContables(sqlArg));
  const cuentasMeta = indexarCuentasMeta(await listCuentasMeta(sqlArg));
  const lineas = buildLineasAporteHogar(aporte, reglas, cuentasMeta);
  return crearAsiento({
    fecha: String(aporte.fecha).slice(0, 10),
    descripcion: aporte.notas || `Aporte al fondo común #${aporteId}`,
    entidad_id: aporte.entidad_id,
    origen: 'automatico',
    lineas,
    idempotency_key: `auto:aporte:${aporteId}`,
  }, sqlArg);
}

/**
 * Cuota proporcional (pura, testeable): reparte `totalAportado` entre las
 * `personas` según su ingreso; sin ingresos registrados, reparte por igual.
 * @param {{ personas: Array<{id, nombre}>, ingresosPorPersona: Map, aportesPorPersona: Map }} q
 */
export function calcularCuotasAporte({ personas, ingresosPorPersona, aportesPorPersona }) {
  const lista = personas || [];
  const totalIngresos = lista.reduce((s, p) => s + (ingresosPorPersona.get(p.id) || 0), 0);
  const totalAportado = lista.reduce((s, p) => s + (aportesPorPersona.get(p.id) || 0), 0);

  return lista.map((p) => {
    const ingreso = ingresosPorPersona.get(p.id) || 0;
    const aportado = aportesPorPersona.get(p.id) || 0;
    const proporcion = totalIngresos > 0 ? (ingreso / totalIngresos) : (lista.length ? 1 / lista.length : 0);
    const cuota_sugerida = totalAportado * proporcion;
    // Sin nada aportado por la familia este mes, no hay cuota que evaluar todavía.
    const pct_cumplido = totalAportado > 0
      ? (cuota_sugerida > 0 ? Math.round((aportado / cuota_sugerida) * 1000) / 10 : null)
      : null;
    return {
      entidad_id: p.id,
      entidad: p.nombre,
      ingreso,
      aportado,
      proporcion_ingreso: Math.round(proporcion * 1000) / 10, // % con 1 decimal
      cuota_sugerida,
      pct_cumplido,
    };
  });
}

/**
 * Reporte mensual de aportes al fondo común, por persona. Solo lectura.
 * @param {Object} q
 * @param {string} [q.periodo]  'mes' (def) | 'YYYY-MM' | 'YYYY-MM-DD..YYYY-MM-DD'
 * @param {Date}   [q.hoy]      fecha de referencia (inyectable para tests)
 */
export async function reporteAportesHogar(q = {}) {
  const hoy = q.hoy instanceof Date ? q.hoy : new Date();
  const { desde, hasta, etiqueta } = rangoPeriodo(q.periodo, hoy);

  const [entidades, { ingresos }, aportes] = await Promise.all([
    listEntidades(),
    queryAportesBase({ desde, hasta }),
    listAportesHogarPeriodo({ desde, hasta }),
  ]);

  const personas = entidades.filter((e) => e.tipo === 'persona');
  const ingresosPorPersona = new Map(ingresos.map((r) => [r.entidad_id, Number(r.total) || 0]));
  const aportesPorPersona = new Map();
  for (const a of aportes) {
    aportesPorPersona.set(a.entidad_id, (aportesPorPersona.get(a.entidad_id) || 0) + (Number(a.monto) || 0));
  }

  const cuotas = calcularCuotasAporte({ personas, ingresosPorPersona, aportesPorPersona });
  const por_persona = cuotas.map((c) => ({
    ...c,
    ingreso_fmt: formatCOP(c.ingreso),
    aportado_fmt: formatCOP(c.aportado),
    cuota_sugerida_fmt: formatCOP(c.cuota_sugerida),
  }));

  return {
    ok: true,
    periodo: etiqueta,
    desde,
    hasta,
    por_persona,
    aportes: aportes.map((a) => ({ ...a, monto_fmt: formatCOP(Number(a.monto) || 0) })),
    nota: 'La cuota sugerida reparte lo YA aportado por la familia este mes en proporción al '
      + 'ingreso de cada quien (no un objetivo externo). Sin ingresos registrados, se reparte por igual.',
  };
}

/** Registra un aporte y lo contabiliza (best-effort: la captura nunca se cae por un fallo al contabilizar). */
export async function registrarAporteHogar({ entidad_id, fecha, monto, moneda, metodo_pago, notas, idempotency_key }, sqlArg) {
  const { inserted, row } = await insertAporteHogar({
    entidad_id, fecha, monto, moneda, metodo_pago, notas, origen: 'App', idempotency_key,
  }, sqlArg);
  if (inserted && row && row.id) {
    try { await contabilizarAporteHogar(row.id, sqlArg); } catch (e) { console.error('contabilizar aporte hogar', row.id, e.message); }
  }
  return {
    ok: true, registrado: inserted, ya_existia: !inserted, id: row && row.id,
    mensaje: inserted ? 'Aporte registrado ✅' : 'Ese aporte ya estaba registrado (no se duplicó).',
  };
}
