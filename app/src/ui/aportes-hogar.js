/**
 * ui/aportes-hogar.js — Fondo común del hogar (issue #113, Contab. familiar A).
 *
 * Reporte del mes (quién aportó cuánto, su cuota proporcional según ingreso y
 * el % cumplido) + formulario para registrar un aporte nuevo (solo owners).
 */

import { getAportesHogar, registrarAporteHogar, getCatalogos, getCuentas } from '../services/finanzas.js';
import { hoyISO } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);

let _wired = false;
let _catalogosCargados = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function rowHTML(label, value, { strong = false } = {}) {
  return `<div class="bar-head" style="margin-bottom:8px${strong ? ';font-weight:700' : ''}">
    <span class="bar-cat">${esc(label)}</span><span class="bar-amt">${esc(value)}</span>
  </div>`;
}

function personaCardHTML(p) {
  const pct = p.pct_cumplido == null ? '—' : `${p.pct_cumplido}%`;
  return `<div class="card">
    <div class="card-ttl">${esc(p.entidad)}</div>
    ${rowHTML('Ingreso del mes', p.ingreso_fmt)}
    ${rowHTML('% del ingreso familiar', `${p.proporcion_ingreso}%`)}
    <div style="height:1px;background:var(--gray-m);margin:10px 0"></div>
    ${rowHTML('Aportado al fondo', p.aportado_fmt, { strong: true })}
    ${rowHTML('Cuota sugerida', p.cuota_sugerida_fmt)}
    ${rowHTML('% cumplido', pct, { strong: true })}
  </div>`;
}

function aporteFilaHTML(a) {
  return `<div class="row2" style="padding:6px 0;border-bottom:1px solid var(--gray);font-size:13px">
    <div>${esc(String(a.fecha || '').slice(0, 10))}${a.metodo_pago ? ` · ${esc(a.metodo_pago)}` : ''}</div>
    <div style="font-weight:600">${esc(a.monto_fmt)}</div>
  </div>`;
}

async function cargarReporte() {
  const msg = V('ah-msg');
  msg.textContent = '';
  try {
    const r = await getAportesHogar();
    const personas = r.por_persona || [];
    V('ah-reporte').innerHTML = personas.length
      ? personas.map(personaCardHTML).join('')
      : '<div class="empty">Sin entidades tipo persona</div>';
    const aportes = r.aportes || [];
    V('ah-lista').innerHTML = aportes.length
      ? aportes.map(aporteFilaHTML).join('')
      : '<div class="empty">Sin aportes registrados este mes</div>';
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para ver el reporte.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

async function cargarCatalogos() {
  if (_catalogosCargados) return;
  try {
    const [cat, cuentas] = await Promise.all([getCatalogos(), getCuentas()]);
    const personas = (cat.entidades || []).filter((e) => e.tipo === 'persona');
    V('ah-n-entidad').innerHTML = personas.map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('');
    const lista = cuentas.cuentas || [];
    V('ah-n-metodo').innerHTML = '<option value="">(elegir cuenta de origen)</option>'
      + lista.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    _catalogosCargados = true;
  } catch (_) { /* el formulario queda con los selects vacíos; se reintenta al reabrir */ }
}

async function registrar() {
  const msg = V('ah-n-msg');
  const entidad_id = V('ah-n-entidad').value;
  const monto = Number(V('ah-n-monto').value);
  if (!entidad_id) { msg.textContent = 'Elige quién aporta.'; msg.style.color = 'var(--red)'; return; }
  if (!(monto > 0)) { msg.textContent = 'Ingresa un monto mayor a 0.'; msg.style.color = 'var(--red)'; return; }
  const body = {
    entidad_id: Number(entidad_id),
    fecha: V('ah-n-fecha').value || hoyISO(),
    monto,
    metodo_pago: V('ah-n-metodo').value || null,
    notas: V('ah-n-notas').value.trim() || null,
  };
  msg.textContent = 'Guardando…'; msg.style.color = 'var(--gray-d)';
  try {
    const r = await registrarAporteHogar(body);
    msg.textContent = r.mensaje || 'Aporte registrado ✅';
    msg.style.color = 'var(--green)';
    V('ah-n-monto').value = '';
    V('ah-n-notas').value = '';
    await cargarReporte();
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Solo Luis o Carolina pueden registrar aportes al fondo común.')
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

/** Llamado por main.js al navegar a la pantalla de Aportes al hogar. */
export async function renderAportesHogar() {
  V('ah-n-fecha').value = hoyISO();
  await cargarCatalogos();
  await cargarReporte();
  if (!_wired) {
    _wired = true;
    V('scr-aportes-hogar').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="ahRegistrar"]')) registrar();
    });
  }
}
