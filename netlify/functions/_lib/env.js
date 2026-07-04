/**
 * _lib/env.js — Lectura de configuración del backend (Netlify Functions / Node).
 * Separa secretos del código (P1 del doc). Falla ruidosamente si falta lo crítico.
 */

export function env(key, fallback = undefined) {
  const v = process.env[key];
  return v == null || v === '' ? fallback : v;
}

export function requireEnv(key) {
  const v = env(key);
  if (v == null) throw new Error(`Falta variable de entorno requerida: ${key}`);
  return v;
}

export const config = {
  // Anthropic
  anthropicApiKey: () => requireEnv('ANTHROPIC_API_KEY'),
  anthropicModel: () => env('ANTHROPIC_MODEL', 'claude-sonnet-4-6'),
  anthropicModelFast: () => env('ANTHROPIC_MODEL_FAST', 'claude-haiku-4-5-20251001'),

  // Sheets
  spreadsheetId: () => requireEnv('GOOGLE_SPREADSHEET_ID'),
  sheetGastos: () => env('SHEET_GASTOS', 'Registro Gastos'),
  sheetEmpresas: () => env('SHEET_EMPRESAS', 'EMPRESAS'),
  sheetCuentas: () => env('SHEET_CUENTAS', '⚙️ CUENTAS'),

  // Service Account
  saEmail: () => requireEnv('GOOGLE_SA_EMAIL'),
  saPrivateKey: () => normalizeKey(requireEnv('GOOGLE_SA_PRIVATE_KEY')),

  // Integración SilvIA
  apiToken: () => requireEnv('DCDG_API_TOKEN'),
  finanzasUsers: () =>
    String(env('FINANZAS_USERS', 'luis@iwin.im,carodz2@gmail.com'))
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
};

/** Normaliza la clave privada PEM (Netlify suele escapar los saltos de línea). */
function normalizeKey(raw) {
  let k = String(raw).trim();
  // Quita comillas envolventes si las hay.
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  // Convierte "\n" literales en saltos reales.
  if (k.includes('\\n')) k = k.replace(/\\n/g, '\n');
  return k;
}
