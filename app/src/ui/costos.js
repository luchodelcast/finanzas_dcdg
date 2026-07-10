/**
 * ui/costos.js — Captura de costos de actividad económica (issue #154;
 * p.ej. Ahinoa: pago a tejedoras, compra a proveedores).
 *
 * Formulario para registrar un costo por entidad tipo "negocio" (hoy solo
 * Ahinoa), con tercero (proveedor) y deducible. Debajo, un mini-P&L
 * (ingresos − costos deducibles) por negocio del periodo y los últimos
 * costos capturados. Escribe en la DB (Neon) vía el backend.
 */

import { getCatalogos, getCostosActividad, registrarCostoActividad } from '../services/finanzas.js';
import { formatCOP, hoyISO } from '../utils/formatters.js';
import { periodRange } from './dashboard.js';

const V = (id) => document.getElementById(id);

let _wired = false;
let _cat = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function negocios(cat) {
  return (cat.entidades || []).filter((e) => e.tipo === 'negocio');
}

function formHTML(cat) {
  const ents = negocios(cat).map((e) => `<option value="${e.id}" data-nombre="${esc(e.nombre)}">${esc(e.nombre)}</option>`).join('');
  const terc = (cat.terceros || []).map((t) => `<option value="${esc(t.nombre)}">`).join('');
  return `
    <div class="row2">
      <div class="fld"><label>Negocio</label><select id="co-entidad">${ents}</select></div>
      <div class="fld"><label>Fecha</label><input type="date" id="co-fecha"></div>
    </div>
    <div class="fld"><label>Concepto</label><input type="text" id="co-desc" placeholder="Ej: pago tejedora marzo"></div>
    <div class="fld"><label>Monto (COP)</label><input type="number" class="big-amt" id="co-monto" placeholder="0" inputmode="numeric"></div>
    <div class="row2">
      <div class="fld"><label>Proveedor/tercero</label><input type="text" id="co-tercero" list="co-terceros" placeholder="Nombre"><datalist id="co-terceros">${terc}</datalist></div>
      <div class="fld"><label>NIT / cédula</label><input type="text" id="co-nit" placeholder="Opcional" inputmode="numeric"></div>
    </div>
    <label style="font-weight:400;font-size:12px;color:var(--gray-d);display:flex;align-items:center;gap:6px;margin:6px 0">
      <input type="checkbox" id="co-deducible" checked style="width:auto"> Deducible (depura la base de IBC/renta)
    </label>
    <div class="fld"><label>Notas (opcional)</label><input type="text" id="co-notas" placeholder="Ej: soporte en carpeta compartida"></div>`;
}

function filtroEntidadOptionsHTML(cat) {
  const ents = negocios(cat).map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('');
  return `<option value="">Todos</option>${ents}`;
}

function itemHTML(c) {
  const fecha = String(c.fecha || '').slice(0, 10);
  return `<div class="h-item">
    <div><div class="h-name">${esc(c.concepto || 'Costo')}</div>
      <div class="h-meta">${esc(c.entidad)}${c.tercero ? ' · ' + esc(c.tercero) : ''} · ${esc(fecha)}${c.deducible ? '' : ' · no deducible'}</div></div>
    <div><div class="h-amt">${formatCOP(Number(c.monto) || 0)}</div></div>
  </div>`;
}

function pnlHTML(p) {
  return `<div class="card">
    <div class="card-ttl">${esc(p.entidad)} — mini-P&amp;L del periodo</div>
    <div class="bar-head" style="margin-bottom:8px"><span class="bar-cat">Ingresos</span><span class="bar-amt">${esc(p.ingresos_fmt)}</span></div>
    <div class="bar-head" style="margin-bottom:8px"><span class="bar-cat">Costos deducibles</span><span class="bar-amt">${esc(p.costos_deducibles_fmt)}</span></div>
    <div class="bar-head" style="font-weight:700"><span class="bar-cat">Utilidad</span><span class="bar-amt">${esc(p.utilidad_fmt)}</span></div>
  </div>`;
}

async function refreshList() {
  const entidad_id = V('costo-filtro-entidad').value || undefined;
  const periodo = V('costo-filtro-periodo').value;
  const { desde, hasta } = periodRange(periodo);
  try {
    const r = await getCostosActividad({ entidad_id, desde, hasta, limit: 100 });
    const costos = r.costos || [];
    const total = costos.filter((c) => c.deducible).reduce((s, c) => s + (Number(c.monto) || 0), 0);
    V('costo-total').textContent = `Costos deducibles del periodo: ${formatCOP(total)}`;
    V('costo-list').innerHTML = costos.length
      ? costos.map(itemHTML).join('')
      : '<div class="empty">Aún no hay costos registrados</div>';
    const negs = r.por_negocio || [];
    V('costo-pnl').innerHTML = negs.length
      ? negs.map(pnlHTML).join('')
      : '';
  } catch (e) {
    V('costo-total').textContent = '';
    V('costo-list').innerHTML = `<div class="empty" style="color:var(--red)">${esc(e.message)}</div>`;
    V('costo-pnl').innerHTML = '';
  }
}

async function save() {
  const msg = V('costo-msg');
  const entidad_id = Number(V('co-entidad').value);
  const monto = Number(V('co-monto').value) || 0;
  if (!entidad_id) { msg.textContent = 'Selecciona el negocio.'; msg.style.color = 'var(--red)'; return; }
  if (!(monto > 0)) { msg.textContent = 'Ingresa un monto válido.'; msg.style.color = 'var(--red)'; return; }

  const sel = V('co-entidad');
  const opt = sel.options[sel.selectedIndex];
  const body = {
    entidad_id,
    fecha: V('co-fecha').value || hoyISO(),
    concepto: V('co-desc').value.trim(),
    monto,
    tercero_nombre: V('co-tercero').value.trim(),
    tercero_nit: V('co-nit').value.trim(),
    deducible: V('co-deducible').checked,
    actividad: opt && opt.dataset.nombre,
    notas: V('co-notas').value.trim(),
  };
  msg.textContent = 'Guardando…'; msg.style.color = 'var(--gray-d)';
  V('btn-save-costo').disabled = true;
  try {
    const r = await registrarCostoActividad(body);
    msg.textContent = r.mensaje || 'Costo registrado ✅';
    msg.style.color = r.registrado ? 'var(--green)' : 'var(--gold)';
    ['co-monto', 'co-desc', 'co-tercero', 'co-nit', 'co-notas'].forEach((id) => { V(id).value = ''; });
    V('co-deducible').checked = true;
    await refreshList();
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (usuario autorizado) para registrar.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  } finally {
    V('btn-save-costo').disabled = false;
  }
}

/** Llamado por main.js al navegar a la pantalla de costos de actividad. */
export async function renderCostos() {
  if (!_wired) {
    _wired = true;
    V('scr-costos').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="saveCosto"]')) save();
    });
    V('scr-costos').addEventListener('change', (e) => {
      if (e.target.id === 'costo-filtro-entidad' || e.target.id === 'costo-filtro-periodo') refreshList();
    });
  }
  if (!_cat) {
    try {
      _cat = await getCatalogos();
      V('costo-form').innerHTML = formHTML(_cat);
      V('co-fecha').value = hoyISO();
      V('costo-filtro-entidad').innerHTML = filtroEntidadOptionsHTML(_cat);
    } catch (e) {
      V('costo-form').innerHTML = `<div class="empty" style="color:var(--red)">${esc(e.message)}</div>`;
      return;
    }
  }
  refreshList();
}
