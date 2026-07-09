/**
 * ui/patrimonio.js — Patrimonio individual (issue #115, Contab. familiar C).
 *
 * "Mi patrimonio": neto de la persona logueada + evolución mensual (serie
 * simple). Debajo, el desglose por persona (Luis/Carolina/Común/consolidado)
 * que ya expone el backend vía `cuentas_meta` (#112). Todo solo lectura.
 */

import { getMiPatrimonio, getPatrimonioPersonas } from '../services/finanzas.js';
import { formatCOP, hoyISO } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);
const PALETTE = ['#2f7a63', '#c9a04a', '#7a5a9c', '#3d6fb5', '#b5563d'];

let _wired = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function rowHTML(label, value, { strong = false } = {}) {
  return `<div class="bar-head" style="margin-bottom:6px${strong ? ';font-weight:700' : ''}">
    <span class="bar-cat">${esc(label)}</span><span class="bar-amt">${esc(value)}</span>
  </div>`;
}

function evolucionHTML(serie) {
  if (!serie || !serie.length) return '<div class="empty">Sin datos suficientes todavía</div>';
  const max = Math.max(...serie.map((s) => Math.abs(Number(s.neto) || 0))) || 1;
  return serie.map((s, i) => {
    const pct = Math.max(2, Math.round((Math.abs(Number(s.neto) || 0) / max) * 100));
    const color = PALETTE[i % PALETTE.length];
    return `<div class="bar-row">
      <div class="bar-head"><span class="bar-cat">${esc(s.periodo)}</span><span class="bar-amt">${esc(formatCOP(s.neto))}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  }).join('');
}

function personaCardHTML(p) {
  return `<div class="card">
    <div class="card-ttl">${esc(p.entidad)}</div>
    ${rowHTML('Activo', formatCOP(p.totalActivo))}
    ${rowHTML('Pasivo', formatCOP(p.totalPasivo))}
    ${rowHTML('Patrimonio', formatCOP(p.totalPatrimonio))}
    ${rowHTML('Neto (activo − pasivo)', formatCOP(p.neto), { strong: true })}
  </div>`;
}

async function cargarMiPatrimonio() {
  const msg = V('mp-msg');
  msg.textContent = '';
  V('mp-body').innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const r = await getMiPatrimonio({ fecha: V('mp-fecha').value || hoyISO() });
    V('mp-titulo').textContent = r.persona ? `Patrimonio de ${r.persona}` : 'Patrimonio consolidado';
    if (r.nota) { msg.textContent = r.nota; msg.style.color = 'var(--gray-d)'; }
    V('mp-body').innerHTML = rowHTML('Neto (activo − pasivo)', formatCOP(r.balance.neto), { strong: true })
      + rowHTML('Activo', formatCOP(r.balance.totalActivo))
      + rowHTML('Pasivo', formatCOP(r.balance.totalPasivo));
    V('mp-evolucion').innerHTML = evolucionHTML(r.evolucion);
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para ver tu patrimonio.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
    V('mp-body').innerHTML = '';
    V('mp-evolucion').innerHTML = '';
  }
}

async function cargarPorPersona() {
  const msg = V('mp-pp-msg');
  msg.textContent = '';
  V('mp-pp-body').innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const r = await getPatrimonioPersonas({ fecha: V('mp-fecha').value || hoyISO() });
    const cards = [
      ...(r.personas || []),
      { entidad: 'Común', ...r.comun },
      { entidad: 'Consolidado', ...r.consolidado },
    ];
    V('mp-pp-body').innerHTML = cards.map(personaCardHTML).join('');
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para ver el desglose por persona.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
    V('mp-pp-body').innerHTML = '';
  }
}

async function actualizar() {
  await Promise.all([cargarMiPatrimonio(), cargarPorPersona()]);
}

/** Llamado por main.js al navegar a la pantalla de Patrimonio. */
export async function renderPatrimonio() {
  if (!V('mp-fecha').value) V('mp-fecha').value = hoyISO();
  await actualizar();
  if (!_wired) {
    _wired = true;
    V('scr-patrimonio').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="mpActualizar"]')) actualizar();
    });
  }
}
