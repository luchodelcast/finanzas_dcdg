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

/** Lee un rango con la API de values. */
export async function readRange(rangeA1) {
  const cfg = getConfig();
  const data = await authedFetch(
    `${BASE}/${cfg.spreadsheetId}/values/${encodeURIComponent(rangeA1)}`
  );
  return data.values || [];
}

/**
 * Agrega una fila con la API `values:append` (como el monolito).
 * Válido para hojas SIN emoji en el nombre (Registro Gastos, EMPRESAS).
 * Devuelve el status HTTP crudo para poder detectar 401 y re-autenticar.
 */
export async function appendValues(sheetName, rowValues, rangeCols = 'A:J') {
  const cfg = getConfig();
  const token = await getAccessToken();
  const range = encodeURIComponent(`'${sheetName}'!${rangeCols}`);
  const url =
    `${BASE}/${cfg.spreadsheetId}/values/${range}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values: [rowValues] }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const e = await res.json();
      detail = e?.error?.message || '';
    } catch (_) {
      detail = await res.text().catch(() => '');
    }
    const err = new Error(`Sheets ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Carga las cuentas activas desde `⚙️ CUENTAS` (B4:I100).
 * Portado de `loadCuentas` del monolito. La hoja tiene emoji, pero la API de
 * lectura `values` acepta el rango entrecomillado sin problema (el bug de emoji
 * solo afecta a `:append`).
 * @returns {Promise<Array>} cuentas normalizadas.
 */
export async function loadCuentas() {
  const rows = await readRange("'⚙️ CUENTAS'!B4:I100");
  return rows
    .filter((row) => row[0] && row[6] !== 'No')
    .map((row) => ({
      name: row[0] || '',
      banco: row[1] || '',
      titular: row[2] || '',
      moneda: row[3] || 'COP',
      tipo: row[4] || 'Normal',
      tipoEspecial: row[5] || 'Normal',
      activa: row[6] !== 'No',
      tarjeta: String(row[7] || '').trim(),
    }))
    .filter((c) => c.name && c.activa);
}

/** Invalida el cache de sheetIds (tras crear/renombrar hojas). */
export function clearSheetCache() {
  _sheetIdCache = null;
}
