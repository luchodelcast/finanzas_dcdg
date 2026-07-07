/**
 * ui/ingresos.js — Captura de ingresos de la PWA (Horizonte 1 contable).
 *
 * Formulario para registrar ingresos (salario, honorarios, Ahinoa, dividendos…)
 * por entidad (Luis/Carolina/Ahinoa), con tercero pagador (NIT) y retención en
 * la fuente. Escribe en la DB (Neon) vía el backend. Debajo, últimos ingresos.
 */

import { getCatalogos, getIngresos, registrarIngreso } from '../services/finanzas.js';
import { formatCOP, hoyISO } from '../utils/formatters.js';
import { periodRange } from './dashboard.js';

const V = (id) => document.getElementById(id);

let _wired = false;
let _cat = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function formHTML(cat) {
  const ents = (cat.entidades || []).map((e) => `<option value="${e.id}" data-tipo="${esc(e.tipo)}" data-nombre="${esc(e.nombre)}">${esc(e.nombre)}</option>`).join('');
  const ceds = (cat.cedulas || []).map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join('');
  const terc = (cat.terceros || []).map((t) => `<option value="${esc(t.nombre)}">`).join('');
  return `
    <div class="row2">
      <div class="fld"><label>Entidad</label><select id="in-entidad">${ents}</select></div>
      <div class="fld"><label>Fecha</label><input type="date" id="in-fecha"></div>
    </div>
    <div class="fld"><label>Tipo de ingreso (cédula)</label><select id="in-cedula">${ceds}</select></div>
    <div class="fld"><label>Monto (COP)</label><input type="number" class="big-amt" id="in-monto" placeholder="0" inputmode="numeric"></div>
    <div class="fld"><label>Concepto</label><input type="text" id="in-desc" placeholder="Ej: honorarios asesoría marzo"></div>
    <div class="row2">
      <div class="fld"><label>Pagador (tercero)</label><input type="text" id="in-tercero" list="in-terceros" placeholder="Nombre del pagador"><datalist id="in-terceros">${terc}</datalist></div>
      <div class="fld"><label>NIT / cédula pagador</label><input type="text" id="in-nit" placeholder="Opcional" inputmode="numeric"></div>
    </div>
    <div class="row2">
      <div class="fld"><label>Retención en la fuente</label><input type="number" id="in-reten" placeholder="0" inputmode="numeric"></div>
      <div class="fld"><label>Actividad</label><input type="text" id="in-act" placeholder="Ej: Ahinoa"></div>
    </div>
    <div class="fld"><label>Notas (opcional)</label><input type="text" id="in-notas" placeholder="Ej: consignado en ahorros Luciano"></div>`;
}

function filtroEntidadOptionsHTML(cat) {
  const ents = (cat.entidades || []).map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('');
  return `<option value="">Todos</option>${ents}`;
}

function itemHTML(i) {
  const fecha = String(i.fecha || '').slice(0, 10);
  const reten = Number(i.retencion_fuente) || 0;
  return `<div class="h-item">
    <div><div class="h-name">${esc(i.concepto || i.cedula)}</div>
      <div class="h-meta">${esc(i.entidad)} · ${esc(i.cedula)}${i.actividad ? ' · ' + esc(i.actividad) : ''} · ${esc(fecha)}${i.tercero ? ' · ' + esc(i.tercero) : ''}</div></div>
    <div><div class="h-amt">${formatCOP(Number(i.monto) || 0)}</div>${reten ? `<div class="h-who">ret. ${formatCOP(reten)}</div>` : ''}</div>
  </div>`;
}

async function refreshList() {
  const entidad_id = V('ingreso-filtro-entidad').value || undefined;
  const periodo = V('ingreso-filtro-periodo').value;
  const { desde, hasta } = periodRange(periodo);
  try {
    const r = await getIngresos({ entidad_id, desde, hasta, limit: 100 });
    const ingresos = r.ingresos || [];
    const total = ingresos.reduce((s, i) => s + (Number(i.monto) || 0), 0);
    V('ingreso-total').textContent = `Total del periodo: ${formatCOP(total)}`;
    V('ingreso-list').innerHTML = ingresos.length
      ? ingresos.map(itemHTML).join('')
      : '<div class="empty">Aún no hay ingresos registrados</div>';
  } catch (e) {
    V('ingreso-total').textContent = '';
    V('ingreso-list').innerHTML = `<div class="empty" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

function onEntidadChange() {
  const sel = V('in-entidad');
  const opt = sel.options[sel.selectedIndex];
  if (!opt) return;
  // Si la entidad es un negocio (p.ej. Ahinoa), prefija actividad y cédula.
  if (opt.dataset.tipo === 'negocio') {
    if (!V('in-act').value) V('in-act').value = opt.dataset.nombre || '';
    V('in-cedula').value = 'no_laboral';
  }
}

async function save() {
  const msg = V('ingreso-msg');
  const entidad_id = Number(V('in-entidad').value);
  const monto = Number(V('in-monto').value) || 0;
  if (!entidad_id) { msg.textContent = 'Selecciona la entidad.'; msg.style.color = 'var(--red)'; return; }
  if (!(monto > 0)) { msg.textContent = 'Ingresa un monto válido.'; msg.style.color = 'var(--red)'; return; }

  const body = {
    entidad_id,
    fecha: V('in-fecha').value || hoyISO(),
    cedula: V('in-cedula').value,
    monto,
    concepto: V('in-desc').value.trim(),
    tercero_nombre: V('in-tercero').value.trim(),
    tercero_nit: V('in-nit').value.trim(),
    retencion_fuente: Number(V('in-reten').value) || 0,
    actividad: V('in-act').value.trim(),
    notas: V('in-notas').value.trim(),
  };
  msg.textContent = 'Guardando…'; msg.style.color = 'var(--gray-d)';
  V('btn-save-ingreso').disabled = true;
  try {
    const r = await registrarIngreso(body);
    msg.textContent = r.mensaje || 'Ingreso registrado ✅';
    msg.style.color = r.registrado ? 'var(--green)' : 'var(--gold)';
    // Limpia monto/concepto/tercero para el siguiente; deja entidad/cédula.
    ['in-monto', 'in-desc', 'in-tercero', 'in-nit', 'in-reten', 'in-notas'].forEach((id) => { V(id).value = ''; });
    await refreshList();
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (usuario autorizado) para registrar.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  } finally {
    V('btn-save-ingreso').disabled = false;
  }
}

/** Llamado por main.js al navegar a la pantalla de ingresos. */
export async function renderIngresos() {
  if (!_wired) {
    _wired = true;
    V('scr-ingreso').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="saveIngreso"]')) save();
    });
    V('scr-ingreso').addEventListener('change', (e) => {
      if (e.target.id === 'in-entidad') onEntidadChange();
      if (e.target.id === 'ingreso-filtro-entidad' || e.target.id === 'ingreso-filtro-periodo') refreshList();
    });
  }
  if (!_cat) {
    try {
      _cat = await getCatalogos();
      V('ingreso-form').innerHTML = formHTML(_cat);
      V('in-fecha').value = hoyISO();
      V('ingreso-filtro-entidad').innerHTML = filtroEntidadOptionsHTML(_cat);
    } catch (e) {
      V('ingreso-form').innerHTML = `<div class="empty" style="color:var(--red)">${esc(e.message)}</div>`;
      return;
    }
  }
  refreshList();
}
