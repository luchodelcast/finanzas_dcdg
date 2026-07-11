/**
 * ui/solicitudes.js — Solicitudes de mejoras desde la PWA (issue #78, Nocturno 7/7).
 *
 * Pídele una mejora al sistema (igual que Luis se las pide a SilvIA con
 * "agrega al backlog"): un textarea + botón crea un issue de GitHub con label
 * `autobuild` para que Autobuild la construya en una corrida futura. Debajo,
 * la lista de solicitudes/propuestas abiertas.
 */

import { getSolicitudes, crearSolicitud } from '../services/finanzas.js';

const V = (id) => document.getElementById(id);

let _wired = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function filaSolicitudHTML(s) {
  return `<div class="h-item">
    <div><div class="h-name"><a href="${esc(s.url)}" target="_blank" rel="noopener">#${esc(s.number)} ${esc(s.title)}</a></div></div>
  </div>`;
}

async function cargar() {
  try {
    const r = await getSolicitudes();
    if (!r.configurado) {
      V('sol-lista').innerHTML = `<div class="empty">${esc(r.mensaje || 'Configura GITHUB_TOKEN_FINANZAS para ver las solicitudes abiertas.')}</div>`;
      return;
    }
    const solicitudes = r.solicitudes || [];
    V('sol-lista').innerHTML = solicitudes.map(filaSolicitudHTML).join('') || '<div class="empty">Sin solicitudes abiertas</div>';
  } catch (e) {
    V('sol-lista').innerHTML = `<div class="empty" style="color:var(--red)">Error: ${esc(e.message)}</div>`;
  }
}

async function enviar() {
  const msg = V('sol-msg');
  const texto = V('sol-texto').value.trim();
  if (!texto) { msg.textContent = 'Escribe qué te gustaría que el sistema pudiera hacer.'; msg.style.color = 'var(--red)'; return; }
  msg.textContent = 'Enviando…'; msg.style.color = 'var(--gray-d)';
  try {
    const r = await crearSolicitud({ texto });
    V('sol-texto').value = '';
    msg.textContent = `✓ Enviado: #${r.issue.number}`;
    msg.style.color = 'var(--green)';
    await cargar();
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Tu rol no tiene permiso para enviar solicitudes de mejoras.')
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

/** Llamado por main.js al navegar a la pantalla de Solicitudes de mejoras. */
export async function renderSolicitudes() {
  await cargar();
  if (!_wired) {
    _wired = true;
    V('scr-solicitudes').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="solEnviar"]')) enviar();
    });
  }
}
