/**
 * ui/dashboard.js — Dashboard de finanzas de la PWA.
 *
 * Lee de la DB (Neon) vía el backend y muestra: total del periodo, desglose por
 * categoría (barras) y últimos movimientos. Fuente de verdad = Postgres.
 * Sin librerías externas (barras con divs, tematizables claro/oscuro).
 */

import { getResumen, getMovimientos } from '../services/finanzas.js';
import { formatCOP } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);

// Paleta para las categorías (se cicla). Usa los tonos de la marca DCDG.
const PALETTE = ['#2E5FA3', '#0F6E56', '#F0A500', '#534AB7', '#C0392B', '#1A7A4A', '#5DCAA5', '#854F0B'];

let _wired = false;
let _periodo = 'mes';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Devuelve { param, desde, hasta, label } para el periodo seleccionado. */
function periodRange(key) {
  const hoy = new Date();
  if (key === 'mespasado') {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    return { desde: iso(ini), hasta: iso(fin), label: 'Mes pasado' };
  }
  if (key === 'anio') {
    const ini = new Date(hoy.getFullYear(), 0, 1);
    return { desde: iso(ini), hasta: iso(hoy), label: String(hoy.getFullYear()) };
  }
  // mes en curso (default)
  const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  return { desde: iso(ini), hasta: iso(hoy), label: 'Este mes' };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function segHTML() {
  const opts = [['mes', 'Este mes'], ['mespasado', 'Mes pasado'], ['anio', 'Año']];
  return `<div class="seg">${opts.map(([k, l]) =>
    `<button class="seg-btn${k === _periodo ? ' on' : ''}" data-per="${k}">${l}</button>`).join('')}</div>`;
}

function barsHTML(porCategoria) {
  if (!porCategoria || !porCategoria.length) return '<div class="empty">Sin gastos en este periodo</div>';
  const max = Math.max(...porCategoria.map((c) => Number(c.monto) || 0)) || 1;
  return porCategoria.map((c, i) => {
    const monto = Number(c.monto) || 0;
    const pct = Math.max(2, Math.round((monto / max) * 100));
    const color = PALETTE[i % PALETTE.length];
    return `<div class="bar-row">
      <div class="bar-head"><span class="bar-cat">${esc(c.categoria)}</span><span class="bar-amt">${esc(c.monto_fmt || formatCOP(monto))}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  }).join('');
}

function movsHTML(movs) {
  if (!movs || !movs.length) return '<div class="empty">Sin movimientos en este periodo</div>';
  return movs.map((m) => {
    const fecha = String(m.fecha || '').slice(0, 10);
    return `<div class="h-item">
      <div><div class="h-name">${esc(m.descripcion)}</div><div class="h-meta">${esc(m.categoria || '—')}${m.subcategoria ? ' · ' + esc(m.subcategoria) : ''} · ${esc(fecha)}</div></div>
      <div><div class="h-amt">${formatCOP(Number(m.monto) || 0)}</div><div class="h-who">${esc(m.quien_pago || '')}${m.metodo_pago ? ' · ' + esc(m.metodo_pago) : ''}</div></div>
    </div>`;
  }).join('');
}

function skeleton() {
  V('dash-body').innerHTML = '<div class="proc-wrap" style="min-height:180px"><div class="spin"></div><div class="proc-msg">Cargando…</div></div>';
}

async function load() {
  skeleton();
  const { desde, hasta, label } = periodRange(_periodo);
  const periodo = `${desde}..${hasta}`;
  try {
    const [res, movsRes] = await Promise.all([
      getResumen({ periodo }),
      getMovimientos({ desde, hasta, limit: 20 }),
    ]);
    const total = Number(res.total) || 0;
    V('dash-body').innerHTML = `
      <div class="card dash-total-card">
        <div class="dash-total-lbl">${esc(label)}</div>
        <div class="dash-total">${esc(res.total_fmt || formatCOP(total))}</div>
        <div class="dash-total-sub">${res.movimientos || 0} movimiento${res.movimientos === 1 ? '' : 's'}</div>
      </div>
      <div class="card">
        <div class="card-ttl">Por categoría</div>
        ${barsHTML(res.por_categoria)}
      </div>
      <div class="card">
        <div class="card-ttl">Movimientos del periodo</div>
        ${movsHTML(movsRes.movimientos)}
      </div>`;
  } catch (e) {
    const msg = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (Luis o Carolina) para ver el dashboard.'
      : (e.message || 'No se pudo cargar el dashboard.');
    V('dash-body').innerHTML = `<div class="card"><div class="empty" style="color:var(--red)">${esc(msg)}</div>
      <button class="btn btn-s" data-act="dashReload" style="margin-top:12px">Reintentar</button></div>`;
  }
}

/** Llamado por main.js al navegar a la pantalla del dashboard. */
export function renderDashboard() {
  const sel = V('dash-seg');
  if (sel) sel.innerHTML = segHTML();
  if (!_wired) {
    _wired = true;
    const scr = V('scr-dash');
    scr.addEventListener('click', (e) => {
      const per = e.target.closest('[data-per]');
      if (per) {
        _periodo = per.dataset.per;
        scr.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.per === _periodo));
        load();
        return;
      }
      if (e.target.closest('[data-act="dashReload"]')) load();
    });
  }
  load();
}
