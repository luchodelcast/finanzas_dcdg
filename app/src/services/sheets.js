/**
 * services/sheets.js — Wrapper de Google Sheets API para la PWA.
 *
 * Migra la escritura a Sheets del monolito. Punto crítico (sección 9 del doc):
 * el endpoint `:append` FALLA con emoji en el nombre de hoja (`⚙️ CUENTAS`).
 * Solución confirmada: usar `:batchUpdate` con el `sheetId` NUMÉRICO.
 *
 * La autenticación (token OAuth) se obtiene de services/auth.js.
 */

import { getConfig } from '../config/env.js';
import { getAccessToken } from './auth.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function authedFetch(url, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Sheets ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/** Cache de metadatos de hojas (nombre → sheetId numérico). */
let _sheetIdCache = null;

/** Obtiene el sheetId numérico de una hoja por su nombre (con cache). */
export async function getSheetId(sheetName) {
  const cfg = getConfig();
  if (!_sheetIdCache) {
    const meta = await authedFetch(
      `${BASE}/${cfg.spreadsheetId}?fields=sheets(properties(sheetId,title))`
    );
    _sheetIdCache = new Map(
      (meta.sheets || []).map((s) => [s.properties.title, s.properties.sheetId])
    );
  }
  const id = _sheetIdCache.get(sheetName);
  if (id == null) throw new Error(`Hoja no encontrada: "${sheetName}"`);
  return id;
}

/** Convierte un array de valores en el formato rowData de la API. */
function toRowData(values) {
  return {
    values: values.map((v) => {
      if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };
      if (v && String(v).startsWith('=')) {
        return { userEnteredValue: { formulaValue: String(v) } };
      }
      return { userEnteredValue: { stringValue: v == null ? '' : String(v) } };
    }),
  };
}

/**
 * Agrega una fila a una hoja usando batchUpdate + sheetId numérico.
 * Seguro con nombres de hoja que contienen emoji.
 * @param {string} sheetName
 * @param {Array<string|number>} rowValues
 */
export async function appendRow(sheetName, rowValues) {
  const cfg = getConfig();
  const sheetId = await getSheetId(sheetName);
  return authedFetch(`${BASE}/${cfg.spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          appendCells: {
            sheetId,
            rows: [toRowData(rowValues)],
            fields: 'userEnteredValue',
          },
        },
      ],
    }),
  });
}

/** Lee un rango con la API de values (para nombres SIN emoji). */
export async function readRange(rangeA1) {
  const cfg = getConfig();
  const data = await authedFetch(
    `${BASE}/${cfg.spreadsheetId}/values/${encodeURIComponent(rangeA1)}`
  );
  return data.values || [];
}

/** Invalida el cache de sheetIds (tras crear/renombrar hojas). */
export function clearSheetCache() {
  _sheetIdCache = null;
}
