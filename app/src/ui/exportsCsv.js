/**
 * ui/exportsCsv.js — Exports contables en CSV para el contador (issue #91,
 * sub-issue de #52, T12a). Solo lectura: descarga Libro Diario, Libro Mayor
 * (por cuenta), Balance de Comprobación, Estado de Resultados y Balance
 * General de un periodo/fecha, reusando los mismos datos que ya muestran las
 * pantallas de 📒 Mayor y 📈 Estados.
 */

import { getPlanCuentas, descargarCsv } from '../services/finanzas.js';
import { hoyISO } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);

let _wired = false;
let _cuentas = [];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function cargarCuentas() {
  if (_cuentas.length) return;
  const r = await getPlanCuentas();
  _cuentas = (r.cuentas || []).filter((c) => String(c.codigo).length >= 4);
  V('exp-mayor-cuenta').innerHTML = _cuentas.map((c) => `<option value="${esc(c.codigo)}">${esc(c.codigo)} · ${esc(c.nombre)}</option>`).join('');
}

async function descargar(boton, path, params, nombreArchivo) {
  const msg = V('exp-msg');
  msg.textContent = '';
  boton.disabled = true;
  try {
    await descargarCsv(path, params, nombreArchivo);
    msg.textContent = `✓ Descargado ${nombreArchivo}`;
    msg.style.color = 'var(--green)';
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para descargar exports.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  } finally {
    boton.disabled = false;
  }
}

function fechas(prefijo) {
  return { desde: V(`exp-${prefijo}-desde`).value || undefined, hasta: V(`exp-${prefijo}-hasta`).value || undefined };
}

async function onClick(e) {
  const boton = e.target.closest('[data-act]');
  if (!boton) return;
  const act = boton.dataset.act;
  if (act === 'expDiario') {
    await descargar(boton, '/api/pwa-asiento', fechas('diario'), 'libro-diario.csv');
  } else if (act === 'expMayor') {
    const cuenta = V('exp-mayor-cuenta').value;
    if (!cuenta) { V('exp-msg').textContent = 'Elige una cuenta.'; V('exp-msg').style.color = 'var(--red)'; return; }
    await descargar(boton, '/api/pwa-mayor', { cuenta, ...fechas('mayor') }, `libro-mayor-${cuenta}.csv`);
  } else if (act === 'expComprobacion') {
    await descargar(boton, '/api/pwa-comprobacion', fechas('comp'), 'balance-comprobacion.csv');
  } else if (act === 'expResultados') {
    await descargar(boton, '/api/pwa-estado-resultados', fechas('er'), 'estado-resultados.csv');
  } else if (act === 'expBalance') {
    await descargar(boton, '/api/pwa-balance-general', { fecha: V('exp-bg-fecha').value || hoyISO() }, 'balance-general.csv');
  }
}

/** Llamado por main.js al navegar a la pantalla de Exports. */
export async function renderExportsCsv() {
  V('exp-bg-fecha').value = V('exp-bg-fecha').value || hoyISO();
  try {
    await cargarCuentas();
  } catch (e) {
    V('exp-msg').textContent = 'No se pudo cargar el plan de cuentas: ' + e.message;
    V('exp-msg').style.color = 'var(--red)';
  }
  if (!_wired) {
    _wired = true;
    V('scr-exports').addEventListener('click', onClick);
  }
}
