/**
 * ui/metas.js — Metas financieras (issue #117, Contab. familiar E).
 *
 * Lista de metas con barra de progreso (saldo actual de su(s) cuenta(s) de
 * respaldo vs. monto objetivo) + formulario para crear una meta nueva (solo
 * owners). Metas semilla (Fondo de emergencia, Retiro, Educación de los
 * hijos, Pensión de Carolina) se crean solas la primera vez que se abre esta
 * pantalla.
 */
import { getMetas, crearMeta, getPlanCuentas } from '../services/finanzas.js';

const V = (id) => document.getElementById(id);

const ETIQUETA_CATEGORIA = {
  emergencia: '🆘 Emergencia',
  retiro: '🏖️ Retiro',
  educacion: '🎓 Educación',
  pension_carolina: '👵 Pensión de Carolina',
  otra: '🎯 Otra',
};

let _wired = false;
let _catalogosCargados = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function metaCardHTML(m) {
  const pct = m.pct_avance == null ? 0 : m.pct_avance;
  const color = m.cumplida ? 'var(--green)' : 'var(--primary)';
  const etiqueta = ETIQUETA_CATEGORIA[m.categoria] || ETIQUETA_CATEGORIA.otra;
  const fecha = m.fecha_objetivo ? ` · para ${String(m.fecha_objetivo).slice(0, 10)}` : '';
  return `<div class="card">
    <div class="bar-head"><span class="bar-cat">${esc(etiqueta)} ${esc(m.nombre)}${fecha}</span>
      <span class="bar-amt">${m.pct_avance == null ? '—' : m.pct_avance + '%'}</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
    <div class="bar-head" style="margin-top:8px">
      <span class="bar-cat">${esc(m.saldo_actual_fmt)} de ${esc(m.monto_objetivo_fmt)}</span>
      ${m.cumplida ? '<span class="bar-amt" style="color:var(--green)">✓ Cumplida</span>' : ''}
    </div>
    ${!String(m.cuentas_puc || '').trim() ? '<div style="font-size:12px;color:var(--gray-d);margin-top:4px">Sin cuenta de respaldo vinculada — el saldo se mantiene en 0.</div>' : ''}
  </div>`;
}

async function cargarLista() {
  const msg = V('mt-msg');
  msg.textContent = '';
  try {
    const r = await getMetas();
    const metas = r.metas || [];
    V('mt-lista').innerHTML = metas.length
      ? metas.map(metaCardHTML).join('')
      : '<div class="empty">Sin metas todavía</div>';
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para ver las metas.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

async function cargarCatalogos() {
  if (_catalogosCargados) return;
  V('mt-n-categoria').innerHTML = Object.entries(ETIQUETA_CATEGORIA)
    .map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join('');
  try {
    const r = await getPlanCuentas({ clase: 1 });
    const activos = (r.cuentas || []).filter((c) => String(c.codigo).length >= 4);
    V('mt-n-cuentas').innerHTML = activos.map((c) => `<option value="${esc(c.codigo)}">${esc(c.codigo)} · ${esc(c.nombre)}</option>`).join('');
    _catalogosCargados = true;
  } catch (_) { /* el formulario queda sin opciones de cuenta; se reintenta al reabrir */ }
}

async function crear() {
  const msg = V('mt-n-msg');
  const nombre = V('mt-n-nombre').value.trim();
  const monto_objetivo = Number(V('mt-n-monto').value);
  if (!nombre) { msg.textContent = 'Ponle un nombre a la meta.'; msg.style.color = 'var(--red)'; return; }
  if (!(monto_objetivo > 0)) { msg.textContent = 'Ingresa un monto objetivo mayor a 0.'; msg.style.color = 'var(--red)'; return; }
  const cuentas_puc = Array.from(V('mt-n-cuentas').selectedOptions).map((o) => o.value).join(',');
  const body = {
    nombre,
    categoria: V('mt-n-categoria').value,
    monto_objetivo,
    fecha_objetivo: V('mt-n-fecha').value || null,
    cuentas_puc,
    notas: V('mt-n-notas').value.trim() || null,
  };
  msg.textContent = 'Guardando…'; msg.style.color = 'var(--gray-d)';
  try {
    const r = await crearMeta(body);
    msg.textContent = r.mensaje || 'Meta creada ✅';
    msg.style.color = 'var(--green)';
    V('mt-n-nombre').value = '';
    V('mt-n-monto').value = '';
    V('mt-n-notas').value = '';
    V('mt-n-fecha').value = '';
    await cargarLista();
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Solo Luis o Carolina pueden crear metas.')
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

/** Llamado por main.js al navegar a la pantalla de Metas. */
export async function renderMetas() {
  await cargarCatalogos();
  await cargarLista();
  if (!_wired) {
    _wired = true;
    V('scr-metas').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="mtCrear"]')) crear();
    });
  }
}
