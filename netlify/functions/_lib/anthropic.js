/**
 * _lib/anthropic.js — Wrapper de Anthropic para el backend (Node).
 *
 * Versión servidor del wrapper: la API key NUNCA sale al cliente. Se usa como
 * fallback de clasificación cuando las reglas DCDG no matchean, y para la
 * clasificación de recibos por foto que llegan vía WhatsApp (visión).
 */

import { config } from './env.js';

const URL = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

/**
 * @param {Object} opts
 * @param {Array}  opts.content
 * @param {string} [opts.system]
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<string>}
 */
export async function callAnthropic({ content, system, model, maxTokens = 1024 }) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropicApiKey(),
      'anthropic-version': VERSION,
    },
    body: JSON.stringify({
      model: model || config.anthropicModel(),
      max_tokens: maxTokens,
      system: system || undefined,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Extrae el primer objeto JSON de un texto. */
export function extractJson(text) {
  if (!text) throw new Error('Respuesta vacía del modelo');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('El modelo no devolvió JSON');
  return JSON.parse(text.slice(start, end + 1));
}
