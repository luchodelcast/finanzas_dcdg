/**
 * ui/renta-anual.js — Hoja de trabajo de renta por cédulas + patrimonio
 * fiscal a 31-dic, por persona (issue #130, Fase 3.3 del roadmap contable,
 * docs/roadmap-contable.md), solo lectura.
 *
 * Una tarjeta por persona (Luis, Carolina…) con el desglose de ingresos del
 * año por cédula, los costos deducibles y el patrimonio (activo/pasivo/neto)
 * a 31-dic. Es un borrador de apoyo para el contador, no una declaración.
 */

import { getRentaAnual, descargarCsv } from '../services/finanzas.js';

const V = (id) => document.getElementById(id);

let _wired = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Fila etiqueta/valor reutilizando los estilos de las barras del dashboard. */
function rowHTML(label, value, { strong = false } = {}) {
  return `<div class="bar-head" style="margin-bottom:8px${strong ? ';font-weight:700' : ''}">
    <span class="bar-cat">${esc(label)}</span><span class="bar-amt">${esc(value)}</span>
  </div>`;
}

function personaCardHTML(p) {
  return `<div class="card">
    <div class="card-ttl">${esc(p.entidad)}</div>
    <div style="font-size:11px;font-weight:700;color:var(--gray-d);margin-bottom:6px">Ingresos por cédula</div>
    ${p.cedulas.length ? p.cedulas.map((c) => rowHTML(c.label, c.total_fmt)).join('')
      : '<div class="empty" style="text-align:left">Sin ingresos registrados en el año</div>'}
    ${rowHTML('Total ingresos', p.total_ingresos_fmt, { strong: true })}
    ${rowHTML('Costos deducibles', p.costos_deducibles_fmt)}
    <div style="height:1px;background:var(--gray-m);margin:10px 0"></div>
    <div style="font-size:11px;font-weight:700;color:var(--gray-d);margin-bottom:6px">Patrimonio fiscal a 31-dic</div>
    ${rowHTML('Activo', p.patrimonio.activo_fmt)}
    ${rowHTML('Pasivo', p.patrimonio.pasivo_fmt)}
    ${rowHTML('Neto (activo − pasivo)', p.patrimonio.neto_fmt, { strong: true })}
  </div>`;
}

function anioActual() {
  return String(V('ra-anio').value || new Date().getFullYear());
}

async function load() {
  const msg = V('ra-msg');
  msg.textContent = '';
  V('ra-body').innerHTML = '<div class="proc-wrap" style="min-height:160px"><div class="spin"></div><div class="proc-msg">Cargando…</div></div>';
  try {
    const r = await getRentaAnual({ anio: anioActual() });
    const personas = r.por_persona || [];
    V('ra-body').innerHTML = `
      ${personas.length ? personas.map(personaCardHTML).join('') : '<div class="card"><div class="empty">Sin datos para este año</div></div>'}
      <div class="card"><div class="empty" style="font-size:11px;line-height:1.5;text-align:left">${esc(r.nota || '')}</div></div>`;
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para ver este reporte.'
      : (e.message || 'No se pudo cargar el reporte.');
    msg.style.color = 'var(--red)';
    V('ra-body').innerHTML = '';
  }
}

async function descargar(boton) {
  const msg = V('ra-msg');
  msg.textContent = '';
  boton.disabled = true;
  const anio = anioActual();
  try {
    await descargarCsv('/api/pwa-renta-anual', { anio }, `renta-anual-${anio}.csv`);
    msg.textContent = `✓ Descargado renta-anual-${anio}.csv`;
    msg.style.color = 'var(--green)';
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para descargar el CSV.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  } finally {
    boton.disabled = false;
  }
}

/** Llamado por main.js al navegar a la pantalla de Renta anual. */
export function renderRentaAnual() {
  if (!V('ra-anio').value) V('ra-anio').value = new Date().getFullYear();
  if (!_wired) {
    _wired = true;
    V('scr-renta-anual').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="raActualizar"]')) load();
      if (e.target.closest('[data-act="raDescargar"]')) descargar(e.target.closest('[data-act="raDescargar"]'));
    });
  }
  load();
}
