/**
 * _lib/pagos.js — Pagos del mes (presupuesto familiar, issue #73, Nocturno 2/7).
 *
 * Módulo puro y testeable: dado el catálogo de pagos fijos y el estado del mes
 * (filas de `pagos_estado`), arma la vista "qué se ha pagado / qué falta" y sus
 * totales. Nunca toca la DB — eso vive en `repo.js` (`ensurePagosFijosSchema`,
 * `listPagosFijos`, `upsertPagoEstado`, …).
 */

/** Mes anterior a (anio, mes), con rollover de enero → diciembre del año previo. */
export function mesAnterior(anio, mes) {
  const m = Number(mes);
  const a = Number(anio);
  return m === 1 ? { anio: a - 1, mes: 12 } : { anio: a, mes: m - 1 };
}

/**
 * Estado visual de un pago fijo para un (anio, mes) dado, a la fecha `hoyISO`
 * ('YYYY-MM-DD'). `estadoRow` es la fila de `pagos_estado` para ese pago/mes
 * (o null/undefined si aún no existe → pendiente).
 * @returns {'pagado'|'pendiente'|'vencido'}
 */
export function estadoPago(pagoFijo, estadoRow, anio, mes, hoyISO) {
  if (estadoRow && estadoRow.estado === 'pagado') return 'pagado';
  const [hy, hm, hd] = String(hoyISO).split('-').map(Number);
  const targetKey = Number(anio) * 12 + Number(mes);
  const hoyKey = hy * 12 + hm;
  if (targetKey < hoyKey) return 'vencido'; // mes ya cerrado y sin pagar
  if (targetKey > hoyKey) return 'pendiente'; // mes futuro, aún no aplica
  // Mismo mes: vencido si ya pasó el día de vencimiento.
  return hd > Number(pagoFijo.dia_vencimiento) ? 'vencido' : 'pendiente';
}

/**
 * ¿Ya existía este pago fijo en (anio, mes)? Evita que un pago fijo agregado
 * HOY (p. ej. un "Netflix" nuevo) aparezca como "vencido" en meses anteriores
 * a su creación — solo aplica al calcular "pendientes del mes pasado".
 */
export function estaVigenteEnMes(pagoFijo, anio, mes) {
  const creado = new Date(pagoFijo.creado_en);
  if (Number.isNaN(creado.getTime())) return true; // sin fecha confiable: no lo excluye
  const creadoKey = creado.getFullYear() * 12 + (creado.getMonth() + 1);
  const targetKey = Number(anio) * 12 + Number(mes);
  return creadoKey <= targetKey;
}

/**
 * Une el catálogo de pagos fijos activos con las filas de estado de un mes y
 * calcula el estado visual de cada uno.
 */
export function armarPagosDelMes(pagosFijos, estados, anio, mes, hoyISO) {
  const porPago = new Map(estados.map((e) => [Number(e.pago_fijo_id), e]));
  return pagosFijos.map((p) => {
    const est = porPago.get(Number(p.id)) || null;
    return {
      ...p,
      estado: estadoPago(p, est, anio, mes, hoyISO),
      fecha_pago: est ? est.fecha_pago : null,
      monto_pagado: est ? est.monto_pagado : null,
    };
  });
}

/** Renglón de totales vacío, reusado para el total general y cada grupo de `por_asumido`. */
function totalesVacios() {
  return { total_presupuestado: 0, total_pagado: 0, total_pendiente: 0, n_pagados: 0, n_pendientes: 0, n_vencidos: 0 };
}

function acumular(out, p) {
  const monto = Number(p.monto) || 0;
  out.total_presupuestado += monto;
  if (p.estado === 'pagado') {
    out.n_pagados++;
    out.total_pagado += Number(p.monto_pagado ?? monto) || 0;
  } else {
    out.total_pendiente += monto;
    if (p.estado === 'vencido') out.n_vencidos++;
    else out.n_pendientes++;
  }
}

/**
 * Totales del mes: pagado vs. pendiente (incluye vencidos), por familia, y
 * desglosados por quién asume (`asumido_por`: LADCC/CMDG/Común, issue #136)
 * en `por_asumido`. Un pago sin `asumido_por` (dato viejo) cuenta como 'Común'.
 */
export function resumenPagos(pagos) {
  const out = totalesVacios();
  out.por_asumido = {};
  for (const p of pagos) {
    acumular(out, p);
    const quien = p.asumido_por || 'Común';
    if (!out.por_asumido[quien]) out.por_asumido[quien] = totalesVacios();
    acumular(out.por_asumido[quien], p);
  }
  return out;
}

/** Lista los últimos `n` meses (incluido el actual), del más reciente al más antiguo. */
export function ultimosMeses(anio, mes, n) {
  const out = [];
  let a = Number(anio);
  let m = Number(mes);
  for (let i = 0; i < n; i++) {
    out.push({ anio: a, mes: m });
    m -= 1;
    if (m < 1) { m = 12; a -= 1; }
  }
  return out;
}

/**
 * Historial de pagos por mes (reporte histórico): dado el catálogo activo, TODAS
 * las filas de estado del rango y la lista de meses, arma para cada mes su
 * resumen (presupuestado/pagado/pendiente + por_asumido), más un **acumulado**
 * del rango completo (total pagado y por quién asume). Módulo puro.
 */
export function historialPagos(pagosFijos, estados, meses, hoyISO) {
  const porMes = meses.map(({ anio, mes }) => {
    const delMes = estados.filter((e) => Number(e.anio) === Number(anio) && Number(e.mes) === Number(mes));
    const pagos = armarPagosDelMes(pagosFijos, delMes, anio, mes, hoyISO);
    const r = resumenPagos(pagos);
    return { anio, mes, ...r };
  });
  // Acumulado del rango: suma de lo REALMENTE pagado por quién asume.
  const acumulado = { total_pagado: 0, por_asumido: {} };
  for (const m of porMes) {
    acumulado.total_pagado += m.total_pagado;
    for (const [quien, t] of Object.entries(m.por_asumido || {})) {
      if (!acumulado.por_asumido[quien]) acumulado.por_asumido[quien] = 0;
      acumulado.por_asumido[quien] += t.total_pagado;
    }
  }
  return { por_mes: porMes, acumulado };
}
