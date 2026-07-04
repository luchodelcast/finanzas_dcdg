/**
 * services/history.js — Historial local de registros (localStorage).
 * Portado de la lógica `hist`/`save` del monolito.
 */

const LS_KEY = 'dcdg_hist';
const MAX = 100;

let _hist = [];

/** Carga el historial desde localStorage. */
export function loadHistory() {
  try {
    _hist = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch (_) {
    _hist = [];
  }
  return _hist;
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(_hist));
  } catch (e) {
    console.error('No se pudo guardar el historial:', e);
  }
}

/** Agrega un registro al inicio (mantiene máx. 100). */
export function addHistory(entry) {
  _hist.unshift(entry);
  if (_hist.length > MAX) _hist.pop();
  persist();
  return _hist;
}

/** Devuelve el historial (opcionalmente los primeros n). */
export function getHistory(n) {
  return n ? _hist.slice(0, n) : _hist;
}

/** Vacía el historial. */
export function clearHistory() {
  _hist = [];
  persist();
}
