/**
 * services/claude.js — Wrapper de la API de Anthropic para la PWA (navegador).
 *
 * Migra el flujo de clasificación que en DCDG_Captura_v5.html estaba embebido
 * y hardcodeado. Mejoras respecto al monolito:
 *   - Modelo configurable (fix del deprecado claude-sonnet-4-20250514 → claude-sonnet-4-6).
 *   - Manejo de errores explícito (throws con mensaje útil para feedback visual).
 *   - Reglas DCDG aplicadas primero (barato/determinístico) antes del modelo.
 *   - Soporta texto e imagen (recibo) con el bloque de visión de Claude.
 *
 * Nota de arquitectura: este wrapper llama a Anthropic DIRECTO desde el browser,
 * como el original (header anthropic-dangerous-direct-browser-access). Para la
 * ruta de WhatsApp/SilvIA la clasificación ocurre en el backend
 * (netlify/functions/_lib/anthropic.js) para no exponer la API key.
 */

import { getConfig } from '../config/env.js';
import { classifyByRules, CATEGORIAS } from '../config/rules.js';
import { NOMBRES_CUENTAS, PERSONAS } from '../config/accounts.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Construye el prompt de sistema con el vocabulario DCDG vigente. */
function buildSystemPrompt() {
  return [
    'Eres el clasificador de gastos de la familia DCDG (Colombia, montos en COP).',
    'Devuelve SOLO un objeto JSON válido, sin texto adicional, con estas claves:',
    '{ "categoria", "subcategoria", "quien_pago", "metodo_pago", "monto",',
    '  "tarjeta_ultimos4", "iwin_prestamo", "confianza" }.',
    '',
    `Categorías conocidas: ${CATEGORIAS.join(', ')}.`,
    `Cuentas / métodos de pago válidos: ${NOMBRES_CUENTAS.join(', ')}.`,
    `"quien_pago" ∈ {${PERSONAS.join(', ')}}.`,
    '"monto" es número en COP (sin separadores). "tarjeta_ultimos4" son 4 dígitos o "".',
    '"iwin_prestamo" = true solo si se pagó con la TC iWin/Jeeves (Superlikers).',
    '"confianza" es un número entre 0 y 1.',
    'Si un pago con tarjeta Jeeves/iWin es por un gasto personal, marca iwin_prestamo=true.',
  ].join('\n');
}

/** Extrae el primer objeto JSON de un texto de respuesta del modelo. */
function extractJson(text) {
  if (!text) throw new Error('Respuesta vacía del modelo');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('El modelo no devolvió JSON: ' + text.slice(0, 200));
  }
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Llama a la API de mensajes de Anthropic.
 * @param {Object} opts
 * @param {Array}  opts.content   Bloques de contenido del mensaje user.
 * @param {string} [opts.model]
 * @param {string} [opts.system]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<string>} texto concatenado de la respuesta.
 */
export async function callAnthropic({ content, model, system, maxTokens = 1024 } = {}) {
  const cfg = getConfig();
  if (!cfg.anthropicApiKey) {
    throw new Error('Falta la API key de Anthropic. Configúrala en Ajustes.');
  }
  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.anthropicApiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: model || cfg.anthropicModel,
        max_tokens: maxTokens,
        system: system || undefined,
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (netErr) {
    throw new Error('Error de red al contactar Anthropic: ' + netErr.message);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch (_) {
      detail = await res.text().catch(() => '');
    }
    throw new Error(`Anthropic ${res.status}: ${detail}`);
  }

  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Clasifica un gasto a partir de TEXTO manual.
 * Primero intenta las reglas DCDG; si no hay match, cae al modelo.
 * @param {string} texto
 * @returns {Promise<Object>} objeto de clasificación normalizado.
 */
export async function clasificarTexto(texto) {
  const porRegla = classifyByRules(texto);
  const base = {
    categoria: '', subcategoria: '', quien_pago: '', metodo_pago: '',
    monto: null, tarjeta_ultimos4: '', iwin_prestamo: false, confianza: 0,
  };

  const raw = await callAnthropic({
    system: buildSystemPrompt(),
    content: [{ type: 'text', text: `Clasifica este gasto:\n"""${texto}"""` }],
  });
  const modelOut = extractJson(raw);

  // Las reglas determinísticas tienen prioridad sobre categoría/subcategoría.
  const merged = { ...base, ...modelOut };
  if (porRegla) {
    merged.categoria = porRegla.categoria;
    merged.subcategoria = porRegla.subcategoria;
    if (porRegla.metodo_pago) merged.metodo_pago = porRegla.metodo_pago;
    if (porRegla.iwin_prestamo) merged.iwin_prestamo = true;
    merged.confianza = Math.max(Number(merged.confianza) || 0, 0.9);
    merged._regla = porRegla.regla;
  }
  return merged;
}

/**
 * Clasifica un gasto a partir de una IMAGEN de recibo (visión).
 * @param {string} base64  imagen en base64 (sin el prefijo data:).
 * @param {string} mediaType  p.ej. 'image/jpeg'
 * @returns {Promise<Object>}
 */
export async function clasificarImagen(base64, mediaType = 'image/jpeg') {
  const raw = await callAnthropic({
    system: buildSystemPrompt(),
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: 'Extrae y clasifica el gasto de este recibo.' },
    ],
  });
  const modelOut = extractJson(raw);
  // Refuerza con reglas usando la descripción/comercio detectado.
  const porRegla = classifyByRules(modelOut.subcategoria || modelOut.descripcion || '');
  if (porRegla) {
    modelOut.categoria = porRegla.categoria;
    modelOut.subcategoria = porRegla.subcategoria;
  }
  return modelOut;
}
