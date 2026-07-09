/**
 * ui/pagos.js — Pagos del mes: qué se ha pagado y qué falta (issue #73,
 * Nocturno 2/7). Espejo del "Pagos Fijos" del Excel de Luis: cada pago fijo
 * del mes en curso con su estado (pagado/pendiente/vencido), separado por
 * familia (DCDG/DCC), más los pendientes del mes anterior y la gestión del
 * catálogo (agregar/editar/desactivar).
 */

import {
  getPagosDelMes, marcarPagoFijo, desmarcarPagoFijo, crearPagoFijo, editarPagoFijo,
} from '../services/finanzas.js';
import { formatCOP } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);

let _wired = false;
let _anio = null;
let _mes = null;
let _gestionAbierta = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const ICONO_ESTADO = { pagado: '✅', pendiente: '⏳', vencido: '🔴' };

function filaPagoHTML(p) {
  const icono = ICONO_ESTADO[p.estado] || '⏳';
  const accion = p.estado === 'pagado'
    ? `<button class="btn btn-s" data-act="pgDesmarcar" data-id="${p.id}" style="padding:4px 10px;font-size:12px">Desmarcar</button>`
    : `<button class="btn btn-p" data-act="pgMarcar" data-id="${p.id}" style="padding:4px 10px;font-size:12px">Marcar pagado</button>`;
  return `<div class="row2" style="align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--gray)">
    <div style="font-size:13px">${icono} ${esc(p.concepto)} <span style="color:var(--gray-d)">· vence día ${esc(p.dia_vencimiento)}</span></div>
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-weight:600">${formatCOP(p.monto)}</span>
      ${accion}
    </div>
  </div>`;
}

function grupoHTML(titulo, pagos) {
  if (!pagos.length) return '';
  return `<div style="margin-top:10px"><div style="font-weight:700;font-size:12px;color:var(--gray-d);margin-bottom:4px">${esc(titulo)}</div>${pagos.map(filaPagoHTML).join('')}</div>`;
}

function filaGestionHTML(p) {
  // Bloque vertical con los campos etiquetados (Monto / Día de vencimiento) y una
  // fila que envuelve (flex-wrap) para que en móvil nada se salga de la vista.
  return `<div style="padding:10px 0;border-bottom:1px solid var(--gray)${p.activo ? '' : ';opacity:.5'}">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">${esc(p.concepto)} <span style="color:var(--gray-d);font-weight:400">(${esc(p.familia)})</span></div>
    <div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px">
      <label style="font-size:11px;color:var(--gray-d);display:flex;flex-direction:column;gap:2px">Monto ($)
        <input type="number" class="pg-e-monto" data-id="${p.id}" value="${p.monto}" style="width:120px;text-align:right" inputmode="numeric"></label>
      <label style="font-size:11px;color:var(--gray-d);display:flex;flex-direction:column;gap:2px">Día de vencimiento
        <input type="number" class="pg-e-dia" data-id="${p.id}" value="${p.dia_vencimiento}" style="width:80px;text-align:right" min="1" max="31"></label>
      <button class="btn btn-p" data-act="pgGuardarEdicion" data-id="${p.id}" style="padding:7px 12px;font-size:12px">Guardar</button>
      <button class="btn btn-s" data-act="pgToggleActivo" data-id="${p.id}" data-activo="${p.activo}" style="padding:7px 12px;font-size:12px">${p.activo ? 'Desactivar' : 'Activar'}</button>
    </div>
  </div>`;
}

function resumenHTML(r) {
  return `Presupuestado ${formatCOP(r.total_presupuestado)} · Pagado ${formatCOP(r.total_pagado)}`
    + ` · Pendiente ${formatCOP(r.total_pendiente)}${r.n_vencidos ? ` (${r.n_vencidos} vencido${r.n_vencidos === 1 ? '' : 's'})` : ''}`;
}

async function cargar() {
  const msg = V('pg-msg');
  msg.textContent = '';
  try {
    const r = await getPagosDelMes({ anio: _anio, mes: _mes });
    V('pg-periodo').textContent = `${String(_mes).padStart(2, '0')}/${_anio}`;
    V('pg-resumen').textContent = resumenHTML(r.resumen);
    const pagos = r.pagos || [];
    V('pg-dcdg').innerHTML = grupoHTML('DCDG', pagos.filter((p) => p.familia === 'DCDG'));
    V('pg-dcc').innerHTML = grupoHTML('DCC', pagos.filter((p) => p.familia === 'DCC'));
    if (!pagos.length) V('pg-dcdg').innerHTML = '<div class="empty">Sin pagos fijos activos</div>';

    const pendientes = r.pendientes_mes_anterior || [];
    V('pg-anteriores-card').style.display = pendientes.length ? '' : 'none';
    V('pg-anteriores').innerHTML = pendientes.map(filaPagoHTML).join('');
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

async function marcar(id) {
  try {
    await marcarPagoFijo({ pago_fijo_id: Number(id), anio: _anio, mes: _mes });
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
  const monto = montoVal === '' || montoVal == null ? null : Number(montoVal);
  const dia_vencimiento = diaVal === '' || diaVal == null ? null : Number(diaVal);
  try {
    await editarPagoFijo({ id: Number(id), monto, dia_vencimiento });
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
    });
  }
}
