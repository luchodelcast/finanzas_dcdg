/**
 * config/iwin.js — Filtros de cuentas empresariales iWin/Delca2 (sección 10 del doc).
 *
 * Las transacciones desde/hacia cuentas iWin no son gastos familiares:
 *  - Cuentas iWin (18) → IGNORAR en el registro de gastos.
 *  - Cuentas Delca2 (Mercury) → ingresos válidos (honorarios), NO gastos.
 *  - Cuentas DCDG → sí registrar.
 *
 * Excepción: si el pago se hizo con la tarjeta corporativa Jeeves (TC iWin) por
 * un gasto personal de Luis, se registra el gasto Y un adelanto en `EMPRESAS`.
 */

/** 18 cuentas iWin a ignorar (últimos 4 dígitos). */
export const IWIN_CUENTAS = [
  '5401', '1039', '9530', '2275', '0322', '4543', '0530', '1491', '2721',
  '3811', '3329', '2735', '8632', '5945', '7064', '0490', '9928', '2997',
];

/** Cuentas bancarias DCDG (Luis y Carolina) — NUNCA ignorar. */
export const DCDG_CUENTAS = ['0965', '3355', '4549', '3164', '5688'];

/** Cuentas Delca2 (Mercury) — ingresos válidos, no gastos. */
export const DELCA2_CUENTAS = ['3851', '9164'];

const IWIN_SET = new Set(IWIN_CUENTAS);
const DELCA2_SET = new Set(DELCA2_CUENTAS);

/** ¿Es una cuenta iWin a filtrar del registro de gastos? */
export function esCuentaIwin(ultimos4) {
  return IWIN_SET.has(String(ultimos4 || '').trim());
}

/** ¿Es una cuenta Delca2 (ingreso, no gasto)? */
export function esCuentaDelca2(ultimos4) {
  return DELCA2_SET.has(String(ultimos4 || '').trim());
}

/**
 * Decide si una transacción debe registrarse como gasto familiar.
 * @param {{ tarjeta_ultimos4?: string, metodo_pago?: string, iwin_prestamo?: boolean }} mov
 * @returns {{ registrar: boolean, motivo: string, adelanto_empresas: boolean }}
 */
export function evaluarMovimiento(mov = {}) {
  const t = String(mov.tarjeta_ultimos4 || '').trim();
  const esJeeves =
    mov.iwin_prestamo === true ||
    /jeeves|tc iwin|superlikers/i.test(mov.metodo_pago || '');

  // Gasto personal pagado con Jeeves → registrar gasto + adelanto en EMPRESAS.
  if (esJeeves) {
    return { registrar: true, motivo: 'Gasto personal con TC iWin (adelanto honorarios)', adelanto_empresas: true };
  }
  if (esCuentaDelca2(t)) {
    return { registrar: false, motivo: 'Cuenta Delca2: ingreso de honorarios, no gasto', adelanto_empresas: false };
  }
  if (esCuentaIwin(t)) {
    return { registrar: false, motivo: 'Cuenta iWin empresarial: fuera del registro familiar', adelanto_empresas: false };
  }
  return { registrar: true, motivo: 'Gasto familiar DCDG', adelanto_empresas: false };
}
