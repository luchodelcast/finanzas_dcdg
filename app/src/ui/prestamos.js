/**
 * ui/prestamos.js — Préstamos entre Luis y Carolina (issue #77, Nocturno 6/7).
 *
 * Saldo neto arriba ("Carolina te debe $X" / "Le debes a Carolina $Y"),
 * registro de un préstamo (o abono, con "de"/"para" invertidos) y la lista con
 * su sentido, monto y opción de marcar/desmarcar saldado.
 */

import { getPrestamos, crearPrestamo, marcarPrestamoSaldado } from '../services/finanzas.js';
import { formatCOP } from '../utils/formatters.js';
import { hoyISO } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);

let _wired = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const fmtMoneda = (monto, moneda) => (moneda === 'COP' || !moneda) ? formatCOP(monto) : `${moneda} ${Number(monto).toLocaleString('es-CO')}`;

function saldoHTML(saldo) {
  if (!saldo || !saldo.length) return '<div class="empty">Sin préstamos pendientes — están a paz y salvo.</div>';
  return saldo.map((s) => {
    if (!s.deudor) return `<div class="h-item"><div class="h-name">${esc(s.moneda)}</div><div class="h-amt" style="color:var(--green)">A paz y salvo</div></div>`;
    const texto = s.deudor === 'Carolina' ? 'Carolina te debe' : 'Le debes a Carolina';
    return `<div class="h-item"><div class="h-name">${texto}${s.moneda !== 'COP' ? ` (${esc(s.moneda)})` : ''}</div><div class="h-amt">${fmtMoneda(s.neto, s.moneda)}</div></div>`;
  }).join('');
}

function filaPrestamoHTML(p) {
  const accion = p.saldado
    ? `<button class="btn btn-s" data-act="pdesmarcar" data-id="${p.id}" style="padding:4px 10px;font-size:12px">Desmarcar</button>`
    : `<button class="btn btn-p" data-act="psaldar" data-id="${p.id}" style="padding:4px 10px;font-size:12px">Marcar saldado</button>`;
  return `<div class="row2" style="align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--gray)${p.saldado ? ';opacity:.5' : ''}">
    <div style="font-size:13px">
      <strong>${esc(p.de)} → ${esc(p.para)}</strong>${p.concepto ? ` · ${esc(p.concepto)}` : ''}
      <div class="h-meta">${esc(String(p.fecha || '').slice(0, 10))}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-weight:600">${fmtMoneda(p.monto, p.moneda)}</span>
      ${accion}
    </div>
  </div>`;
}

async function cargar() {
  const msg = V('pr-msg');
  msg.textContent = '';
  try {
    const r = await getPrestamos();
    V('pr-saldo').innerHTML = saldoHTML(r.saldo);
    const prestamos = r.prestamos || [];
    V('pr-lista').innerHTML = prestamos.map(filaPrestamoHTML).join('') || '<div class="empty">Sin préstamos registrados</div>';
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (equipo financiero) para ver los préstamos.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

async function crear() {
  const msg = V('pr-msg');
  const de = V('pr-n-de').value;
  const para = V('pr-n-para').value;
  const monto = Number(V('pr-n-monto').value);
  if (de === para) { msg.textContent = '"De" y "Para" no pueden ser la misma persona.'; msg.style.color = 'var(--red)'; return; }
  if (!(monto > 0)) { msg.textContent = 'Ingresa un monto mayor a 0.'; msg.style.color = 'var(--red)'; return; }
  const body = {
    fecha: V('pr-n-fecha').value || hoyISO(),
    de, para, monto,
    concepto: V('pr-n-concepto').value.trim() || null,
    moneda: V('pr-n-moneda').value || 'COP',
  };
  try {
    await crearPrestamo(body);
    V('pr-n-monto').value = '';
    V('pr-n-concepto').value = '';
    msg.textContent = '✓ Registrado';
    msg.style.color = 'var(--green)';
    await cargar();
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Solo Luis o Carolina pueden registrar préstamos.')
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

async function toggleSaldado(id, saldado) {
  try {
    await marcarPrestamoSaldado({ id: Number(id), saldado });
    await cargar();
  } catch (e) {
    V('pr-msg').textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Solo Luis o Carolina pueden gestionar préstamos.')
      : 'Error: ' + e.message;
    V('pr-msg').style.color = 'var(--red)';
  }
}

/** Llamado por main.js al navegar a la pantalla de Préstamos. */
export async function renderPrestamos() {
  V('pr-n-fecha').value = hoyISO();
  await cargar();
  if (!_wired) {
    _wired = true;
    V('scr-prestamos').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const { act, id } = btn.dataset;
      if (act === 'prCrear') crear();
      else if (act === 'psaldar') toggleSaldado(id, true);
      else if (act === 'pdesmarcar') toggleSaldado(id, false);
    });
  }
}
