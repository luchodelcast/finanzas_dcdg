/**
 * ui/mayor.js — Libro Mayor por cuenta + Balance de Comprobación (T5, PWA).
 *
 * Solo lectura: consulta los saldos derivados de los asientos (T2). Cierra la
 * Semana 1 del motor contable — base de los estados financieros (T6/T7).
 */

import { getPlanCuentas, getMayor, getComprobacion, descargarExportCSV } from '../services/finanzas.js';
import { formatCOP } from '../utils/formatters.js';
import { descargarBlob } from '../utils/download.js';

const V = (id) => document.getElementById(id);

let _wired = false;
let _cuentas = [];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function rowHTML(label, value, { strong = false } = {}) {
  return `<div class="bar-head" style="margin-bottom:6px${strong ? ';font-weight:700' : ''}">
    <span class="bar-cat">${esc(label)}</span><span class="bar-amt">${esc(value)}</span>
  </div>`;
}

async function cargarCuentas() {
  if (_cuentas.length) return;
  const r = await getPlanCuentas();
  // Cuentas "hoja" (código de 4+ dígitos) — las cabeceras (1, 11, …) no reciben renglones.
  _cuentas = (r.cuentas || []).filter((c) => String(c.codigo).length >= 4);
  V('may-cuenta').innerHTML = _cuentas.map((c) => `<option value="${esc(c.codigo)}">${esc(c.codigo)} · ${esc(c.nombre)}</option>`).join('');
}

async function consultarMayor() {
  const cuenta = V('may-cuenta').value;
  const msg = V('may-msg');
  if (!cuenta) { msg.textContent = 'Elige una cuenta.'; msg.style.color = 'var(--red)'; return; }
  msg.textContent = '';
  V('may-lineas').innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const r = await getMayor({ cuenta, desde: V('may-desde').value || undefined, hasta: V('may-hasta').value || undefined });
    const lineas = r.lineas || [];
    V('may-lineas').innerHTML = lineas.length
      ? lineas.map((l) => rowHTML(`${l.fecha} · ${l.descripcion || ''}`,
        `${l.debito ? 'D ' + formatCOP(l.debito) : 'C ' + formatCOP(l.credito)} · saldo ${formatCOP(l.saldo)}`)).join('')
      : '<div class="empty">Sin movimientos en este rango</div>';
    V('may-saldo').textContent = `${r.cuenta.codigo} · ${r.cuenta.nombre} — saldo final: ${formatCOP(r.saldoFinal)}`;
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para consultar el mayor.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
    V('may-lineas').innerHTML = '';
    V('may-saldo').textContent = '';
  }
}

async function consultarComprobacion() {
  const msg = V('comp-msg');
  msg.textContent = '';
  V('comp-body').innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const r = await getComprobacion({ desde: V('may-desde').value || undefined, hasta: V('may-hasta').value || undefined });
    const cuentas = r.cuentas || [];
    V('comp-body').innerHTML = cuentas.length
      ? cuentas.map((c) => rowHTML(`${c.codigo} · ${c.nombre}`, `D ${formatCOP(c.debito)} / C ${formatCOP(c.credito)} = ${formatCOP(c.saldo)}`)).join('')
      : '<div class="empty">Sin movimientos en este rango</div>';
    const cuadre = rowHTML('Total', `D ${formatCOP(r.totalDebito)} / C ${formatCOP(r.totalCredito)}`, { strong: true });
    V('comp-total').innerHTML = cuadre;
    V('comp-total').style.color = r.cuadra ? 'var(--green)' : 'var(--red)';
    msg.textContent = r.cuadra ? '✓ Cuadra (Σdébito = Σcrédito).' : '⚠ No cuadra — revisa los asientos.';
    msg.style.color = r.cuadra ? 'var(--green)' : 'var(--red)';
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para ver el comprobante.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
    V('comp-body').innerHTML = '';
    V('comp-total').innerHTML = '';
  }
}

async function descargar(tipo, params, msgId) {
  const msg = V(msgId);
  try {
    const { blob, filename } = await descargarExportCSV({ tipo, ...params });
    descargarBlob(blob, filename);
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para descargar el export.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

function descargarDiario() {
  return descargar('diario', { desde: V('may-desde').value || undefined, hasta: V('may-hasta').value || undefined }, 'may-msg');
}

function descargarMayor() {
  const cuenta = V('may-cuenta').value;
  if (!cuenta) { V('may-msg').textContent = 'Elige una cuenta.'; V('may-msg').style.color = 'var(--red)'; return; }
  return descargar('mayor', { cuenta, desde: V('may-desde').value || undefined, hasta: V('may-hasta').value || undefined }, 'may-msg');
}

function descargarComprobacion() {
  return descargar('comprobacion', { desde: V('may-desde').value || undefined, hasta: V('may-hasta').value || undefined }, 'comp-msg');
}

/** Llamado por main.js al navegar a la pantalla de Mayor/Comprobación. */
export async function renderMayor() {
  try {
    await cargarCuentas();
  } catch (e) {
    V('may-msg').textContent = 'No se pudo cargar el plan de cuentas: ' + e.message;
    V('may-msg').style.color = 'var(--red)';
  }
  if (!_wired) {
    _wired = true;
    V('scr-mayor').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="verMayor"]')) consultarMayor();
      if (e.target.closest('[data-act="verComprobacion"]')) consultarComprobacion();
      if (e.target.closest('[data-act="descargarDiario"]')) descargarDiario();
      if (e.target.closest('[data-act="descargarMayor"]')) descargarMayor();
      if (e.target.closest('[data-act="descargarComprobacion"]')) descargarComprobacion();
    });
  }
}
