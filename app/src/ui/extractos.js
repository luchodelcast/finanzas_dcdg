/**
 * ui/extractos.js — Cargador de extractos bancarios (CSV o PDF) en la PWA.
 *
 * Primer paso de la conciliación (docs/conciliacion.md): sube un extracto de
 * una cuenta/periodo y lo guarda vía el backend.
 *  - CSV: se manda el texto tal cual; el backend lo parsea.
 *  - PDF (p. ej. Bancolombia, protegido con contraseña = cédula/NIT): se
 *    descifra y extrae el texto EN EL NAVEGADOR (la contraseña nunca sale del
 *    dispositivo); al backend solo va el texto, que Claude estructura.
 */

import { getExtractos, subirExtracto } from '../services/finanzas.js';
import { getCuentasDinamicas, NOMBRES_CUENTAS } from '../config/accounts.js';

const V = (id) => document.getElementById(id);
const PASS_KEY = 'dcdg_ext_pass'; // solo en este equipo, si el usuario lo pide

let _wired = false;
let _csvText = '';        // contenido si es CSV
let _pdfBuffer = null;    // ArrayBuffer si es PDF
let _fileName = '';

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

function showPass(show) {
  V('ex-pass-wrap').style.display = show ? '' : 'none';
}

function onFile(input) {
  const f = input.files[0];
  input.value = '';
  _csvText = '';
  _pdfBuffer = null;
  _fileName = '';
  if (!f) { V('extracto-file-name').textContent = ''; showPass(false); return; }
  _fileName = f.name;
  V('extracto-file-name').textContent = f.name;
  const esPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';

  const reader = new FileReader();
  reader.onerror = () => {
    V('extracto-msg').textContent = 'No se pudo leer el archivo.';
    V('extracto-msg').style.color = 'var(--red)';
  };
  if (esPdf) {
    showPass(true);
    reader.onload = () => { _pdfBuffer = reader.result; };
    reader.readAsArrayBuffer(f);
  } else {
    showPass(false);
    reader.onload = () => { _csvText = String(reader.result || ''); };
    reader.readAsText(f);
  }
}

async function subir() {
  const msg = V('extracto-msg');
  const cuenta = V('ex-cuenta').value;
  if (!cuenta) { msg.textContent = 'Selecciona la cuenta.'; msg.style.color = 'var(--red)'; return; }
  if (!_csvText.trim() && !_pdfBuffer) { msg.textContent = 'Elige un archivo (CSV o PDF) primero.'; msg.style.color = 'var(--red)'; return; }

  const body = { cuenta, periodo: V('ex-periodo').value.trim() };
  V('btn-save-extracto').disabled = true;
  try {
    if (_pdfBuffer) {
      // PDF: descifrar + extraer texto EN EL NAVEGADOR con la contraseña.
      const pass = V('ex-pass').value.trim();
      if (!pass) { msg.textContent = 'Escribe la contraseña del PDF (cédula del titular / NIT).'; msg.style.color = 'var(--red)'; return; }
      if (V('ex-pass-remember').checked) { try { localStorage.setItem(PASS_KEY, pass); } catch (_) { /* ignore */ } }
      else { try { localStorage.removeItem(PASS_KEY); } catch (_) { /* ignore */ } }
      msg.textContent = 'Leyendo el PDF en tu dispositivo…'; msg.style.color = 'var(--gray-d)';
      const { extractTextFromPdf } = await import('../utils/pdfExtract.js');
      const texto = await extractTextFromPdf(_pdfBuffer, pass);
      if (!texto.trim()) { msg.textContent = 'El PDF no tiene texto legible (¿es un escaneo/imagen?).'; msg.style.color = 'var(--red)'; return; }
      msg.textContent = 'Interpretando las transacciones…'; msg.style.color = 'var(--gray-d)';
      body.texto = texto;
    } else {
      msg.textContent = 'Cargando…'; msg.style.color = 'var(--gray-d)';
      body.csv = _csvText;
    }

    const r = await subirExtracto(body);
    msg.textContent = r.mensaje || 'Extracto cargado ✅';
    msg.style.color = r.errores && r.errores.length ? 'var(--gold)' : 'var(--green)';
    _csvText = ''; _pdfBuffer = null; _fileName = '';
    V('extracto-file-name').textContent = '';
    V('ex-periodo').value = '';
    showPass(false);
    await refreshList();
  } catch (e) {
    if (e && e.code === 'BAD_PASSWORD') {
      msg.textContent = e.message;
    } else {
      msg.textContent = (e.status === 401 || e.status === 403)
        ? 'Inicia sesión con Google (usuario autorizado) para cargar el extracto.'
        : 'Error: ' + e.message;
    }
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
    try { const saved = localStorage.getItem(PASS_KEY); if (saved) { V('ex-pass').value = saved; V('ex-pass-remember').checked = true; } } catch (_) { /* ignore */ }
    V('ex-file-in').addEventListener('change', function () { onFile(this); });
    V('scr-extractos').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="subirExtracto"]')) subir();
      if (e.target.closest('[data-act="trigExtractoFile"]')) V('ex-file-in').click();
    });
  }
  refreshList();
}
