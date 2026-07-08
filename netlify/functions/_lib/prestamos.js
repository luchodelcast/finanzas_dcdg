/**
 * _lib/prestamos.js — Préstamos entre Luis y Carolina (issue #77, Nocturno 6/7).
 *
 * Un préstamo {de:'Luis', para:'Carolina', monto} significa que Carolina le
 * debe ese monto a Luis. Un abono/pago es sencillamente un registro en el
 * sentido inverso (o marcar el original como `saldado`, que lo saca del neto).
 */

/**
 * Calcula el saldo neto por moneda a partir de los préstamos NO saldados.
 * @returns {Array<{moneda, neto, deudor}>} deudor: 'Carolina' | 'Luis' | null (null si neto = 0)
 */
export function calcularSaldoPrestamos(prestamos) {
  const porMoneda = new Map();
  for (const p of prestamos || []) {
    if (p.saldado) continue;
    const moneda = p.moneda || 'COP';
    const monto = Number(p.monto) || 0;
    const signo = p.de === 'Luis' ? 1 : -1; // Luis→Carolina suma, Carolina→Luis resta
    porMoneda.set(moneda, (porMoneda.get(moneda) || 0) + signo * monto);
  }
  return Array.from(porMoneda.entries()).map(([moneda, neto]) => ({
    moneda,
    neto: Math.abs(neto),
    deudor: neto > 0 ? 'Carolina' : neto < 0 ? 'Luis' : null,
  }));
}
