/**
 * _lib/apertura.js — Asiento de apertura: convierte los saldos iniciales al
 * 1-jul en un asiento de partida doble cuadrado (T3).
 *
 * Activos (clase 1) → DÉBITO por su saldo. Pasivos (clase 2) → CRÉDITO. El
 * cuadre lo absorbe la cuenta de PATRIMONIO (capital inicial): capital =
 * Σ activos − Σ pasivos. Así Σ débito = Σ crédito por construcción.
 */

const cents = (n) => Math.round((Number(n) || 0) * 100);

/**
 * Arma los renglones del asiento de apertura (puro y testeable).
 * @param {Array<{cuenta, monto}>} saldos  saldo por cuenta del PUC (monto = valor absoluto)
 * @param {Map<string, {codigo, clase}>} planPorCodigo  plan de cuentas indexado por código
 * @param {string} [capitalCuenta] cuenta de patrimonio para el cuadre (default 3105)
 * @returns {Array<{cuenta, debito, credito}>}
 */
export function construirApertura(saldos, planPorCodigo, capitalCuenta = '3105') {
  const lineas = [];
  let capitalC = 0; // en centavos: Σ activos − Σ pasivos
  for (const s of saldos || []) {
    const cuenta = String(s && s.cuenta || '').trim();
    const monto = Math.abs(cents(s && s.monto));
    if (!cuenta || monto === 0) continue;
    const info = planPorCodigo.get(cuenta);
    if (!info) throw new Error(`La cuenta "${cuenta}" no existe en el plan de cuentas.`);
    if (info.clase === 1) { lineas.push({ cuenta, debito: monto / 100, credito: 0 }); capitalC += monto; }
    else if (info.clase === 2 || info.clase === 3) { lineas.push({ cuenta, debito: 0, credito: monto / 100 }); capitalC -= monto; }
    else throw new Error(`La cuenta "${cuenta}" (clase ${info.clase}) no es de saldo inicial: usa activos (1) o pasivos (2).`);
  }
  if (!lineas.length) throw new Error('Ingresa al menos un saldo inicial.');
  if (!planPorCodigo.has(capitalCuenta)) throw new Error(`Falta la cuenta de patrimonio ${capitalCuenta} en el plan de cuentas.`);
  if (capitalC > 0) lineas.push({ cuenta: capitalCuenta, debito: 0, credito: capitalC / 100 });
  else if (capitalC < 0) lineas.push({ cuenta: capitalCuenta, debito: -capitalC / 100, credito: 0 });
  // Si capitalC === 0 el asiento ya cuadra (activos = pasivos), sin renglón de capital.
  return lineas;
}
