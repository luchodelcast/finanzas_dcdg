/**
 * ui/apertura.js — Saldos iniciales / asiento de apertura (T3, PWA).
 *
 * Montas el saldo al 1-jul de cada cuenta de ACTIVO (bancos, caja) y PASIVO
 * (tarjetas de crédito). El sistema calcula el patrimonio (capital = activos −
 * pasivos) y guarda un asiento de apertura cuadrado. El punto cero de la
 * contabilidad de partida doble.
 */

import {
  getPlanCuentas, guardarApertura, getApertura, getCatalogos, crearCuentaPlan,
  getCuentasMeta, guardarCuentaMeta,
} from '../services/finanzas.js';
import { formatCOP } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);
const FECHA_APERTURA = '2026-07-01';

const DUENOS = [['comun', 'Común'], ['luis', 'Luis'], ['carolina', 'Carolina']];
const BOLSILLOS = [['comun', 'Común'], ['gasto_individual', 'Gasto individual'], ['patrimonio_individual', 'Patrimonio individual']];

let _wired = false;
let _activos = [];
let _pasivos = [];
let _agregarAbierta = false;
let _cuentasMeta = [];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function filaHTML(c) {
  return `<div class="row2" style="align-items:center;gap:8px">
    <div style="font-size:13px">${esc(c.codigo)} · ${esc(c.nombre)}</div>
    <input type="number" class="ap-monto" data-cuenta="${esc(c.codigo)}" placeholder="0" inputmode="numeric" style="text-align:right">
  </div>`;
}

function recalcular() {
  let activos = 0; let pasivos = 0;
  document.querySelectorAll('#scr-apertura .ap-monto').forEach((inp) => {
    const monto = Number(inp.value) || 0;
    if (_pasivos.some((c) => c.codigo === inp.dataset.cuenta)) pasivos += monto;
    else activos += monto;
  });
  const capital = activos - pasivos;
  V('ap-capital').textContent = `Activos ${formatCOP(activos)} − Pasivos ${formatCOP(pasivos)} = Patrimonio ${formatCOP(capital)}`;
}

function saldos() {
  const out = [];
  document.querySelectorAll('#scr-apertura .ap-monto').forEach((inp) => {
    const monto = Number(inp.value) || 0;
    if (monto) out.push({ cuenta: inp.dataset.cuenta, monto });
  });
  return out;
}

async function guardar() {
  const msg = V('ap-msg');
  const items = saldos();
  if (!items.length) { msg.textContent = 'Ingresa al menos un saldo.'; msg.style.color = 'var(--red)'; return; }
  const entidad_id = V('ap-entidad').value || null;
  msg.textContent = 'Guardando la apertura…'; msg.style.color = 'var(--gray-d)';
  V('btn-save-apertura').disabled = true;
  try {
    const r = await guardarApertura({ entidad_id, fecha: FECHA_APERTURA, saldos: items });
    msg.textContent = r.mensaje || 'Apertura guardada ✅';
    msg.style.color = r.registrado ? 'var(--green)' : 'var(--gold)';
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Tu rol no tiene permiso para montar la apertura.')
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  } finally {
    V('btn-save-apertura').disabled = false;
  }
}

async function checkExistente() {
  const entidad_id = V('ap-entidad').value || null;
  try {
    const r = await getApertura({ entidad_id });
    if (r.apertura) {
      V('ap-msg').textContent = 'Ya hay una apertura para esta entidad (guardar de nuevo no la duplica).';
      V('ap-msg').style.color = 'var(--gold)';
    } else {
      V('ap-msg').textContent = '';
    }
  } catch (_) { /* silencioso */ }
}

async function cargarPlan() {
  const plan = await getPlanCuentas();
  const cuentas = plan.cuentas || [];
  // Cuentas "hoja" de saldo: activos (clase 1) y pasivos (clase 2), sin las cabeceras de 1–2 dígitos.
  const hoja = (c) => String(c.codigo).length >= 4;
  _activos = cuentas.filter((c) => c.clase === 1 && hoja(c));
  _pasivos = cuentas.filter((c) => c.clase === 2 && hoja(c));
  V('ap-activos').innerHTML = _activos.map(filaHTML).join('') || '<div class="empty">Sin cuentas de activo</div>';
  V('ap-pasivos').innerHTML = _pasivos.map(filaHTML).join('') || '<div class="empty">Sin cuentas de pasivo</div>';
  recalcular();
}

function toggleAgregar() {
  _agregarAbierta = !_agregarAbierta;
  V('ap-agregar').style.display = _agregarAbierta ? '' : 'none';
}

async function agregarCuenta() {
  const msg = V('ap-agregar-msg');
  const nombre = V('ap-n-nombre').value.trim();
  if (!nombre) { msg.textContent = 'Ingresa el nombre de la cuenta.'; msg.style.color = 'var(--red)'; return; }
  const clase = Number(V('ap-n-clase').value);
  msg.textContent = 'Agregando…'; msg.style.color = 'var(--gray-d)';
  try {
    const r = await crearCuentaPlan({ clase, nombre });
    V('ap-n-nombre').value = '';
    msg.textContent = `Agregada: ${r.cuenta.codigo} · ${r.cuenta.nombre}`;
    msg.style.color = 'var(--green)';
    await cargarPlan();
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Tu rol no tiene permiso para agregar cuentas.')
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

function opcionesHTML(pares, valorActual) {
  return pares.map(([v, label]) => `<option value="${v}"${v === valorActual ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

function filaCuentaMetaHTML(c) {
  const meta = c.meta || {};
  const puc = meta.cuenta_puc || '';
  const opcionesPuc = ['<option value="">(heurística por nombre)</option>']
    .concat(_activos.concat(_pasivos).map((p) => `<option value="${esc(p.codigo)}"${p.codigo === puc ? ' selected' : ''}>${esc(p.codigo)} · ${esc(p.nombre)}</option>`))
    .join('');
  return `<div class="cm-row" data-nombre="${esc(c.nombre)}" style="border-bottom:1px solid var(--line);padding:8px 0">
    <div style="font-size:13px;font-weight:600">${esc(c.nombre)}</div>
    <div class="row2" style="gap:8px;margin-top:4px">
      <div class="fld"><label>Dueño</label><select class="cm-dueno">${opcionesHTML(DUENOS, meta.dueno || 'comun')}</select></div>
      <div class="fld"><label>Bolsillo</label><select class="cm-bolsillo">${opcionesHTML(BOLSILLOS, meta.bolsillo || 'comun')}</select></div>
    </div>
    <div class="fld" style="margin-top:4px"><label>Cuenta PUC (opcional)</label><select class="cm-puc">${opcionesPuc}</select></div>
    <button class="btn btn-s" data-act="cmGuardar" style="margin-top:6px">✓ Guardar</button>
    <span class="cm-msg" style="font-size:12px;margin-left:8px;font-weight:600"></span>
  </div>`;
}

async function cargarCuentasMeta() {
  try {
    const r = await getCuentasMeta();
    _cuentasMeta = r.cuentas || [];
    V('ap-cuentas-meta').innerHTML = _cuentasMeta.map(filaCuentaMetaHTML).join('') || '<div class="empty">Sin cuentas en el catálogo</div>';
  } catch (e) {
    V('ap-cuentas-meta').innerHTML = `<div class="empty">No se pudo cargar: ${esc(e.message)}</div>`;
  }
}

async function guardarFilaCuentaMeta(fila) {
  const nombre = fila.dataset.nombre;
  const msg = fila.querySelector('.cm-msg');
  msg.textContent = 'Guardando…'; msg.style.color = 'var(--gray-d)';
  try {
    await guardarCuentaMeta({
      nombre,
      dueno: fila.querySelector('.cm-dueno').value,
      bolsillo: fila.querySelector('.cm-bolsillo').value,
      cuenta_puc: fila.querySelector('.cm-puc').value || null,
    });
    msg.textContent = 'Guardado ✅'; msg.style.color = 'var(--green)';
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Tu rol no tiene permiso para editar los metadatos de una cuenta.')
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

/** Llamado por main.js al navegar a la pantalla de saldos iniciales. */
export async function renderApertura() {
  if (!_activos.length && !_pasivos.length) {
    try {
      const [, cat] = await Promise.all([cargarPlan(), getCatalogos()]);
      const ents = (cat.entidades || []).filter((e) => e.tipo === 'persona');
      V('ap-entidad').innerHTML = '<option value="">Familia (sin entidad)</option>'
        + ents.map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('');
      await cargarCuentasMeta();
    } catch (e) {
      V('ap-msg').textContent = 'No se pudo cargar el plan de cuentas: ' + e.message;
      V('ap-msg').style.color = 'var(--red)';
      return;
    }
  }
  if (!_wired) {
    _wired = true;
    V('scr-apertura').addEventListener('input', (e) => { if (e.target.classList.contains('ap-monto')) recalcular(); });
    V('scr-apertura').addEventListener('change', (e) => { if (e.target.id === 'ap-entidad') checkExistente(); });
    V('scr-apertura').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="saveApertura"]')) guardar();
      else if (e.target.closest('[data-act="apToggleAgregar"]')) toggleAgregar();
      else if (e.target.closest('[data-act="apAgregarCuenta"]')) agregarCuenta();
      else if (e.target.closest('[data-act="cmGuardar"]')) guardarFilaCuentaMeta(e.target.closest('.cm-row'));
    });
  }
  recalcular();
  checkExistente();
}
