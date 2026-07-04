/**
 * config/env.js — Configuración centralizada de la PWA (navegador).
 *
 * Reemplaza la config hardcodeada del monolito DCDG_Captura_v5.html.
 * En el navegador la configuración se toma de:
 *   1. Variables de build de Vite (import.meta.env.VITE_*), y
 *   2. Overrides guardados por el usuario en localStorage (clave "dcdg_cfg").
 *
 * El backend (Netlify Functions) tiene su propio lector de env en
 * netlify/functions/_lib/env.js — este archivo es solo para el cliente.
 */

const LS_KEY = 'dcdg_cfg';

// Lee import.meta.env de forma segura (también fuera de Vite, p.ej. en tests).
function viteEnv(key, fallback = '') {
  try {
    // eslint-disable-next-line no-undef
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key] != null) {
      // eslint-disable-next-line no-undef
      return import.meta.env[key];
    }
  } catch (_) {
    /* import.meta no disponible en este runtime */
  }
  return fallback;
}

function readLocal() {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

/**
 * Valores por defecto tomados del contexto DCDG (sección 4 y 8 del doc).
 * Los secretos (API key) NO tienen default: deben venir de env o del usuario.
 */
const DEFAULTS = {
  anthropicModel: 'claude-sonnet-4-6',
  anthropicModelFast: 'claude-haiku-4-5-20251001',
  googleClientId: '473061009211-972b11u9s6gpqln7n0e6tdn51vjmnv5p.apps.googleusercontent.com',
  spreadsheetId: '1c5i7gOqsRU0CCcg-B6rDDP0MlQWuQmFuT2X90Q5N4NQ',
  sheetGastos: 'Registro Gastos',
  sheetEmpresas: 'EMPRESAS',
  sheetCuentas: '⚙️ CUENTAS',
};

/**
 * Devuelve la configuración efectiva: DEFAULTS < VITE env < localStorage.
 */
export function getConfig() {
  const local = readLocal();
  return {
    // Secretos / credenciales
    anthropicApiKey: local.ak || viteEnv('VITE_ANTHROPIC_API_KEY', ''),
    googleClientId: local.gc || viteEnv('VITE_GOOGLE_CLIENT_ID', DEFAULTS.googleClientId),

    // Modelos
    anthropicModel: local.am || viteEnv('VITE_ANTHROPIC_MODEL', DEFAULTS.anthropicModel),
    anthropicModelFast:
      local.amf || viteEnv('VITE_ANTHROPIC_MODEL_FAST', DEFAULTS.anthropicModelFast),

    // Sheets
    spreadsheetId: local.si || viteEnv('VITE_GOOGLE_SPREADSHEET_ID', DEFAULTS.spreadsheetId),
    sheetGastos: local.st || viteEnv('VITE_SHEET_GASTOS', DEFAULTS.sheetGastos),
    sheetEmpresas: local.se || viteEnv('VITE_SHEET_EMPRESAS', DEFAULTS.sheetEmpresas),
    sheetCuentas: local.sc || viteEnv('VITE_SHEET_CUENTAS', DEFAULTS.sheetCuentas),

    // Backend opcional (si la PWA delega en la API de este repo)
    apiBaseUrl: local.api || viteEnv('VITE_DCDG_API_URL', ''),
  };
}

/**
 * Persiste overrides del usuario en localStorage. Recibe el mismo shape corto
 * que usaba el monolito ({ ak, gc, si, st, se, ... }) para compatibilidad.
 */
export function saveConfig(partial) {
  const current = readLocal();
  const next = { ...current, ...partial };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch (e) {
    console.error('No se pudo guardar la configuración:', e);
  }
  return next;
}

/**
 * Valida que la configuración mínima para operar esté presente.
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function validateConfig(cfg = getConfig()) {
  const missing = [];
  if (!cfg.anthropicApiKey && !cfg.apiBaseUrl) missing.push('anthropicApiKey');
  if (!cfg.googleClientId) missing.push('googleClientId');
  if (!cfg.spreadsheetId) missing.push('spreadsheetId');
  return { ok: missing.length === 0, missing };
}

export const CONFIG_LS_KEY = LS_KEY;
