/**
 * config/accounts.js — Mapa de cuentas y tarjetas DCDG (sección 5 del doc).
 *
 * La fuente única de verdad en producción es la hoja `⚙️ CUENTAS` del Sheet.
 * Este mapa es un espejo local para resolver tarjeta→cuenta sin round-trip,
 * validar entradas y alimentar prompts. Manténlo sincronizado con la hoja.
 *
 * Módulo puro: reutilizable en PWA, Functions y tests.
 */

/**
 * @typedef {Object} Cuenta
 * @property {string} nombre        Nombre canónico de la cuenta (= Método de pago en Sheet)
 * @property {string} banco
 * @property {string} titular       Luis | Carolina | Familia | ...
 * @property {'COP'|'USD'} moneda
 * @property {string} tipo          Débito | Crédito personal | Crédito corporativo | Nequi | USD | Efectivo
 * @property {string[]} tarjetas    últimos 4 dígitos asociados
 * @property {string} cc            Centro de costo / núcleo
 */

/** @type {Cuenta[]} */
export const CUENTAS = [
  { nombre: 'Bcol 0965', banco: 'Bancolombia', titular: 'Luis', moneda: 'COP', tipo: 'Débito', tarjetas: ['2331'], cc: 'LADCC' },
  { nombre: 'Bcol 3355', banco: 'Bancolombia', titular: 'Luis', moneda: 'COP', tipo: 'Débito', tarjetas: ['6940'], cc: 'LADCC' },
  { nombre: 'Bcol 4549', banco: 'Bancolombia', titular: 'Carolina', moneda: 'COP', tipo: 'Débito', tarjetas: ['5773'], cc: 'LADCC' },
  { nombre: 'Bcol 3164', banco: 'Bancolombia', titular: 'Carolina', moneda: 'COP', tipo: 'Débito', tarjetas: ['4550'], cc: 'CMDG-Sebas' },
  { nombre: 'Bcol 5688', banco: 'Bancolombia', titular: 'Carolina', moneda: 'COP', tipo: 'Débito', tarjetas: ['1360'], cc: 'Ahinoa' },
  { nombre: 'TC iWin (Superlikers)', banco: 'Jeeves', titular: 'Superlikers', moneda: 'USD', tipo: 'Crédito corporativo', tarjetas: [], cc: 'LADCC' },
  { nombre: 'Nequi Luis', banco: 'Nequi', titular: 'Luis', moneda: 'COP', tipo: 'Nequi-Billetera', tarjetas: [], cc: 'LADCC' },
  { nombre: 'Nequi Carolina', banco: 'Nequi', titular: 'Carolina', moneda: 'COP', tipo: 'Nequi-Billetera', tarjetas: [], cc: 'CMDG' },
  { nombre: 'Mercury DELCA2', banco: 'Mercury', titular: 'Luis/Carolina', moneda: 'USD', tipo: 'Cuenta USD', tarjetas: [], cc: 'LADCC/CMDG' },
  { nombre: 'DollarApp', banco: 'DollarApp', titular: 'Luis', moneda: 'USD', tipo: 'Cuenta USD', tarjetas: [], cc: 'LADCC' },
];

/** Índice tarjeta(4 dígitos) → cuenta. */
const TARJETA_INDEX = (() => {
  const idx = new Map();
  for (const c of CUENTAS) for (const t of c.tarjetas) idx.set(t, c);
  return idx;
})();

/** Resuelve una cuenta a partir de los últimos 4 dígitos de la tarjeta. */
export function cuentaPorTarjeta(ultimos4) {
  if (!ultimos4) return null;
  return TARJETA_INDEX.get(String(ultimos4).trim()) || null;
}

/** Resuelve una cuenta por su nombre canónico (case-insensitive). */
export function cuentaPorNombre(nombre) {
  if (!nombre) return null;
  const n = String(nombre).toLowerCase().trim();
  return CUENTAS.find((c) => c.nombre.toLowerCase() === n) || null;
}

/** Lista de nombres de cuentas activas (para selects y prompts). */
export const NOMBRES_CUENTAS = CUENTAS.map((c) => c.nombre);

/** Personas que pueden figurar como "quién pagó". */
export const PERSONAS = ['Luis', 'Carolina'];
