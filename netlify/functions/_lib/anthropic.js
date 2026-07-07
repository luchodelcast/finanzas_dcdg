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

/**
 * Límite de tamaño para comprobantes en PDF que llegan al backend (guardarraíl
 * de defensa en profundidad — el cliente ya valida esto antes de mandar, ver
 * `app/src/utils/pdfProcessor.js`). El valor exacto queda como decisión
 * abierta para el dueño (issue #35); este es un placeholder conservador.
 */
export const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Arma el bloque `content` de la Messages API para un comprobante adjunto
 * (imagen o PDF), reusando el mismo flujo de clasificación para ambos.
 * PDF usa el bloque nativo `document` (soportado por la Messages API de
 * Anthropic); solo se admite 1 página por comprobante — el chequeo de páginas
 * en sí corre en el cliente (`contarPaginasPDF`), acá solo validamos tamaño.
 * @param {Object} opts
 * @param {string} opts.base64      datos en base64 (sin prefijo data:)
 * @param {string} [opts.mediaType] p.ej. 'image/jpeg' o 'application/pdf'
 * @returns {Array} bloque `content` para `callAnthropic`
 */
export function buildReceiptContent({ base64, mediaType }) {
  const media_type = mediaType || 'image/jpeg';
  const isPdf = media_type === 'application/pdf';
  if (isPdf) {
    // Tamaño exacto en bytes del base64 decodificado (sin contar padding '=').
    const len = base64.length;
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const approxBytes = Math.floor((len * 3) / 4) - padding;
    if (approxBytes > MAX_PDF_BYTES) {
      const mb = Math.round(MAX_PDF_BYTES / (1024 * 1024));
      throw new Error(`El PDF supera el límite admitido (~${mb} MB).`);
    }
  }
  return [
    { type: isPdf ? 'document' : 'image', source: { type: 'base64', media_type, data: base64 } },
    {
      type: 'text',
      text: isPdf
        ? 'Extrae los datos de este comprobante en PDF (transacción o recibo).'
        : 'Extrae los datos de esta transacción o recibo.',
    },
  ];
}
