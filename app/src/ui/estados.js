/**
 * ui/estados.js — Estado de Resultados (T6) + Balance General (T7), PWA.
 *
 * Solo lectura: derivados del Balance de Comprobación (T5). Cierra la Semana 2
 * de estados financieros del motor contable.
 */

import { getEstadoResultados, getBalanceGeneral } from '../services/finanzas.js';
import { formatCOP, hoyISO } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);

let _wired = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function rowHTML(label, value, { strong = false } = {}) {
  return `<div class="bar-head" style="margin-bottom:6px${strong ? ';font-weight:700' : ''}">
    <span class="bar-cat">${esc(label)}</span><span class="bar-amt">${esc(value)}</span>
  </div>`;
}

function grupoHTML(titulo, cuentas) {
  if (!cuentas.length) return '';
  return `<div style="font-size:12px;font-weight:700;margin-top:8px">${esc(titulo)}</div>`
    + cuentas.map((c) => rowHTML(`${c.codigo} · ${c.nombre}`, formatCOP(c.saldo))).join('');
}

async function consultarEstadoResultados() {
  const msg = V('er-msg');
  msg.textContent = '';
  V('er-body').innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const r = await getEstadoResultados({ desde: V('er-desde').value || undefined, hasta: V('er-hasta').value || undefined });
    V('er-body').innerHTML = grupoHTML('Ingresos', r.ingresos)
      + grupoHTML('Gastos', r.gastos)
      + grupoHTML('Costos', r.costos)
      || '<div class="empty">Sin movimientos en este rango</div>';
    V('er-total').innerHTML = rowHTML('Resultado del periodo', formatCOP(r.resultado), { strong: true });
    V('er-total').style.color = r.resultado >= 0 ? 'var(--green)' : 'var(--red)';
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para ver el estado de resultados.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
    V('er-body').innerHTML = '';
    V('er-total').innerHTML = '';
  }
}

async function consultarBalanceGeneral() {
  const msg = V('bg-msg');
  msg.textContent = '';
  V('bg-body').innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const r = await getBalanceGeneral({ fecha: V('bg-fecha').value || hoyISO() });
    const sinMovimientos = !r.activo.length && !r.pasivo.length && !r.patrimonio.length;
    V('bg-body').innerHTML = sinMovimientos
      ? '<div class="empty">Sin movimientos a esta fecha</div>'
      : grupoHTML('Activo', r.activo) + grupoHTML('Pasivo', r.pasivo) + grupoHTML('Patrimonio', r.patrimonio)
        + rowHTML('Resultado del ejercicio', formatCOP(r.resultadoEjercicio));
    const cuadre = rowHTML('Total', `Activo ${formatCOP(r.totalActivo)} = Pasivo + Patrimonio ${formatCOP(r.totalPasivo + r.totalPatrimonio)}`, { strong: true });
    V('bg-total').innerHTML = cuadre;
    V('bg-total').style.color = r.cuadra ? 'var(--green)' : 'var(--red)';
    msg.textContent = r.cuadra ? '✓ Cuadra (Activo = Pasivo + Patrimonio).' : '⚠ No cuadra — revisa los asientos.';
    msg.style.color = r.cuadra ? 'var(--green)' : 'var(--red)';
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para ver el balance general.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
    V('bg-body').innerHTML = '';
    V('bg-total').innerHTML = '';
  }
}

/** Llamado por main.js al navegar a la pantalla de Estados financieros. */
export async function renderEstados() {
  if (!V('bg-fecha').value) V('bg-fecha').value = hoyISO();
  if (!_wired) {
    _wired = true;
    V('scr-estados').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="verEstadoResultados"]')) consultarEstadoResultados();
      if (e.target.closest('[data-act="verBalanceGeneral"]')) consultarBalanceGeneral();
    });
  }
}
