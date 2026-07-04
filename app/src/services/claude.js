/**
 * services/claude.js — Wrapper de la API de Anthropic para la PWA (navegador).
 *
 * Migra el flujo de clasificación del monolito (`callClaude`, `doImg`, `doText`).
 * Mejoras respecto al monolito:
 *   - Modelo configurable (fix del deprecado claude-sonnet-4-20250514 → claude-sonnet-4-6).
 *   - Config separada del código (config/env.js).
 *   - Manejo de errores explícito para feedback visual.
 * Mantiene el mismo system prompt DCDG (config/prompt.js) y el mismo shape de
 * salida para no romper la paridad con el monolito.
 */

import { getConfig } from '../config/env.js';
import { buildSystemPrompt } from '../config/prompt.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 600;

/** Llama a la API de mensajes de Anthropic y devuelve el texto de respuesta. */
async function callAnthropic(content) {
  const cfg = getConfig();
  if (!cfg.anthropicApiKey) {
    throw new Error('Falta la API key de Anthropic. Configúrala en Ajustes.');
  }
  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.anthropicApiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.anthropicModel, // configurable; def claude-sonnet-4-6
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (netErr) {
    throw new Error('Error de red al contactar Anthropic: ' + netErr.message);
  }
  if (!res.ok) {
    let msg = 'API error';
    try {
      const e = await res.json();
      msg = e?.error?.message || msg;
    } catch (_) {
      /* keep default */
    }
    throw new Error(`Anthropic ${res.status}: ${msg}`);
  }
  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

/** Extrae el objeto JSON de la respuesta (tolera fences ```json). */
function parseJson(raw) {
  const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (_) {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1) return JSON.parse(clean.slice(start, end + 1));
    throw new Error('El modelo no devolvió JSON válido');
  }
}

/**
 * Clasifica un gasto a partir de TEXTO manual.
 * @param {string} texto
 * @param {string} fecha  YYYY-MM-DD (contexto de fecha)
 * @returns {Promise<Object>} objeto de clasificación (shape DCDG completo).
 */
export async function analizarTexto(texto, fecha) {
  const content = [{ type: 'text', text: `Fecha: ${fecha}\nDescripción: ${texto}` }];
  const d = parseJson(await callAnthropic(content));
  if (!d.fecha || d.fecha === 'YYYY-MM-DD') d.fecha = fecha;
  return d;
}

/**
 * Clasifica un gasto a partir de una IMAGEN de recibo (visión).
 * @param {string} base64  imagen base64 (sin prefijo data:)
 * @param {string} mediaType  p.ej. 'image/jpeg'
 * @returns {Promise<Object>}
 */
export async function analizarImagen(base64, mediaType = 'image/jpeg') {
  const content = [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
    { type: 'text', text: 'Extrae los datos de esta transacción o recibo.' },
  ];
  return parseJson(await callAnthropic(content));
}
