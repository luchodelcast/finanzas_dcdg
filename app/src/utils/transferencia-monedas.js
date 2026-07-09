/**
 * utils/transferencia-monedas.js — Helpers puros para la sección dedicada
 * "Transferencia entre monedas" (#132). No tocan el DOM ni la red.
 */

/**
 * Moneda de una cuenta por nombre, buscando en la lista de cuentas cargada
 * (dinámica desde `⚙️ CUENTAS` o `CUENTAS_FALLBACK`). Si la cuenta trae
 * `.moneda` se usa tal cual; si no, se infiere de `tipoEspecial` (mismo
 * heurístico que ya usa `buildAccountsDropdown` para el emoji 💵); por
 * defecto COP.
 */
export function monedaDeCuenta(nombre, cuentas) {
  const c = (cuentas || []).find((a) => a.name === nombre);
  if (!c) return 'COP';
  if (c.moneda === 'USD' || c.moneda === 'COP') return c.moneda;
  return c.tipoEspecial === 'USD-Internacional' ? 'USD' : 'COP';
}

/**
 * Tasa aplicada de una transferencia entre monedas, expresada siempre como
 * "COP por unidad de moneda extranjera" (igual convención que
 * `cuadreTransferencia` en `_lib/contabilizar.js`). Devuelve `null` si no
 * hay datos suficientes o si ninguna de las dos patas está en COP (fuera de
 * alcance del modelo pragmático).
 */
export function tasaTransferencia({ monto, moneda, montoDestino, monedaDestino }) {
  const m = Number(monto) || 0;
  const mDestino = Number(montoDestino) || 0;
  if (!monedaDestino || monedaDestino === moneda || !(m > 0) || !(mDestino > 0)) return null;
  if (moneda !== 'COP' && monedaDestino !== 'COP') return null;
  const tasa = monedaDestino === 'COP' ? mDestino / m : m / mDestino;
  const monedaExtranjera = moneda === 'COP' ? monedaDestino : moneda;
  return { tasa, monedaExtranjera };
}
