/**
 * ui/home.js — Home (tablero), Nocturno 4/7.
 *
 * De un vistazo: saldos en bancos, pagos del mes (pendiente/vencido) y
 * pendientes del mes pasado, más accesos rápidos. La captura de gastos
 * (foto, texto, CET, transferencia) vive ahora en "Registrar egresos".
 */

import { getComprobacion, getPagosDelMes, getResumen } from '../services/finanzas.js';
import { formatCOP } from '../utils/formatters.js';
import { periodRange, periodRangeAnterior, variacionHTML } from './dashboard.js';

const V = (id) => document.getElementById(id);

// Cuentas "hoja" de bancos/efectivo del plan de cuentas (clase 1). Las de CxC
// (1305/1310/1315) no son saldo bancario, se excluyen a propósito.
const CUENTAS_BANCO = ['1105', '1110'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function saldosHTML(cuentas) {
  const bancos = (cuentas || []).filter((c) => CUENTAS_BANCO.includes(c.codigo));
  if (!bancos.length) return '<div class="empty">Sin saldos registrados aún (monta la apertura en 🏦)</div>';
  const total = bancos.reduce((s, c) => s + (Number(c.saldo) || 0), 0);
  const filas = bancos.map((c) => `<div class="h-item"><div class="h-name">${esc(c.nombre)}</div><div class="h-amt">${formatCOP(c.saldo)}</div></div>`).join('');
  return `${filas}<div class="h-item" style="border-top:1.5px solid var(--gray-m);margin-top:2px">
    <div class="h-name" style="font-weight:800">Total</div><div class="h-amt">${formatCOP(total)}</div>
  </div>`;
}

function pagosMesHTML(resumen) {
  if (!resumen) return '<div class="empty">Sin datos</div>';
  const vencidos = Number(resumen.n_vencidos) || 0;
  return `<div class="h-item">
    <div><div class="h-name">Pendiente por pagar</div>${vencidos ? `<div class="h-meta" style="color:var(--red)">${vencidos} vencido${vencidos === 1 ? '' : 's'}</div>` : ''}</div>
    <div class="h-amt">${formatCOP(resumen.total_pendiente)}</div>
  </div>`;
}

function pagosAnterioresHTML(pendientes) {
  const n = (pendientes || []).length;
  if (!n) return '';
  const total = pendientes.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  return `<div class="h-item"><div class="h-name">${n} pago${n === 1 ? '' : 's'} sin marcar pagado</div><div class="h-amt">${formatCOP(total)}</div></div>`;
}

async function cargarSaldosYPagos() {
  try {
    const [comp, pagos] = await Promise.all([getComprobacion({}), getPagosDelMes({})]);
    V('home-saldos').innerHTML = saldosHTML(comp.cuentas);
    V('home-pagos-mes').innerHTML = pagosMesHTML(pagos.resumen);
    const antHtml = pagosAnterioresHTML(pagos.pendientes_mes_anterior);
    V('home-pagos-ant-card').style.display = antHtml ? '' : 'none';
    if (antHtml) V('home-pagos-ant').innerHTML = antHtml;
  } catch (e) {
    const msg = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (Luis o Carolina) para ver el tablero.'
      : (e.message || 'No se pudo cargar el tablero.');
    V('home-saldos').innerHTML = `<div class="empty" style="color:var(--red)">${esc(msg)}</div>`;
    V('home-pagos-mes').innerHTML = '';
    V('home-pagos-ant-card').style.display = 'none';
  }
}

async function cargarComparativo() {
  try {
    const { desde, hasta, label } = periodRange('mes');
    const anterior = periodRangeAnterior('mes');
    const [res, resAnterior] = await Promise.all([
      getResumen({ periodo: `${desde}..${hasta}` }),
      getResumen({ periodo: `${anterior.desde}..${anterior.hasta}` }),
    ]);
    const total = Number(res.total) || 0;
    const totalAnterior = Number(resAnterior.total) || 0;
    const varHtml = variacionHTML(total, totalAnterior, { sufijo: ` vs. ${esc(anterior.label)}` });
    V('home-comparativo').innerHTML = `<div class="h-item"><div class="h-name">${esc(label)}</div><div class="h-amt">${esc(res.total_fmt || formatCOP(total))} ${varHtml}</div></div>`;
  } catch (_) {
    V('home-comparativo').innerHTML = '<div class="empty">Sin datos</div>';
  }
}

/** Llamado por main.js al navegar (o abrir) el Home. */
export function renderHome() {
  V('home-saldos').innerHTML = '<div class="empty">Cargando…</div>';
  V('home-pagos-mes').innerHTML = '<div class="empty">Cargando…</div>';
  V('home-comparativo').innerHTML = '<div class="empty">Cargando…</div>';
  cargarSaldosYPagos();
  cargarComparativo();
}
