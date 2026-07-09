/**
 * ui/cierre-mes.js — "Cierre del mes" (issue #118, Contab. familiar G).
 *
 * Ritual mensual de revisión de la pareja: en una pantalla, ingresos y
 * aportes al fondo común por persona (reusa #113), su patrimonio y variación
 * vs. el mes anterior (reusa #115), y metas si ya están disponibles (#117).
 * Solo lectura, consolida lo que ya calculan esos módulos.
 */

import { getCierreMes, enviarResumenCierreMes } from '../services/finanzas.js';
import { formatCOP } from '../utils/formatters.js';

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

function variacionTexto(v) {
  if (v == null) return '—';
  const signo = v > 0 ? '↑ +' : v < 0 ? '↓ ' : '';
  return `${signo}${formatCOP(v)}`;
}

function personaCardHTML(p) {
  return `<div class="card">
    <div class="card-ttl">${esc(p.entidad)}</div>
    ${rowHTML('Ingreso del mes', p.ingreso_fmt)}
    ${rowHTML('Aportó al fondo común', p.aportado_fmt)}
    ${rowHTML('Cuota sugerida', p.cuota_sugerida_fmt)}
    ${rowHTML('% cumplido', p.pct_cumplido == null ? '—' : `${p.pct_cumplido}%`)}
    ${rowHTML('Patrimonio neto', p.patrimonio_neto_fmt || '—', { strong: true })}
    ${rowHTML('Vs. mes anterior', variacionTexto(p.variacion_patrimonio))}
  </div>`;
}

function comunHTML(comun, consolidado) {
  return `<div class="card">
    <div class="card-ttl">Común y consolidado</div>
    ${rowHTML('Fondo común / bolsillo Común', formatCOP(comun.neto))}
    ${rowHTML('Consolidado familiar', formatCOP(consolidado.neto), { strong: true })}
  </div>`;
}

async function cargar() {
  const msg = V('cm-msg');
  msg.textContent = '';
  V('cm-body').innerHTML = '<div class="empty">Cargando…</div>';
  V('cm-comun-body').innerHTML = '';
  V('cm-metas-msg').textContent = '';
  try {
    const periodo = (V('cm-periodo').value || '').trim() || undefined;
    const r = await getCierreMes({ periodo });
    V('cm-body').innerHTML = (r.por_persona || []).map(personaCardHTML).join('')
      || '<div class="empty">Sin personas registradas todavía</div>';
    V('cm-comun-body').innerHTML = comunHTML(r.comun, r.consolidado);
    if (r.nota) V('cm-metas-msg').textContent = r.nota;
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para ver el cierre del mes.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
    V('cm-body').innerHTML = '';
  }
}

async function enviarResumen() {
  const msg = V('cm-enviar-msg');
  msg.textContent = 'Enviando…';
  msg.style.color = 'var(--gray-d)';
  try {
    const periodo = (V('cm-periodo').value || '').trim() || undefined;
    const r = await enviarResumenCierreMes({ periodo });
    if (r.enviado) {
      msg.textContent = 'Resumen enviado ✅';
      msg.style.color = 'var(--green, #2f7a63)';
    } else {
      msg.textContent = r.motivo || 'No se pudo enviar (SilvIA no está configurada).';
      msg.style.color = 'var(--gray-d)';
    }
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

/** Llamado por main.js al navegar a la pantalla de Cierre del mes. */
export async function renderCierreMes() {
  await cargar();
  if (!_wired) {
    _wired = true;
    V('scr-cierre-mes').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="cmActualizar"]')) cargar();
      if (e.target.closest('[data-act="cmEnviar"]')) enviarResumen();
    });
  }
}
