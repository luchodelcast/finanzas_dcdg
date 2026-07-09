/**
 * _lib/presupuesto.js — Presupuesto mensual por categoría (issue #135, `auto-ok`).
 *
 * Reporte "PTTO · Ejecutado · Variación" por categoría del mes: el presupuesto
 * (`presupuestos`, tabla nueva) se fija por categoría/mes; el ejecutado reusa
 * el mismo agregado de gasto por categoría que ya usa el Dashboard
 * (`queryResumen`) — nada nuevo ahí, solo se cruza contra el PTTO.
 */
import { listPresupuestos, upsertPresupuesto, queryResumen } from './repo.js';
import { rangoPeriodo } from './finanzas.js';
import { CATEGORIAS } from '../../../app/src/config/categories.js';
import { formatCOP } from '../../../app/src/utils/formatters.js';

/**
 * Variación PTTO vs. ejecutado (pura, testeable): monto y % (positivo = nos
 * pasamos del presupuesto) + si el gasto quedó dentro de lo presupuestado.
 */
export function calcularVariacion(ptto, ejecutado) {
  const p = Number(ptto) || 0;
  const e = Number(ejecutado) || 0;
  const variacion = e - p;
  const variacion_pct = p > 0 ? Math.round((variacion / p) * 1000) / 10 : null;
  return { ptto: p, ejecutado: e, variacion, variacion_pct, dentro_presupuesto: e <= p };
}

function periodoActual(hoy = new Date()) {
  return { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 };
}

/**
 * Reporte "Presupuesto vs. ejecutado" de un mes (por defecto, el mes en
 * curso): una fila por categoría de la taxonomía oficial (`CATEGORIAS`), más
 * cualquier categoría con gasto real que no esté en esa lista (para no
 * esconder gasto de una categoría antigua/libre), con PTTO/ejecutado/variación.
 */
export async function reportePresupuesto({ anio, mes } = {}, sqlArg) {
  const per = anio && mes ? { anio: Number(anio), mes: Number(mes) } : periodoActual();
  const periodoStr = `${per.anio}-${String(per.mes).padStart(2, '0')}`;
  const { desde, hasta } = rangoPeriodo(periodoStr);

  const [presupuestosRows, res] = await Promise.all([
    listPresupuestos(per, sqlArg),
    queryResumen({ desde, hasta }, sqlArg),
  ]);

  const pttoMap = new Map(presupuestosRows.map((r) => [r.categoria, Number(r.monto_ptto) || 0]));
  const ejecMap = new Map((res.por_categoria || []).map((c) => [c.categoria, Number(c.monto) || 0]));
  const nombres = [...CATEGORIAS, ...[...ejecMap.keys()].filter((c) => !CATEGORIAS.includes(c))];

  const categorias = nombres
    .map((categoria) => {
      const v = calcularVariacion(pttoMap.get(categoria) || 0, ejecMap.get(categoria) || 0);
      return {
        categoria,
        ...v,
        ptto_fmt: formatCOP(v.ptto),
        ejecutado_fmt: formatCOP(v.ejecutado),
        variacion_fmt: formatCOP(v.variacion),
      };
    })
    .sort((a, b) => b.ejecutado - a.ejecutado);

  const totalPtto = categorias.reduce((s, c) => s + c.ptto, 0);
  const totalEjecutado = categorias.reduce((s, c) => s + c.ejecutado, 0);
  const totalVar = calcularVariacion(totalPtto, totalEjecutado);

  return {
    ok: true,
    anio: per.anio,
    mes: per.mes,
    categorias,
    total_ptto: totalPtto,
    total_ptto_fmt: formatCOP(totalPtto),
    total_ejecutado: totalEjecutado,
    total_ejecutado_fmt: formatCOP(totalEjecutado),
    total_variacion: totalVar.variacion,
    total_variacion_pct: totalVar.variacion_pct,
  };
}

/** Fija (crea o actualiza) el presupuesto de una categoría en un mes. Solo owners. */
export async function guardarPresupuesto({ categoria, anio, mes, monto_ptto }, sqlArg) {
  const cat = String(categoria || '').trim();
  if (!cat) throw new Error('categoría requerida');
  const a = Number(anio);
  const m = Number(mes);
  if (!(a >= 2000 && a <= 3000)) throw new Error('año inválido');
  if (!(m >= 1 && m <= 12)) throw new Error('mes inválido (1-12)');
  const monto = Number(monto_ptto);
  if (!(monto >= 0)) throw new Error('monto de presupuesto inválido');
  const row = await upsertPresupuesto({ categoria: cat, anio: a, mes: m, monto_ptto: monto }, sqlArg);
  return { ok: true, id: row.id, mensaje: `Presupuesto de "${cat}" (${a}-${String(m).padStart(2, '0')}) guardado ✅` };
}
