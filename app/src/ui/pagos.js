/**
 * ui/pagos.js — Pagos del mes: qué se ha pagado y qué falta (issue #73,
 * Nocturno 2/7). Espejo del "Pagos Fijos" del Excel de Luis: cada pago fijo
 * del mes en curso con su estado (pagado/pendiente/vencido), separado por
 * familia (DCDG/DCC), más los pendientes del mes anterior y la gestión del
 * catálogo (agregar/editar/desactivar).
 */

import {
  getPagosDelMes, getHistorialPagos, marcarPagoFijo, desmarcarPagoFijo, crearPagoFijo, editarPagoFijo,
} from '../services/finanzas.js';
import { formatCOP } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);

let _wired = false;
let _anio = null;
let _mes = null;
let _gestionAbierta = false;
let _pagos = []; // último catálogo cargado (para prellenar el monto al marcar)

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const ICONO_ESTADO = { pagado: '✅', pendiente: '⏳', vencido: '🔴' };
const ASUMIDO_POR_OPCIONES = ['LADCC', 'CMDG', 'Común'];

const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function filaPagoHTML(p, { navPrev = false } = {}) {
  const icono = ICONO_ESTADO[p.estado] || '⏳';
  // En la sección "pendientes del mes pasado" el botón NO marca (marcaría el mes
  // mostrado, no el correcto): lleva a ese mes para pagarlo con su periodo real.
  const accion = navPrev
    ? `<button class="btn btn-s" data-act="pgIrMesPrev" style="padding:4px 10px;font-size:12px">Ir a pagar →</button>`
    : (p.estado === 'pagado'
      ? `<button class="btn btn-s" data-act="pgDesmarcar" data-id="${p.id}" style="padding:4px 10px;font-size:12px">Desmarcar</button>`
      : `<button class="btn btn-p" data-act="pgMarcar" data-id="${p.id}" style="padding:4px 10px;font-size:12px">Marcar pagado</button>`);
  // En un pago ya marcado se muestra lo REALMENTE pagado (monto_pagado); si aún
  // no se registró un valor real, se muestra el presupuesto. Cuando el real
  // difiere del presupuesto se anota el presupuesto en pequeño como referencia.
  const pagadoReal = p.estado === 'pagado' && p.monto_pagado != null ? Number(p.monto_pagado) : null;
  const montoMostrar = pagadoReal != null ? pagadoReal : Number(p.monto) || 0;
  const refPtto = pagadoReal != null && pagadoReal !== (Number(p.monto) || 0)
    ? `<div style="font-size:11px;color:var(--gray-d)">ptto ${formatCOP(p.monto)}</div>` : '';
  return `<div class="row2" style="align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--gray)">
    <div style="font-size:13px">${icono} ${esc(p.concepto)} <span style="color:var(--gray-d)">· vence día ${esc(p.dia_vencimiento)} · ${esc(p.asumido_por || 'Común')}</span></div>
    <div style="display:flex;align-items:center;gap:8px">
      <div style="text-align:right"><span style="font-weight:600">${formatCOP(montoMostrar)}</span>${refPtto}</div>
      ${accion}
    </div>
  </div>`;
}

function grupoHTML(titulo, pagos) {
  if (!pagos.length) return '';
  return `<div style="margin-top:10px"><div style="font-weight:700;font-size:12px;color:var(--gray-d);margin-bottom:4px">${esc(titulo)}</div>${pagos.map((p) => filaPagoHTML(p)).join('')}</div>`;
}

function filaGestionHTML(p) {
  // Bloque vertical con los campos etiquetados (Monto / Día de vencimiento) y una
  // fila que envuelve (flex-wrap) para que en móvil nada se salga de la vista.
  const asumido = p.asumido_por || 'Común';
  const opcionesAsumido = ASUMIDO_POR_OPCIONES
    .map((o) => `<option value="${o}"${o === asumido ? ' selected' : ''}>${o}</option>`).join('');
  return `<div style="padding:10px 0;border-bottom:1px solid var(--gray)${p.activo ? '' : ';opacity:.5'}">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">${esc(p.concepto)} <span style="color:var(--gray-d);font-weight:400">(${esc(p.familia)})</span></div>
    <div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px">
      <label style="font-size:11px;color:var(--gray-d);display:flex;flex-direction:column;gap:2px">Monto ($)
        <input type="number" class="pg-e-monto" data-id="${p.id}" value="${p.monto}" style="width:120px;text-align:right" inputmode="numeric"></label>
      <label style="font-size:11px;color:var(--gray-d);display:flex;flex-direction:column;gap:2px">Día de vencimiento
        <input type="number" class="pg-e-dia" data-id="${p.id}" value="${p.dia_vencimiento}" style="width:80px;text-align:right" min="1" max="31"></label>
      <label style="font-size:11px;color:var(--gray-d);display:flex;flex-direction:column;gap:2px">Asumido por
        <select class="pg-e-asumido" data-id="${p.id}">${opcionesAsumido}</select></label>
      <button class="btn btn-p" data-act="pgGuardarEdicion" data-id="${p.id}" style="padding:7px 12px;font-size:12px">Guardar</button>
      <button class="btn btn-s" data-act="pgToggleActivo" data-id="${p.id}" data-activo="${p.activo}" style="padding:7px 12px;font-size:12px">${p.activo ? 'Desactivar' : 'Activar'}</button>
    </div>
  </div>`;
}

function resumenHTML(r) {
  const linea1 = `Presupuestado ${formatCOP(r.total_presupuestado)} · Pagado ${formatCOP(r.total_pagado)}`
    + ` · Pendiente ${formatCOP(r.total_pendiente)}${r.n_vencidos ? ` (${r.n_vencidos} vencido${r.n_vencidos === 1 ? '' : 's'})` : ''}`;
  const porAsumido = r.por_asumido || {};
  const desglose = ASUMIDO_POR_OPCIONES
    .filter((o) => porAsumido[o] && porAsumido[o].total_presupuestado > 0)
    .map((o) => `${esc(o)} ${formatCOP(porAsumido[o].total_presupuestado)}`)
    .join(' · ');
  return desglose
    ? `${linea1}<div style="color:var(--gray-d);margin-top:2px">Por quién asume: ${desglose}</div>`
    : linea1;
}

async function cargar() {
  const msg = V('pg-msg');
  msg.textContent = '';
  try {
    const r = await getPagosDelMes({ anio: _anio, mes: _mes });
    V('pg-periodo').textContent = `${MESES[_mes]} ${_anio}`;
    // El botón "Hoy" solo aparece si estamos viendo un mes distinto al actual.
    const hoy = new Date();
    const btnHoy = document.querySelector('[data-act="pgMesHoy"]');
    if (btnHoy) btnHoy.style.display = (_anio === hoy.getFullYear() && _mes === hoy.getMonth() + 1) ? 'none' : '';
    V('pg-resumen').innerHTML = resumenHTML(r.resumen);
    const pagos = r.pagos || [];
    _pagos = pagos;
    V('pg-dcdg').innerHTML = grupoHTML('DCDG', pagos.filter((p) => p.familia === 'DCDG'));
    V('pg-dcc').innerHTML = grupoHTML('DCC', pagos.filter((p) => p.familia === 'DCC'));
    if (!pagos.length) V('pg-dcdg').innerHTML = '<div class="empty">Sin pagos fijos activos</div>';

    const pendientes = r.pendientes_mes_anterior || [];
    V('pg-anteriores-card').style.display = pendientes.length ? '' : 'none';
    V('pg-anteriores').innerHTML = pendientes.map((p) => filaPagoHTML(p, { navPrev: true })).join('');
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para ver los pagos del mes.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

async function cargarGestion() {
  try {
    const r = await getPagosDelMes({ anio: _anio, mes: _mes, incluir_inactivos: 1 });
    const pagos = (r.pagos || []).slice().sort((a, b) => a.familia.localeCompare(b.familia) || a.concepto.localeCompare(b.concepto));
    V('pg-lista-gestion').innerHTML = pagos.map(filaGestionHTML).join('') || '<div class="empty">Sin pagos fijos</div>';
  } catch (e) {
    V('pg-lista-gestion').innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
}

/** Parse "1.459.896" / "$ 1459896" → 1459896 (solo dígitos). '' → null. */
export function parseMonto(str) {
  const limpio = String(str == null ? '' : str).replace(/[^\d]/g, '');
  return limpio === '' ? null : Number(limpio);
}

/**
 * Plan de marcas para un pago que puede cubrir el mes actual + parte de un mes
 * anterior (split por período, #136-seguimiento). `previo` es la porción que
 * corresponde al mes inmediatamente anterior. Devuelve una o dos marcas (mes
 * anterior + mes actual) con su `monto_pagado`. Lanza si `previo` ≥ `total`.
 */
export function planMarcarSplit({ pago_fijo_id, total, previo, anio, mes }) {
  const t = Number(total) || 0;
  const p = Math.max(0, Number(previo) || 0);
  if (p > 0 && p >= t) throw new Error('La parte de meses anteriores debe ser menor que el total.');
  const marcas = [];
  if (p > 0) {
    const ant = Number(mes) === 1 ? { anio: Number(anio) - 1, mes: 12 } : { anio: Number(anio), mes: Number(mes) - 1 };
    marcas.push({ pago_fijo_id, anio: ant.anio, mes: ant.mes, monto_pagado: p });
  }
  marcas.push({ pago_fijo_id, anio: Number(anio), mes: Number(mes), monto_pagado: t - p });
  return marcas;
}

async function marcar(id) {
  // Preguntar el valor REAL pagado (el presupuesto varía cada mes). Se prellena
  // con el presupuesto; el usuario lo ajusta a lo que de verdad pagó.
  const pago = _pagos.find((p) => Number(p.id) === Number(id));
  const ptto = pago ? Number(pago.monto) || 0 : 0;
  const entrada = prompt(
    `¿Cuánto pagaste realmente EN TOTAL por "${pago ? pago.concepto : 'este pago'}"?\n\n`
    + 'Escribe el valor en pesos (sin puntos ni $). El presupuesto va prellenado como referencia.',
    String(ptto || ''));
  if (entrada === null) return; // canceló
  const total = parseMonto(entrada) ?? (ptto || 0);
  // Split por período: ¿parte del pago cubre la factura de un mes anterior?
  const previoStr = prompt(
    `De esos ${formatCOP(total)}, ¿cuánto corresponde a la factura de un mes ANTERIOR?\n\n`
    + `Escribe 0 si todo es de ${String(_mes).padStart(2, '0')}/${_anio}. `
    + 'Si escribes un valor, ese monto se marca como pagado en el mes anterior y el resto en este mes.',
    '0');
  if (previoStr === null) return; // canceló
  const previo = parseMonto(previoStr) || 0;
  let marcas;
  try {
    marcas = planMarcarSplit({ pago_fijo_id: Number(id), total, previo, anio: _anio, mes: _mes });
  } catch (err) {
    V('pg-msg').textContent = err.message; V('pg-msg').style.color = 'var(--red)'; return;
  }
  try {
    for (const m of marcas) await marcarPagoFijo(m); // mes anterior (si hay) + mes actual
    await cargar();
  } catch (e) {
    V('pg-msg').textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Solo Luis o Carolina pueden gestionar pagos fijos.')
      : 'Error: ' + e.message;
    V('pg-msg').style.color = 'var(--red)';
  }
}

async function desmarcar(id) {
  try {
    await desmarcarPagoFijo({ pago_fijo_id: Number(id), anio: _anio, mes: _mes });
    await cargar();
  } catch (e) {
    V('pg-msg').textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Solo Luis o Carolina pueden gestionar pagos fijos.')
      : 'Error: ' + e.message;
    V('pg-msg').style.color = 'var(--red)';
  }
}

async function guardarEdicion(id) {
  // Campo vacío = "no lo toques" (envía null; el backend conserva el valor
  // actual). Si se enviara 0 por defecto, limpiar el campo por error borraría
  // el monto/día de vencimiento reales en vez de dejarlos como estaban.
  const montoVal = document.querySelector(`.pg-e-monto[data-id="${id}"]`)?.value;
  const diaVal = document.querySelector(`.pg-e-dia[data-id="${id}"]`)?.value;
  const asumido_por = document.querySelector(`.pg-e-asumido[data-id="${id}"]`)?.value || null;
  const monto = montoVal === '' || montoVal == null ? null : Number(montoVal);
  const dia_vencimiento = diaVal === '' || diaVal == null ? null : Number(diaVal);
  try {
    await editarPagoFijo({ id: Number(id), monto, dia_vencimiento, asumido_por });
    await Promise.all([cargarGestion(), cargar()]);
  } catch (e) {
    V('pg-lista-gestion').insertAdjacentHTML('afterbegin', `<div style="color:var(--red);font-size:12px">Error: ${esc(e.message)}</div>`);
  }
}

async function toggleActivo(id, activoActual) {
  try {
    await editarPagoFijo({ id: Number(id), activo: activoActual !== 'true' });
    await Promise.all([cargarGestion(), cargar()]);
  } catch (e) {
    V('pg-lista-gestion').insertAdjacentHTML('afterbegin', `<div style="color:var(--red);font-size:12px">Error: ${esc(e.message)}</div>`);
  }
}

async function crear() {
  const concepto = V('pg-n-concepto').value.trim();
  if (!concepto) { V('pg-msg').textContent = 'Ingresa el concepto del pago fijo.'; V('pg-msg').style.color = 'var(--red)'; return; }
  const body = {
    concepto,
    monto: Number(V('pg-n-monto').value) || 0,
    dia_vencimiento: Number(V('pg-n-dia').value) || 1,
    familia: V('pg-n-familia').value || 'DCDG',
    categoria: V('pg-n-categoria').value.trim() || null,
    asumido_por: V('pg-n-asumido').value || 'Común',
  };
  try {
    await crearPagoFijo(body);
    V('pg-n-concepto').value = '';
    V('pg-n-monto').value = '';
    V('pg-n-dia').value = '';
    V('pg-n-categoria').value = '';
    await Promise.all([cargarGestion(), cargar()]);
  } catch (e) {
    V('pg-msg').textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Solo Luis o Carolina pueden gestionar pagos fijos.')
      : 'Error: ' + e.message;
    V('pg-msg').style.color = 'var(--red)';
  }
}

function toggleGestion() {
  _gestionAbierta = !_gestionAbierta;
  V('pg-gestion').style.display = _gestionAbierta ? '' : 'none';
  if (_gestionAbierta) cargarGestion();
}

/** Historial de pagos: tabla por mes (últimos 6) + acumulado por quién asume. */
function historialHTML(data) {
  const filas = (data.por_mes || []).map((m) => {
    const ptto = Number(m.total_presupuestado) || 0;
    const pagado = Number(m.total_pagado) || 0;
    const pct = ptto > 0 ? Math.round((pagado / ptto) * 100) : 0;
    const w = Math.min(100, pct);
    return `<div style="padding:7px 0;border-bottom:1px solid var(--gray)">
      <div class="row2" style="align-items:baseline;gap:8px">
        <div style="font-size:13px;font-weight:600">${MESES[m.mes]} ${m.anio}</div>
        <div style="text-align:right;font-size:12px">${formatCOP(pagado)} <span style="color:var(--gray-d)">/ ${formatCOP(ptto)} · ${pct}%</span></div>
      </div>
      <div style="height:6px;background:var(--gray);border-radius:4px;overflow:hidden;margin-top:4px">
        <div style="height:100%;width:${w}%;background:${pct > 100 ? 'var(--red)' : 'var(--primary)'}"></div>
      </div>
    </div>`;
  }).join('');
  const acc = data.acumulado || { por_asumido: {} };
  const asum = ['LADCC', 'CMDG', 'Común']
    .filter((q) => acc.por_asumido && acc.por_asumido[q])
    .map((q) => `${esc(q)} ${formatCOP(acc.por_asumido[q])}`).join(' · ');
  return filas
    + `<div style="margin-top:10px;font-size:13px;font-weight:600">Acumulado ${data.meses} meses: ${formatCOP(acc.total_pagado || 0)} pagado</div>`
    + (asum ? `<div style="font-size:12px;color:var(--gray-d)">Por quién asume: ${asum}</div>` : '');
}

let _historialAbierto = false;
async function toggleHistorial() {
  _historialAbierto = !_historialAbierto;
  const cont = V('pg-historial');
  cont.style.display = _historialAbierto ? '' : 'none';
  if (!_historialAbierto) return;
  cont.innerHTML = '<div class="empty">Cargando…</div>';
  try {
    cont.innerHTML = historialHTML(await getHistorialPagos(6));
  } catch (e) {
    cont.innerHTML = `<div class="empty" style="color:var(--red)">${esc(e.message || 'No se pudo cargar el historial.')}</div>`;
  }
}

/** Avanza/retrocede el mes mostrado (con rollover de año) y recarga. */
async function cambiarMes(delta) {
  let m = _mes + delta;
  let a = _anio;
  if (m < 1) { m = 12; a -= 1; } else if (m > 12) { m = 1; a += 1; }
  _mes = m; _anio = a;
  V('pg-msg').textContent = '';
  await cargar();
  if (_gestionAbierta) cargarGestion();
}

async function irHoy() {
  const hoy = new Date();
  _anio = hoy.getFullYear();
  _mes = hoy.getMonth() + 1;
  V('pg-msg').textContent = '';
  await cargar();
  if (_gestionAbierta) cargarGestion();
}

/** Llamado por main.js al navegar a la pantalla de Pagos del mes. */
export async function renderPagos() {
  const hoy = new Date();
  _anio = hoy.getFullYear();
  _mes = hoy.getMonth() + 1;
  await cargar();
  if (!_wired) {
    _wired = true;
    V('scr-pagos').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const { act, id, activo } = btn.dataset;
      if (act === 'pgMarcar') marcar(id);
      else if (act === 'pgDesmarcar') desmarcar(id);
      else if (act === 'pgGuardarEdicion') guardarEdicion(id);
      else if (act === 'pgToggleActivo') toggleActivo(id, activo);
      else if (act === 'pgCrear') crear();
      else if (act === 'pgToggleGestion') toggleGestion();
      else if (act === 'pgToggleHistorial') toggleHistorial();
      else if (act === 'pgMesPrev' || act === 'pgIrMesPrev') cambiarMes(-1);
      else if (act === 'pgMesNext') cambiarMes(1);
      else if (act === 'pgMesHoy') irHoy();
    });
  }
}
