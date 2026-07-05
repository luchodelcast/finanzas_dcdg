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

/** Cuentas/números Delca2 (Mercury) — la empresa de Luis y Carolina. */
export const DELCA2_CUENTAS = ['3851', '9164'];
/**
 * Tarjetas y cuentas Delca2 con las que se pueden PAGAR gastos familiares.
 * Incluye la tarjeta Mercury 7730 (checking …9164). Pagar un gasto personal
 * desde aquí = sacar plata de la empresa → se registra el gasto Y un retiro de
 * socios en EMPRESAS (análogo a la tarjeta Jeeves/iWin).
 */
export const DELCA2_TARJETAS = ['7730', ...DELCA2_CUENTAS];

const IWIN_SET = new Set(IWIN_CUENTAS);
const DELCA2_SET = new Set(DELCA2_CUENTAS);
const DELCA2_TARJETAS_SET = new Set(DELCA2_TARJETAS);

/** ¿Es una cuenta iWin a filtrar del registro de gastos? */
export function esCuentaIwin(ultimos4) {
  return IWIN_SET.has(String(ultimos4 || '').trim());
}

/** ¿Es una cuenta Delca2 (número de cuenta)? */
export function esCuentaDelca2(ultimos4) {
  return DELCA2_SET.has(String(ultimos4 || '').trim());
}

/**
 * ¿El movimiento se pagó con una cuenta/tarjeta Delca2? Detecta por los últimos 4
 * (tarjeta 7730 o cuentas 3851/9164) o por el nombre del método ("Delca2").
 */
export function esPagoDelca2(mov = {}) {
  const t = String(mov.tarjeta_ultimos4 || '').trim();
  const metodo = String(mov.metodo_pago || '');
  return DELCA2_TARJETAS_SET.has(t) || /delca\s*2/i.test(metodo);
}

/**
 * Decide si una transacción debe registrarse como gasto familiar.
 * @param {{ tarjeta_ultimos4?: string, metodo_pago?: string, iwin_prestamo?: boolean }} mov
 * @returns {{ registrar: boolean, motivo: string, adelanto_empresas: boolean, retiro_delca2: boolean }}
 */
export function evaluarMovimiento(mov = {}) {
  const t = String(mov.tarjeta_ultimos4 || '').trim();
  const esJeeves =
    mov.iwin_prestamo === true ||
    /jeeves|tc iwin|superlikers/i.test(mov.metodo_pago || '');

  // Gasto personal pagado con Jeeves → registrar gasto + adelanto en EMPRESAS.
  if (esJeeves) {
    return { registrar: true, motivo: 'Gasto personal con TC iWin (adelanto honorarios)', adelanto_empresas: true, retiro_delca2: false };
  }
  // Gasto pagado con tarjeta/cuenta Delca2 → registrar gasto + retiro de socios
  // en EMPRESAS (es plata de la empresa de Luis y Carolina usada para un gasto).
  if (esPagoDelca2(mov)) {
    return { registrar: true, motivo: 'Gasto pagado con cuenta Delca2 (retiro de socios)', adelanto_empresas: false, retiro_delca2: true };
  }
  if (esCuentaIwin(t)) {
    return { registrar: false, motivo: 'Cuenta iWin empresarial: fuera del registro familiar', adelanto_empresas: false, retiro_delca2: false };
  }
  return { registrar: true, motivo: 'Gasto familiar DCDG', adelanto_empresas: false, retiro_delca2: false };
}
