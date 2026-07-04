/**
 * _lib/sheets.js — Cliente de Google Sheets con Service Account (backend).
 *
 * Autentica con una cuenta de servicio (JWT RS256 → access token OAuth2),
 * sin sesión de usuario ni navegador — ideal para el bot.
 *
 * Escribe con `:batchUpdate` + sheetId numérico para ser inmune al bug de
 * emoji en nombres de hoja (`⚙️ CUENTAS`, sección 9 del doc). Sin dependencias:
 * usa `node:crypto` y `fetch` global (Node 22).
 */

import { createSign } from 'node:crypto';
import { config } from './env.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

let _token = null;
let _tokenExp = 0;

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Firma un JWT de service account y lo intercambia por un access token. */
async function getAccessToken(now = Date.now()) {
  if (_token && now < _tokenExp - 60_000) return _token;

  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: config.saEmail(),
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(config.saPrivateKey(), 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OAuth SA ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  _token = data.access_token;
  _tokenExp = now + (Number(data.expires_in) || 3600) * 1000;
  return _token;
}

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

let _sheetIdCache = null;

/** sheetId numérico por nombre (con cache). */
export async function getSheetId(sheetName) {
  const id = config.spreadsheetId();
  if (!_sheetIdCache) {
    const meta = await authedFetch(
      `${SHEETS_BASE}/${id}?fields=sheets(properties(sheetId,title))`
    );
    _sheetIdCache = new Map(
      (meta.sheets || []).map((s) => [s.properties.title, s.properties.sheetId])
    );
  }
  const sid = _sheetIdCache.get(sheetName);
  if (sid == null) throw new Error(`Hoja no encontrada: "${sheetName}"`);
  return sid;
}

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

/** Agrega una fila (segura ante emojis en el nombre de hoja). */
export async function appendRow(sheetName, rowValues) {
  const id = config.spreadsheetId();
  const sheetId = await getSheetId(sheetName);
  return authedFetch(`${SHEETS_BASE}/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        { appendCells: { sheetId, rows: [toRowData(rowValues)], fields: 'userEnteredValue' } },
      ],
    }),
  });
}

/** Lee un rango A1 (values API; usar solo con nombres SIN emoji). */
export async function readRange(rangeA1) {
  const id = config.spreadsheetId();
  const data = await authedFetch(
    `${SHEETS_BASE}/${id}/values/${encodeURIComponent(rangeA1)}`
  );
  return data.values || [];
}

// Exportado para tests: permite inyectar dependencias sin red real.
export const __internals = { getAccessToken, b64url };
