/**
 * ui/extractos.js — Cargador de extractos bancarios en CSV (PWA).
 *
 * Primer paso de la conciliación (docs/conciliacion.md): sube un CSV de
 * extracto (fecha, descripción, monto) de una cuenta/periodo y lo guarda vía
 * el backend. Sin motor de cruce todavía; solo deja los datos cargados y
 * visibles.
 */

import { getExtractos, subirExtracto } from '../services/finanzas.js';
import { getCuentasDinamicas, NOMBRES_CUENTAS } from '../config/accounts.js';

const V = (id) => document.getElementById(id);

let _wired = false;
let _csvText = '';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function cuentaOptionsHTML() {
  const dinamicas = getCuentasDinamicas();
  const nombres = (dinamicas.length ? dinamicas.map((c) => c.name) : NOMBRES_CUENTAS).filter(Boolean);
  return nombres.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
}

function itemHTML(e) {
  const rango = [e.fecha_desde, e.fecha_hasta].filter(Boolean).map((f) => String(f).slice(0, 10)).join(' → ');
  return `<div class="h-item">
    <div><div class="h-name">${esc(e.cuenta)}</div><div class="h-meta">${esc(e.periodo || rango || '—')} · ${e.n_lineas} línea${e.n_lineas === 1 ? '' : 's'}</div></div>
    <div><div class="h-who">${esc(e.estado)}</div></div>
  </div>`;
}

async function refreshList() {
  try {
    const r = await getExtractos();
    const extractos = r.extractos || [];
    V('extracto-list').innerHTML = extractos.length
      ? extractos.map(itemHTML).join('')
      : '<div class="empty">Aún no hay extractos cargados</div>';
  } catch (e) {
    V('extracto-list').innerHTML = `<div class="empty" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

function onFile(input) {
  const f = input.files[0];
  input.value = '';
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    _csvText = String(reader.result || '');
    V('extracto-file-name').textContent = f.name;
  };
  reader.onerror = () => {
    V('extracto-msg').textContent = 'No se pudo leer el archivo.';
    V('extracto-msg').style.color = 'var(--red)';
  };
  reader.readAsText(f);
}

async function subir() {
  const msg = V('extracto-msg');
  const cuenta = V('ex-cuenta').value;
  if (!cuenta) { msg.textContent = 'Selecciona la cuenta.'; msg.style.color = 'var(--red)'; return; }
  if (!_csvText.trim()) { msg.textContent = 'Elige un archivo CSV primero.'; msg.style.color = 'var(--red)'; return; }

  const body = { cuenta, csv: _csvText, periodo: V('ex-periodo').value.trim() };
  msg.textContent = 'Cargando…'; msg.style.color = 'var(--gray-d)';
  V('btn-save-extracto').disabled = true;
  try {
    const r = await subirExtracto(body);
    msg.textContent = r.mensaje || 'Extracto cargado ✅';
    msg.style.color = r.errores && r.errores.length ? 'var(--gold)' : 'var(--green)';
    _csvText = '';
    V('extracto-file-name').textContent = '';
    V('ex-periodo').value = '';
    await refreshList();
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (usuario autorizado) para cargar el extracto.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  } finally {
    V('btn-save-extracto').disabled = false;
  }
}

/** Llamado por main.js al navegar a la pantalla de extractos. */
export async function renderExtractos() {
  V('ex-cuenta').innerHTML = cuentaOptionsHTML();
  if (!_wired) {
    _wired = true;
    V('ex-file-in').addEventListener('change', function () { onFile(this); });
    V('scr-extractos').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="subirExtracto"]')) subir();
      if (e.target.closest('[data-act="trigExtractoFile"]')) V('ex-file-in').click();
    });
  }
  refreshList();
}
