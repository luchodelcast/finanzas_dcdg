/**
 * ui/aportes.js — Reporte mensual de aportes IBC por persona (Fase 3.2 del
 * roadmap contable, docs/roadmap-contable.md), solo lectura.
 *
 * Una tarjeta por persona (Luis, Carolina…) con ingresos del mes, costos
 * deducibles, IBC calculado y el desglose de aportes (salud/pensión/FSP).
 * No registra pagos ni concilia — es un reporte de apoyo, no un trámite.
 */

import { getAportes } from '../services/finanzas.js';
import { periodRange } from './dashboard.js';

const V = (id) => document.getElementById(id);

let _wired = false;
let _periodo = 'mes';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function segHTML() {
  const opts = [['mes', 'Este mes'], ['mespasado', 'Mes pasado']];
  return `<div class="seg">${opts.map(([k, l]) =>
    `<button class="seg-btn${k === _periodo ? ' on' : ''}" data-per="${k}">${l}</button>`).join('')}</div>`;
}

/** Fila etiqueta/valor reutilizando los estilos de las barras del dashboard. */
function rowHTML(label, value, { strong = false } = {}) {
  return `<div class="bar-head" style="margin-bottom:8px${strong ? ';font-weight:700' : ''}">
    <span class="bar-cat">${esc(label)}</span><span class="bar-amt">${esc(value)}</span>
  </div>`;
}

function consolidaHTML(negocios) {
  if (!negocios || !negocios.length) return '';
  return negocios.map((n) => `<div style="font-size:10px;color:var(--gray-d);margin:-4px 0 6px">
    Incluye ${esc(n.entidad)}: ${esc(n.ingresos_fmt)} − ${esc(n.costos_deducibles_fmt)} = ${esc(n.neto_fmt)}
  </div>`).join('');
}

function personaCardHTML(p) {
  const topadoTxt = p.ibc_topado === 'piso' ? ' · piso 1 SMMLV'
    : p.ibc_topado === 'techo' ? ' · techo 25 SMMLV' : '';
  const smmlvNota = p.smmlv_aproximado ? ` (SMMLV ${p.smmlv_anio}, último confirmado)` : ` (${p.smmlv_anio})`;
  return `<div class="card">
    <div class="card-ttl">${esc(p.entidad)}</div>
    ${rowHTML('Ingresos del mes', p.ingresos_fmt)}
    ${rowHTML('Costos deducibles', p.costos_deducibles_fmt)}
    ${consolidaHTML(p.consolida_negocios)}
    ${rowHTML('IBC' + topadoTxt, p.ibc_fmt, { strong: true })}
    <div style="height:1px;background:var(--gray-m);margin:10px 0"></div>
    ${rowHTML('Salud (12.5%)', p.aportes.salud_fmt)}
    ${rowHTML('Pensión (16%)', p.aportes.pension_fmt)}
    ${p.aportes.fsp_aplica ? rowHTML('FSP', p.aportes.fsp_fmt) : ''}
    ${rowHTML('Total aportes', p.aportes.total_fmt, { strong: true })}
    <div style="font-size:10px;color:var(--gray-d);margin-top:8px">SMMLV${smmlvNota}</div>
  </div>`;
}

async function load() {
  V('aportes-body').innerHTML = '<div class="proc-wrap" style="min-height:160px"><div class="spin"></div><div class="proc-msg">Cargando…</div></div>';
  const { desde, hasta, label } = periodRange(_periodo);
  try {
    const r = await getAportes({ periodo: `${desde}..${hasta}` });
    const personas = r.por_persona || [];
    V('aportes-body').innerHTML = `
      <div class="card dash-total-card" style="padding:14px">
        <div class="dash-total-lbl">${esc(label)}</div>
      </div>
      ${personas.length ? personas.map(personaCardHTML).join('') : '<div class="card"><div class="empty">Sin ingresos registrados en este periodo</div></div>'}
      <div class="card"><div class="empty" style="font-size:11px;line-height:1.5;text-align:left">${esc(r.nota || '')}</div></div>`;
  } catch (e) {
    const msg = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (Luis o Carolina) para ver este reporte.'
      : (e.message || 'No se pudo cargar el reporte.');
    V('aportes-body').innerHTML = `<div class="card"><div class="empty" style="color:var(--red)">${esc(msg)}</div>
      <button class="btn btn-s" data-act="aportesReload" style="margin-top:12px">Reintentar</button></div>`;
  }
}

/** Llamado por main.js al navegar a la pantalla de aportes IBC. */
export function renderAportes() {
  const sel = V('aportes-seg');
  if (sel) sel.innerHTML = segHTML();
  if (!_wired) {
    _wired = true;
    const scr = V('scr-aportes');
    scr.addEventListener('click', (e) => {
      const per = e.target.closest('[data-per]');
      if (per) {
        _periodo = per.dataset.per;
        scr.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.per === _periodo));
        load();
        return;
      }
      if (e.target.closest('[data-act="aportesReload"]')) load();
    });
  }
  load();
}
