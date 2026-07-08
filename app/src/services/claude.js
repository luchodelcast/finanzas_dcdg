/**
 * services/claude.js — Clasificación de gastos de la PWA (vía backend).
 *
 * Antes la PWA llamaba a Anthropic DIRECTO desde el navegador, lo que obligaba a
 * guardar la API key en cada dispositivo (localStorage) y a re-pedirla en cada
 * equipo nuevo. Ahora la clasificación ocurre en el BACKEND (`/api/pwa-clasificar`),
 * que usa la ANTHROPIC_API_KEY del servidor y autentica al usuario con su login de
 * Google. Así el navegador nunca necesita la API key: en un dispositivo nuevo basta
 * con iniciar sesión con Google.
 *
 * El prompt DCDG y el shape de salida viven en el backend (mismo prompt que antes).
 */

import { getConfig } from '../config/env.js';
import { getSessionToken } from './auth.js';

/** POST al endpoint de clasificación del backend, autenticado con el token de sesión. */
async function callBackend(body) {
  const token = await getSessionToken();
  const cfg = getConfig();
  // Mismo origen por defecto (la PWA y las Functions viven en dcdg.netlify.app).
  const base = (cfg.apiBaseUrl || '').replace(/\/$/, '');
  let res;
  try {
    res = await fetch(`${base}/api/pwa-clasificar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    throw new Error('Error de red al clasificar: ' + netErr.message);
  }
  if (!res.ok) {
    let msg = `Error del servidor (${res.status})`;
    try {
      const e = await res.json();
      msg = e.error || msg;
    } catch (_) {
      /* keep default */
    }
    if (res.status === 401 || res.status === 403) {
      msg = 'Sesión de Google no autorizada. Reconecta con tu cuenta (Luis o Carolina).';
    }
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Clasifica un gasto a partir de TEXTO manual.
 * @param {string} texto
 * @param {string} fecha  YYYY-MM-DD
 * @returns {Promise<Object>} shape DCDG completo.
 */
export async function analizarTexto(texto, fecha) {
  const d = await callBackend({ texto, fecha });
  if (!d.fecha || d.fecha === 'YYYY-MM-DD') d.fecha = fecha;
  return d;
}

/**
 * Clasifica un gasto a partir de un comprobante adjunto: IMAGEN (visión) o PDF
 * (bloque `document` nativo de Anthropic — solo 1 página, ver
 * `utils/pdfProcessor.js`). El nombre del campo se mantiene genérico (`imagen`)
 * por compatibilidad; `mediaType` es lo que decide cómo se arma el bloque en
 * el backend (`buildReceiptContent` en `_lib/anthropic.js`).
 * @param {string} base64  datos en base64 (sin prefijo data:)
 * @param {string} mediaType  p.ej. 'image/jpeg' o 'application/pdf'
 * @returns {Promise<Object>}
 */
export async function analizarImagen(base64, mediaType = 'image/jpeg') {
  return callBackend({ imagen: base64, media_type: mediaType });
}
