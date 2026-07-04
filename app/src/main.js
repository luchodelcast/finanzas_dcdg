/**
 * main.js — Orquestador de la PWA DCDG Finanzas.
 *
 * Reemplaza el <script> monolítico de DCDG_Captura_v5.html conectando los
 * módulos: config, services (claude/sheets/auth) y utils. Cada responsabilidad
 * vive en su módulo; aquí solo se cablea la UI.
 */

import { getConfig, saveConfig, validateConfig } from './config/env.js';
import { clasificarTexto, clasificarImagen } from './services/claude.js';
import { appendRow } from './services/sheets.js';
import { getAccessToken, isSignedIn } from './services/auth.js';
import { procesarRecibo } from './utils/imageProcessor.js';
import { parseMonto, formatCOP, hoyISO, mesDeISO, ultimos4 } from './utils/formatters.js';

const $ = (id) => document.getElementById(id);

function showStatus(msg, kind = 'info') {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${kind}`;
}

let ultimaClasificacion = null;

async function onClasificar() {
  const check = validateConfig();
  if (!check.ok) {
    showStatus('Falta configuración: ' + check.missing.join(', ') + '. Abre Ajustes.', 'err');
    return;
  }
  const texto = $('texto').value.trim();
  const file = $('foto').files[0];
  if (!texto && !file) {
    showStatus('Escribe un gasto o adjunta una foto.', 'err');
    return;
  }
  showStatus('Clasificando con Claude…', 'info');
  try {
    let out;
    if (file) {
      const { base64, mediaType } = await procesarRecibo(file);
      out = await clasificarImagen(base64, mediaType);
    } else {
      out = await clasificarTexto(texto);
    }
    ultimaClasificacion = out;
    $('rCategoria').value = out.categoria || '';
    $('rSubcategoria').value = out.subcategoria || '';
    $('rDescripcion').value = out.descripcion || texto;
    $('rMonto').value = out.monto ?? parseMonto(texto) ?? '';
    $('rMetodo').value = out.metodo_pago || '';
    $('rQuien').value = out.quien_pago || '';
    $('resultado').style.display = 'block';
    showStatus('Revisa y confirma antes de guardar.', 'info');
  } catch (e) {
    showStatus(e.message, 'err');
  }
}

async function onGuardar() {
  try {
    if (!isSignedIn()) await getAccessToken();
    const cfg = getConfig();
    const fecha = hoyISO();
    const monto = parseMonto($('rMonto').value);
    const descripcion = $('rDescripcion').value.trim();
    const metodo = $('rMetodo').value.trim();

    // Registro Gastos columnas A-J (K es fórmula auto-resuelta en la hoja).
    const fila = [
      fecha,                          // A Fecha
      mesDeISO(fecha),                // B Mes
      $('rCategoria').value.trim(),   // C Categoría
      $('rSubcategoria').value.trim(),// D Subcategoría
      descripcion,                    // E Descripción / Comercio
      monto,                          // F Monto (número)
      metodo,                         // G Método de pago
      $('rQuien').value.trim(),       // H Quién pagó
      '',                             // I Notas
      ultimos4(metodo) || (ultimaClasificacion?.tarjeta_ultimos4 || ''), // J Tarjeta
    ];
    showStatus('Guardando en Sheets…', 'info');
    await appendRow(cfg.sheetGastos, fila);
    showStatus(`Guardado ✅ ${$('rCategoria').value} ${formatCOP(monto)}`, 'ok');
    $('resultado').style.display = 'none';
    $('texto').value = '';
    $('foto').value = '';
  } catch (e) {
    showStatus('Error al guardar: ' + e.message, 'err');
  }
}

function onCfg() {
  const cfg = getConfig();
  const ak = prompt('Anthropic API key (sk-ant-…):', cfg.anthropicApiKey || '');
  if (ak != null) saveConfig({ ak: ak.trim() });
  const si = prompt('Google Spreadsheet ID:', cfg.spreadsheetId || '');
  if (si != null) saveConfig({ si: si.trim() });
  showStatus('Configuración guardada.', 'ok');
}

async function onLogin() {
  try {
    await getAccessToken({ forcePrompt: true });
    showStatus('Conectado a Google ✅', 'ok');
  } catch (e) {
    showStatus('No se pudo conectar: ' + e.message, 'err');
  }
}

function init() {
  $('btnClasificar').addEventListener('click', onClasificar);
  $('btnGuardar').addEventListener('click', onGuardar);
  $('btnCfg').addEventListener('click', onCfg);
  $('btnLogin').addEventListener('click', onLogin);
  const check = validateConfig();
  if (!check.ok) showStatus('Configura la app en Ajustes para empezar.', 'info');
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
