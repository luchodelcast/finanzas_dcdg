/**
 * ui/presupuesto.js — Presupuesto mensual por categoría (issue #135).
 *
 * Reporte PTTO · Ejecutado · Variación por categoría del mes, con una barra
 * (ejecutado sobre presupuesto) e indicador verde/rojo (dentro/sobre
 * presupuesto). Debajo, un formulario para fijar el presupuesto de una
 * categoría (solo owners); lectura para el equipo.
 */
import { getPresupuesto, guardarPresupuesto } from '../services/finanzas.js';
import { currentUser } from '../services/auth.js';
import { CATEGORIAS } from '../config/categories.js';
import { formatCOP } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);
const esOwner = () => (currentUser() || {}).rol === 'owner';

let _wired = false;
let _periodo = ''; // '' = mes en curso; si no, 'AAAA-MM'

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function filaHTML(c) {
  const pct = c.ptto > 0 ? Math.min(100, Math.round((c.ejecutado / c.ptto) * 100)) : (c.ejecutado > 0 ? 100 : 0);
  const color = c.dentro_presupuesto ? 'var(--green)' : 'var(--red)';
  const varTexto = c.ptto > 0
    ? `${c.variacion > 0 ? '▲' : '▼'} ${formatCOP(Math.abs(c.variacion))} (${c.variacion_pct > 0 ? '+' : ''}${c.variacion_pct}%)`
    : 'Sin presupuesto';
  const varCls = c.ptto === 0 ? 'bar-var' : `bar-var ${c.dentro_presupuesto ? 'var-down' : 'var-up'}`;
  return `<div class="bar-row">
    <div class="bar-head"><span class="bar-cat">${esc(c.categoria)}</span><span class="bar-amt">${esc(c.ejecutado_fmt)} de ${esc(c.ptto_fmt)}</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
    <div class="bar-head" style="margin-top:2px"><span class="${varCls}">${esc(varTexto)}</span></div>
  </div>`;
}

function reporteHTML(r) {
  if (!r.categorias || !r.categorias.length) return '<div class="empty">Sin datos para este mes</div>';
  return r.categorias.map(filaHTML).join('');
}

async function cargar() {
  const msg = V('pt-msg');
  msg.textContent = '';
  V('pt-body').innerHTML = '<div class="proc-wrap" style="min-height:120px"><div class="spin"></div><div class="proc-msg">Cargando…</div></div>';
  try {
    const [anio, mes] = _periodo ? _periodo.split('-').map(Number) : [];
    const r = await getPresupuesto(anio && mes ? { anio, mes } : {});
    V('pt-titulo').textContent = `Presupuesto de ${String(r.mes).padStart(2, '0')}/${r.anio}`;
    V('pt-total').innerHTML = `<span class="bar-cat">Total</span> <span class="bar-amt">${esc(r.total_ejecutado_fmt)} de ${esc(r.total_ptto_fmt)}</span>`;
    V('pt-body').innerHTML = reporteHTML(r);
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para ver el presupuesto.'
      : 'Error: ' + (e.message || 'no se pudo cargar el presupuesto');
    msg.style.color = 'var(--red)';
    V('pt-body').innerHTML = '';
  }
}

function cargarCatalogos() {
  V('pt-n-categoria').innerHTML = CATEGORIAS.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

async function guardar() {
  const msg = V('pt-n-msg');
  const categoria = V('pt-n-categoria').value;
  const monto_ptto = Number(V('pt-n-monto').value);
  if (!(monto_ptto >= 0)) { msg.textContent = 'Ingresa un monto de presupuesto válido.'; msg.style.color = 'var(--red)'; return; }
  const [anio, mes] = _periodo ? _periodo.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
  msg.textContent = 'Guardando…'; msg.style.color = 'var(--gray-d)';
  try {
    const r = await guardarPresupuesto({ categoria, anio, mes, monto_ptto });
    msg.textContent = r.mensaje || 'Presupuesto guardado ✅';
    msg.style.color = 'var(--green)';
    V('pt-n-monto').value = '';
    await cargar();
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Tu rol no tiene permiso para fijar el presupuesto.')
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

/** Llamado por main.js al navegar a la pantalla de Presupuesto. */
export function renderPresupuesto() {
  cargarCatalogos();
  const form = V('pt-form');
  if (form) form.hidden = !esOwner();
  if (!_wired) {
    _wired = true;
    V('scr-presupuesto').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="ptActualizar"]')) { _periodo = V('pt-periodo').value.trim(); cargar(); }
      if (e.target.closest('[data-act="ptGuardar"]')) guardar();
    });
  }
  cargar();
}
