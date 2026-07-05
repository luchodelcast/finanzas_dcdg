/**
 * main.js — Orquestador de la PWA DCDG Finanzas.
 *
 * Port modular del <script> monolítico de DCDG_Captura_v5.html. La lógica de
 * dominio vive en los módulos (config/services/utils); aquí solo se cablea la
 * UI (navegación entre pantallas + handlers) usando delegación de eventos.
 */

import { getConfig, saveConfig } from './config/env.js';
import { CATS, subcategorias, CUENTAS_FALLBACK, CET_CUENTAS } from './config/categories.js';
import {
  TARJETAS_MAP,
  setCuentasDinamicas,
  resolveCard,
  isIwinAccount,
} from './config/accounts.js';
import { analizarTexto, analizarImagen } from './services/claude.js';
import {
  appendValues,
  loadCuentas as fetchCuentas,
} from './services/sheets.js';
import { getAccessToken, signOut as authSignOut, isSignedIn } from './services/auth.js';
import { procesarRecibo } from './utils/imageProcessor.js';
import { formatCOP, hoyISO } from './utils/formatters.js';
import { loadHistory, addHistory, getHistory, clearHistory } from './services/history.js';
import { renderDashboard } from './ui/dashboard.js';

const V = (id) => document.getElementById(id);
const today = () => hoyISO();
const fmtDate = (d) => d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });

// ── Estado de UI ──────────────────────────────────────────
let curImg = null; // { base64, mediaType, prev }
let curIsIwin = false;

// ── Navegación ────────────────────────────────────────────
function go(s) {
  document.querySelectorAll('.scr').forEach((x) => x.classList.remove('on'));
  const el = V('scr-' + s);
  if (el) el.classList.add('on');
  if (s === 'settings') {
    const cfg = getConfig();
    V('cfg-ak').value = cfg.anthropicApiKey || '';
    V('cfg-gc').value = cfg.googleClientId || '';
    V('cfg-si').value = cfg.spreadsheetId || '';
    V('cfg-st').value = cfg.sheetGastos || 'Registro Gastos';
    V('cfg-se').value = cfg.sheetEmpresas || 'EMPRESAS';
  }
  if (s === 'history') renderH();
  if (s === 'cet') initCET();
  if (s === 'dash') renderDashboard();
}

function toast(msg, dur = 3000) {
  const t = V('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// ── Setup & Settings ──────────────────────────────────────
function saveSetup() {
  const ak = V('s-ak').value.trim(); // opcional: la clasificación ya es server-side
  const gc = V('s-gc').value.trim();
  const si = V('s-si').value.trim();
  const st = V('s-st').value.trim() || 'Registro Gastos';
  const se = V('s-se').value.trim() || 'EMPRESAS';
  if (!gc) return toast('Ingresa el Google Client ID');
  if (!si) return toast('Ingresa el ID del Spreadsheet');
  saveConfig({ ak, gc, si, st, se });
  go('home');
  renderHomeH();
  connect();
  toast('✓ Configuración guardada');
}

function saveCfg() {
  const cur = getConfig();
  saveConfig({
    ak: V('cfg-ak').value.trim() || cur.anthropicApiKey,
    gc: V('cfg-gc').value.trim() || cur.googleClientId,
    si: V('cfg-si').value.trim() || cur.spreadsheetId,
    st: V('cfg-st').value.trim() || cur.sheetGastos,
    se: V('cfg-se').value.trim() || cur.sheetEmpresas || 'EMPRESAS',
  });
  connect();
  go('home');
  toast('✓ Configuración actualizada');
}

function resetAll() {
  if (confirm('¿Borrar toda la configuración?')) {
    localStorage.clear();
    location.reload();
  }
}

// ── Google Auth ───────────────────────────────────────────
function setConn(on) {
  V('conn-dot').className = 'conn-dot' + (on ? ' on' : '');
  V('conn-lbl').textContent = on ? 'Conectado' : 'Sin conectar';
}

/** Solicita/renueva el token y carga cuentas dinámicas. */
async function connect({ forcePrompt = false } = {}) {
  const cfg = getConfig();
  if (!cfg.googleClientId) return false;
  try {
    await getAccessToken({ forcePrompt });
    setConn(true);
    await cargarCuentas();
    return true;
  } catch (e) {
    setConn(false);
    if (forcePrompt) toast('No se pudo conectar: ' + e.message);
    return false;
  }
}

function signOut() {
  authSignOut();
  setConn(false);
  toast('Desconectado');
  go('home');
}

// ── Cuentas dinámicas desde ⚙️ CUENTAS ────────────────────
async function cargarCuentas() {
  try {
    const cuentas = await fetchCuentas();
    if (cuentas.length) {
      setCuentasDinamicas(cuentas);
      buildAccountsDropdown(cuentas);
      toast(`✓ ${cuentas.length} cuentas cargadas`, 2000);
    } else {
      buildAccountsDropdown(CUENTAS_FALLBACK);
    }
  } catch (_) {
    buildAccountsDropdown(CUENTAS_FALLBACK);
  }
}

function buildAccountsDropdown(accounts) {
  const sel = V('cf-mth');
  const currentVal = sel.value;
  sel.innerHTML = '';
  accounts.forEach((acct) => {
    const o = document.createElement('option');
    o.value = acct.name;
    if (acct.tipoEspecial === 'iWin-Adelanto') o.textContent = acct.name + ' 🏢';
    else if (acct.tipoEspecial === 'USD-Internacional') o.textContent = acct.name + ' 💵';
    else o.textContent = acct.name;
    o.dataset.tipoEspecial = acct.tipoEspecial || 'Normal';
    sel.appendChild(o);
  });
  if (currentVal) {
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === currentVal) {
        sel.selectedIndex = i;
        break;
      }
    }
  }
}

// ── Cámara / imagen ───────────────────────────────────────
async function onImg(inp) {
  const f = inp.files[0];
  if (!f) return;
  inp.value = '';
  go('proc');
  V('proc-msg').textContent = 'Cargando imagen…';
  try {
    const { base64, mediaType, dataUrl } = await procesarRecibo(f);
    curImg = { base64, mediaType, prev: dataUrl };
    await doImg();
  } catch (e) {
    go('home');
    toast(e.message || 'No se pudo leer la imagen.');
  }
}

// ── Clasificación ─────────────────────────────────────────
async function doImg() {
  if (!curImg) return;
  go('proc');
  V('proc-msg').textContent = 'Leyendo el recibo…';
  try {
    showConf(await analizarImagen(curImg.base64, curImg.mediaType));
  } catch (e) {
    toast('Error: ' + e.message);
    go('home');
  }
}

async function doText() {
  const txt = V('ti-val').value.trim();
  const dt = V('ti-dt').value;
  if (!txt) return toast('Escribe el gasto primero');
  curImg = null;
  go('proc');
  V('proc-msg').textContent = 'Clasificando…';
  try {
    showConf(await analizarTexto(txt, dt));
  } catch (e) {
    toast('Error: ' + e.message);
    go('text');
  }
}

// ── Pantalla de confirmación ──────────────────────────────
function showConf(d) {
  const iw = V('img-wrap');
  if (curImg) {
    V('img-prev').src = curImg.prev;
    iw.style.display = 'block';
  } else {
    iw.style.display = 'none';
  }

  // Aviso de umbral (< $10.000)
  V('tw-wrap').style.display = d.monto > 0 && d.monto < 10000 ? 'flex' : 'none';

  // Aviso iWin
  curIsIwin = !!(d.iwin_prestamo || isIwinAccount(d.metodo_pago || ''));
  V('iwin-wrap').style.display = curIsIwin ? 'flex' : 'none';

  // Confianza
  const cb = V('cf-badge');
  cb.textContent =
    { alta: '✓ Alta confianza', media: '~ Confianza media', baja: '? Baja confianza' }[d.confianza] ||
    'Media';
  cb.className = 'cfb ' + (d.confianza || 'media');

  // Campos
  V('cf-monto').value = d.monto || '';
  V('cf-fecha').value = d.fecha || today();
  V('cf-desc').value = d.comercio || d.descripcion || '';
  V('cf-note').value = d.notas || '';

  // Tarjeta
  const tarjeta = d.tarjeta_ultimos4 || '';
  V('cf-tarjeta').value = tarjeta;
  if (tarjeta) onTarjetaInput(tarjeta);
  else V('cf-tarjeta-resolved').textContent = '';

  // Categoría
  const catSel = V('cf-cat');
  for (let i = 0; i < catSel.options.length; i++) {
    if (catSel.options[i].value === d.categoria) {
      catSel.selectedIndex = i;
      break;
    }
  }
  fillSubs();

  // Subcategoría
  const subSel = V('cf-sub');
  if (d.subcategoria) {
    for (let i = 0; i < subSel.options.length; i++) {
      if (subSel.options[i].value === d.subcategoria) {
        subSel.selectedIndex = i;
        break;
      }
    }
  }

  // Quién pagó
  V('cf-who').value = d.quien_pago === 'Carolina' ? 'Carolina' : 'Luis';

  // Método de pago — match exacto y luego por keyword
  matchMetodo(d.metodo_pago || '');

  go('conf');
}

function matchMetodo(metodoPago) {
  const mth = V('cf-mth');
  const mp = metodoPago.toLowerCase();
  let matched = false;
  for (let i = 0; i < mth.options.length; i++) {
    if (mth.options[i].value.toLowerCase() === mp) {
      mth.selectedIndex = i;
      matched = true;
      break;
    }
  }
  if (!matched) {
    const terms = [
      ['iwin', 'iWin'], ['jeeves', 'iWin'], ['nequi', 'Nequi'],
      ['colpatria', 'Colpatria'], ['serfinanza', 'Serfinanza'],
      ['mercury', 'Mercury'], ['dollar', 'Dollar'], ['efectivo', 'Efectivo'],
      ['bancolombia', 'Bancolombia'],
    ];
    for (const [k, v] of terms) {
      if (mp.includes(k)) {
        for (let i = 0; i < mth.options.length; i++) {
          if (mth.options[i].value.toLowerCase().includes(v.toLowerCase())) {
            mth.selectedIndex = i;
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
    }
  }
  // Actualiza aviso iWin según el método finalmente seleccionado.
  const iwin = isIwinAccount(mth.value);
  curIsIwin = curIsIwin || iwin;
  V('iwin-wrap').style.display = curIsIwin ? 'flex' : 'none';
}

function onTarjetaInput(val) {
  const resolved = V('cf-tarjeta-resolved');
  if (val.length === 4) {
    const account = resolveCard(val);
    if (account) {
      resolved.textContent = '✓ ' + account;
      resolved.style.color = 'var(--teal)';
      const mth = V('cf-mth');
      for (let i = 0; i < mth.options.length; i++) {
        if (mth.options[i].value.includes(val) || mth.options[i].value === account) {
          mth.selectedIndex = i;
          curIsIwin = isIwinAccount(mth.value);
          V('iwin-wrap').style.display = curIsIwin ? 'flex' : 'none';
          break;
        }
      }
    } else {
      resolved.textContent = '⚠ Tarjeta no registrada en ⚙️ CUENTAS';
      resolved.style.color = 'var(--gold)';
    }
  } else {
    resolved.textContent = '';
  }
}

function initCats() {
  const sel = V('cf-cat');
  sel.innerHTML = '';
  Object.keys(CATS).forEach((c) => {
    const o = document.createElement('option');
    o.value = o.textContent = c;
    sel.appendChild(o);
  });
  fillSubs();
}

function fillSubs() {
  const cat = V('cf-cat').value;
  const sel = V('cf-sub');
  sel.innerHTML = '';
  subcategorias(cat).forEach((s) => {
    const o = document.createElement('option');
    o.value = o.textContent = s;
    sel.appendChild(o);
  });
}

// ── Guardar en Sheets ─────────────────────────────────────
async function submit() {
  if (!isSignedIn()) {
    const okc = await connect({ forcePrompt: true });
    if (!okc) return;
  }
  doSheet();
}

async function doSheet(confirmar = false) {
  go('proc');
  V('proc-msg').textContent = 'Guardando…';
  const fecha = V('cf-fecha').value;
  const monto = parseFloat(V('cf-monto').value) || 0;
  const cat = V('cf-cat').value;
  const sub = V('cf-sub').value;
  const desc = V('cf-desc').value;
  const quien = V('cf-who').value;
  const metodo = V('cf-mth').value;
  const notas = V('cf-note').value;
  const tarjeta = V('cf-tarjeta').value.trim();

  try {
    // El backend clasifica lo que falte, aplica reglas iWin/Delca2, deduplica y
    // escribe el gasto + el flujo EMPRESAS. Aquí ya mandamos categoría/cuenta.
    const r = await apiRegistrar({
      tipo: 'gasto', fecha, monto, categoria: cat, subcategoria: sub,
      descripcion: desc, quien_pago: quien, metodo_pago: metodo,
      tarjeta_ultimos4: tarjeta, notas, confirmar,
    });

    // Posible duplicado → preguntar y reintentar forzando si el usuario acepta.
    if (r && r.registrado === false && r.posible_duplicado) {
      if (confirm(`${r.mensaje}\n\n(Aceptar = guardar igual · Cancelar = no)`)) {
        return doSheet(true);
      }
      go('conf');
      return;
    }

    const empresas = !!(r.retiro_delca2 || r.adelanto_empresas);
    addHistory({ fecha, monto, cat, sub, desc, quien, ts: new Date().toISOString(), iwin: empresas });
    renderHomeH();

    V('ok-amt').textContent = formatCOP(monto);
    V('ok-det').textContent =
      `${cat} · ${quien} · ${fecha}${r.actualizado ? ' · ✏️ actualizado' : ''}${empresas ? ' · 🏢 EMPRESAS' : ''}`;
    go('ok');
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      const okc = await connect({ forcePrompt: true });
      if (okc) return doSheet(confirmar);
    }
    toast('Error: ' + e.message);
    go('conf');
  }
}

/** POST a la API de finanzas (mismo origen) con el token de Google. */
async function apiRegistrar(mov) {
  const token = await getAccessToken();
  const cfg = getConfig();
  const base = (cfg.apiBaseUrl || '').replace(/\/$/, '');
  const res = await fetch(`${base}/api/pwa-registrar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(mov),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Historial ─────────────────────────────────────────────
function hItemHTML(h, short) {
  const iwinTag = h.iwin
    ? ' <span style="font-size:10px;background:#EEEDFE;color:#534AB7;padding:1px 5px;border-radius:4px;font-weight:600">iWin</span>'
    : '';
  return `<div class="h-item">
    <div><div class="h-name">${h.desc || h.cat}${iwinTag}</div><div class="h-meta">${h.sub || h.cat}${short ? '' : ' · ' + h.fecha}</div></div>
    <div><div class="h-amt">${formatCOP(h.monto)}</div><div class="h-who">${h.quien}</div></div>
  </div>`;
}

function renderHomeH() {
  const c = V('home-hist');
  const h = getHistory(3);
  c.innerHTML = h.length ? h.map((x) => hItemHTML(x, true)).join('') : '<div class="empty">Aún no hay registros</div>';
}

function renderH() {
  const c = V('hist-list');
  const h = getHistory();
  c.innerHTML = h.length ? h.map((x) => hItemHTML(x, false)).join('') : '<div class="empty">Sin registros aún</div>';
}

function clearHist() {
  if (confirm('¿Borrar historial local?')) {
    clearHistory();
    renderH();
    renderHomeH();
  }
}

// ── CET ───────────────────────────────────────────────────
function fillCetCuentaSelect(sel) {
  sel.innerHTML = '';
  CET_CUENTAS.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.value;
    o.textContent = c.label;
    sel.appendChild(o);
  });
}

function initCET() {
  if (!V('cet-desde').options.length) fillCetCuentaSelect(V('cet-desde'));
  if (!V('cet-dest-cuenta').options.length) fillCetCuentaSelect(V('cet-dest-cuenta'));
  V('cet-fecha').value = today();
  actualizarCET();
}

function onCetTipoDest() {
  const tipo = V('cet-tipo-dest').value;
  const esExterno = tipo === 'externo';
  V('cet-dest-externo-wrap').style.display = esExterno ? 'block' : 'none';
  V('cet-dest-cuenta-wrap').style.display = esExterno ? 'none' : 'block';
  actualizarCET();
}

function cetFechaCorta(fechaISO) {
  const [y, m, d] = fechaISO.split('-');
  return d + m + y.slice(2);
}

function cetDestino() {
  const tipo = V('cet-tipo-dest').value;
  if (tipo === 'externo') return V('cet-dest-externo').value.trim();
  return 'Cta ' + V('cet-dest-cuenta').value;
}

function generarAsuntoCET() {
  const fecha = V('cet-fecha').value;
  const moneda = V('cet-moneda').value;
  const monto = V('cet-monto').value || '0';
  const desde = V('cet-desde').value;
  const destino = cetDestino();
  const concepto = V('cet-concepto').value.trim();
  if (!fecha || !monto || !destino) return null;
  return `CET ${cetFechaCorta(fecha)} por ${moneda} ${parseInt(monto).toLocaleString('es-CO')} desde Cta ${desde} a ${destino}${concepto ? ' - ' + concepto : ''}`;
}

function actualizarCET() {
  V('cet-preview').textContent = generarAsuntoCET() || '—';
}

function abrirMailCET() {
  const asunto = generarAsuntoCET();
  if (!asunto) return toast('Completa los campos obligatorios');
  window.open(`mailto:cetladca@gmail.com?subject=${encodeURIComponent(asunto)}`, '_blank');
}

async function registrarCET() {
  if (!isSignedIn()) {
    const okc = await connect({ forcePrompt: true });
    if (!okc) return;
  }
  const asunto = generarAsuntoCET();
  if (!asunto) return toast('Completa los campos obligatorios');

  const cfg = getConfig();
  const fecha = V('cet-fecha').value;
  const monto = parseFloat(V('cet-monto').value) || 0;
  const moneda = V('cet-moneda').value;
  const desde = V('cet-desde').value;
  const destino = cetDestino();
  const concepto = V('cet-concepto').value.trim();
  const mes = new Date(fecha + 'T12:00:00').getMonth() + 1;
  const tipo = V('cet-tipo-dest').value;

  let cat, sub, quien;
  if (tipo === 'cuenta-luis') {
    cat = 'Personal LADCC'; sub = 'Gastos Personales LADCC'; quien = 'Luis';
  } else if (tipo === 'cuenta-caro') {
    cat = 'Personal CMDG'; sub = 'Gastos Personales CMDG'; quien = 'Luis';
  } else {
    cat = 'Imprevistos'; sub = 'Otros'; quien = 'Luis';
  }

  const tarjeta = desde;
  const metodo = resolveCard(tarjeta) || 'Bcol Cta ' + desde;
  const notas = asunto;

  go('proc');
  V('proc-msg').textContent = 'Registrando CET…';
  const row = [fecha, mes, cat, sub, concepto || destino, monto, metodo, quien, notas, tarjeta];

  try {
    await appendValues(cfg.sheetGastos, row, 'A:J');
    addHistory({ fecha, monto, cat, sub, desc: concepto || destino, quien, ts: new Date().toISOString() });
    renderHomeH();

    V('ok-amt').textContent = (moneda === 'USD' ? 'USD ' : '$') + monto.toLocaleString('es-CO');
    V('ok-det').textContent = `CET registrado · ${destino} · ${fecha}`;
    go('ok');

    setTimeout(() => {
      window.open(`mailto:cetladca@gmail.com?subject=${encodeURIComponent(asunto)}`, '_blank');
    }, 800);
  } catch (e) {
    if (e.status === 401) {
      const okc = await connect({ forcePrompt: true });
      if (okc) return registrarCET();
    }
    toast('Error: ' + e.message);
    go('cet');
  }
}

// ── Cableado de eventos (delegación) ──────────────────────
const ACTIONS = {
  saveSetup, saveCfg, resetAll, signOut, doText, submit,
  abrirMailCET, registrarCET, clearHist,
  trigCam: () => V('cam-in').click(),
  trigGal: () => V('gal-in').click(),
};

function wireEvents() {
  document.addEventListener('click', (e) => {
    const goEl = e.target.closest('[data-go]');
    if (goEl) return go(goEl.dataset.go);
    const actEl = e.target.closest('[data-act]');
    if (actEl) {
      const fn = ACTIONS[actEl.dataset.act];
      if (fn) fn();
      return;
    }
    const exEl = e.target.closest('[data-ex]');
    if (exEl) V('ti-val').value = exEl.textContent;
  });

  V('cam-in').addEventListener('change', function () { onImg(this); });
  V('gal-in').addEventListener('change', function () { onImg(this); });
  V('cf-cat').addEventListener('change', fillSubs);
  V('cf-tarjeta').addEventListener('input', (e) => onTarjetaInput(e.target.value));
  V('cf-mth').addEventListener('change', () => {
    const iwin = isIwinAccount(V('cf-mth').value);
    curIsIwin = iwin;
    V('iwin-wrap').style.display = iwin ? 'flex' : 'none';
  });

  // CET reactivo
  ['cet-monto', 'cet-desde', 'cet-dest-externo', 'cet-dest-cuenta', 'cet-concepto', 'cet-fecha', 'cet-moneda']
    .forEach((id) => {
      const el = V(id);
      if (el) el.addEventListener('input', actualizarCET);
      if (el) el.addEventListener('change', actualizarCET);
    });
  V('cet-tipo-dest').addEventListener('change', onCetTipoDest);
}

// ── Init ──────────────────────────────────────────────────
function init() {
  loadHistory();
  initCats();
  buildAccountsDropdown(CUENTAS_FALLBACK);
  V('ti-dt').value = today();
  V('hdr-sub').textContent = fmtDate(new Date());
  wireEvents();

  const cfg = getConfig();
  // Precarga campos de setup con lo que exista.
  if (cfg.anthropicApiKey) V('s-ak').value = cfg.anthropicApiKey;
  if (cfg.googleClientId) V('s-gc').value = cfg.googleClientId;
  if (cfg.spreadsheetId) V('s-si').value = cfg.spreadsheetId;
  V('s-st').value = cfg.sheetGastos || 'Registro Gastos';
  V('s-se').value = cfg.sheetEmpresas || 'EMPRESAS';

  // La PWA viene pre-configurada (Client ID y Spreadsheet por defecto) y ya no
  // necesita la Anthropic key (la clasificación es server-side). Un dispositivo
  // nuevo va directo a Home; solo inicia sesión con Google al primer uso.
  if (!cfg.googleClientId || !cfg.spreadsheetId) {
    go('setup');
  } else {
    go('home');
    renderHomeH();
    connect();
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
