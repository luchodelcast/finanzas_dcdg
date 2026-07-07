/**
 * ui/conciliacion.js — Pantalla de conciliación (fase 2 de docs/conciliacion.md,
 * issue #39). Junto al 🧾 de extractos: elige un extracto ya cargado, pide al
 * backend que PROPONGA cruces contra lo capturado (`movimientos`/`ingresos`
 * `provisional`) y deja que el usuario revise y confirme antes de escribir
 * `conciliado`. Nada se concilia sin esa confirmación explícita.
 *
 * Tres casos por línea (ver _lib/conciliacion.js):
 *  - match     → un solo candidato compatible → botón "Confirmar cruce".
 *  - ambiguo   → más de un candidato → el usuario elige cuál con un <select>
 *                antes de poder confirmar (nunca se auto-resuelve).
 *  - solo_extracto → nada capturado matchea → informativo (el usuario debe
 *                registrar el gasto/ingreso faltante desde las pantallas
 *                normales; este endpoint no lo crea automáticamente).
 */

import { getExtractos, getPropuestasConciliacion, confirmarCruce } from '../services/finanzas.js';
import { formatCOP } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);

let _wired = false;
let _extractoId = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function extractoOptionsHTML(extractos, seleccionado) {
  if (!extractos.length) return '<option value="">Sin extractos cargados</option>';
  return extractos.map((e) => {
    const rango = [e.fecha_desde, e.fecha_hasta].filter(Boolean).map((f) => String(f).slice(0, 10)).join(' → ');
    const label = `${e.cuenta} · ${e.periodo || rango || '—'} (${e.n_lineas} línea${e.n_lineas === 1 ? '' : 's'})`;
    const sel = String(e.id) === String(seleccionado) ? ' selected' : '';
    return `<option value="${e.id}"${sel}>${esc(label)}</option>`;
  }).join('');
}

const CASO_LABEL = {
  match: '✓ cruce propuesto',
  ambiguo: '⚠ ambiguo — elige uno',
  solo_extracto: '— sin capturado',
};
const CASO_COLOR = {
  match: 'var(--green)',
  ambiguo: 'var(--gold)',
  solo_extracto: 'var(--gray-d)',
};

function candidatoLabel(c) {
  const fecha = String(c.fecha || '').slice(0, 10);
  return `${fecha} · ${c.descripcion || '(sin descripción)'} · ${formatCOP(Math.abs(Number(c.monto) || 0))}`;
}

function propuestaHTML(p) {
  const fecha = String(p.fecha || '').slice(0, 10);
  const monto = formatCOP(Math.abs(Number(p.monto) || 0));
  const caso = p.caso;
  let accion = '';

  if (caso === 'match') {
    const c = p.candidatos[0];
    accion = `
      <div class="h-meta" style="margin-top:4px">↔ ${esc(candidatoLabel(c))}</div>
      <button class="btn btn-p" style="margin-top:8px;padding:8px 14px;font-size:13px"
        data-act="confirmarCruce" data-linea="${p.linea_id}" data-tipo="${c.tipo}" data-id="${c.id}">
        ✓ Confirmar cruce
      </button>`;
  } else if (caso === 'ambiguo') {
    const opts = p.candidatos.map((c, i) =>
      `<option value="${c.tipo}:${c.id}"${i === 0 ? ' selected' : ''}>${esc(candidatoLabel(c))}</option>`
    ).join('');
    accion = `
      <div class="fld" style="margin-top:6px"><label>${p.candidatos.length} candidatos posibles — elige el correcto</label>
        <select data-amb-sel="${p.linea_id}">${opts}</select></div>
      <button class="btn btn-p" style="margin-top:6px;padding:8px 14px;font-size:13px"
        data-act="confirmarCruceAmbiguo" data-linea="${p.linea_id}">
        ✓ Confirmar cruce elegido
      </button>`;
  } else {
    accion = `<div class="h-meta" style="margin-top:4px">El banco registró esto pero no hay nada capturado que coincida. Regístralo manualmente si hace falta (💵 ingreso o el flujo normal de gasto).</div>`;
  }

  return `<div class="h-item" style="flex-direction:column;align-items:stretch;gap:2px">
    <div style="display:flex;justify-content:space-between">
      <div><div class="h-name">${esc(p.descripcion || '(sin descripción)')}</div><div class="h-meta">${esc(fecha)} · ${p.tipo_linea}</div></div>
      <div style="text-align:right"><div class="h-amt">${monto}</div>
        <div class="h-who" style="color:${CASO_COLOR[caso] || 'inherit'}">${CASO_LABEL[caso] || caso}</div></div>
    </div>
    ${accion}
  </div>`;
}

async function cargarExtractos(seleccionar) {
  const r = await getExtractos();
  const extractos = r.extractos || [];
  V('conc-extracto').innerHTML = extractoOptionsHTML(extractos, seleccionar);
  if (extractos.length && !seleccionar) _extractoId = extractos[0].id;
}

async function refreshPropuestas() {
  const sel = V('conc-extracto').value;
  _extractoId = sel ? Number(sel) : null;
  const msg = V('conc-msg');
  const list = V('conc-list');
  msg.textContent = '';
  if (!_extractoId) { list.innerHTML = '<div class="empty">Elige un extracto</div>'; return; }
  list.innerHTML = '<div class="empty">Cargando propuestas…</div>';
  try {
    const r = await getPropuestasConciliacion(_extractoId);
    const props = r.propuestas || [];
    const res = r.resumen || {};
    V('conc-resumen').textContent = props.length
      ? `${res.n_match || 0} propuesta(s) · ${res.n_ambiguo || 0} ambigua(s) · ${res.n_solo_extracto || 0} sin capturado`
      : (res.n_sin_conciliar === 0 ? 'Todas las líneas de este extracto ya están conciliadas.' : '');
    list.innerHTML = props.length
      ? props.map(propuestaHTML).join('')
      : '<div class="empty">Nada pendiente de revisar en este extracto.</div>';
  } catch (e) {
    list.innerHTML = `<div class="empty" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

async function confirmar(linea_id, tipo, id) {
  const msg = V('conc-msg');
  msg.textContent = 'Confirmando…'; msg.style.color = 'var(--gray-d)';
  try {
    const r = await confirmarCruce({ linea_id: Number(linea_id), tipo, id: Number(id) });
    msg.textContent = r.mensaje || 'Cruce confirmado ✅';
    msg.style.color = 'var(--green)';
    await refreshPropuestas();
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (usuario autorizado) para confirmar.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

function confirmarAmbiguo(linea_id) {
  const sel = document.querySelector(`[data-amb-sel="${linea_id}"]`);
  if (!sel || !sel.value) return;
  const [tipo, id] = sel.value.split(':');
  confirmar(linea_id, tipo, id);
}

/** Llamado por main.js al navegar a la pantalla de conciliación. */
export async function renderConciliacion() {
  if (!_wired) {
    _wired = true;
    V('scr-conciliacion').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="confirmarCruce"]');
      if (btn) confirmar(btn.dataset.linea, btn.dataset.tipo, btn.dataset.id);
      const btnAmb = e.target.closest('[data-act="confirmarCruceAmbiguo"]');
      if (btnAmb) confirmarAmbiguo(btnAmb.dataset.linea);
    });
    V('conc-extracto').addEventListener('change', refreshPropuestas);
  }
  await cargarExtractos(_extractoId);
  refreshPropuestas();
}
