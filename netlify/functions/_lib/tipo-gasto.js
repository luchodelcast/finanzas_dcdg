/**
 * _lib/tipo-gasto.js — Clasificar un egreso como "hogar" (compartido) o
 * "personal de <persona>" (issue #114, Contab. familiar B).
 *
 * Por defecto se infiere del `bolsillo` de la cuenta usada como medio de pago
 * (`cuentas_meta`, #112): bolsillo `comun` (o sin fila en `cuentas_meta`) →
 * hogar; `gasto_individual` / `patrimonio_individual` → personal del dueño de
 * esa cuenta. Un override explícito (captura manual) siempre manda sobre la
 * inferencia.
 */

const normalizarNombreCuenta = (nombre) => String(nombre || '').trim().toLowerCase();

const DUENO_A_PERSONA = { luis: 'Luis', carolina: 'Carolina' };

/**
 * @param {{ metodoPago?: string, quienPago?: string, cuentasMeta?: Map,
 *   tipoGastoOverride?: string, personaOverride?: string }} q
 * @returns {{ tipo_gasto: 'hogar'|'personal', tipo_gasto_persona: string|null, tipo_gasto_auto: boolean }}
 */
export function inferirTipoGasto({ metodoPago, quienPago, cuentasMeta, tipoGastoOverride, personaOverride } = {}) {
  const override = String(tipoGastoOverride || '').trim().toLowerCase();

  if (override === 'hogar') {
    return { tipo_gasto: 'hogar', tipo_gasto_persona: null, tipo_gasto_auto: false };
  }
  if (override === 'personal') {
    const persona = String(personaOverride || quienPago || '').trim() || null;
    return { tipo_gasto: 'personal', tipo_gasto_persona: persona, tipo_gasto_auto: false };
  }

  const meta = cuentasMeta && cuentasMeta.get(normalizarNombreCuenta(metodoPago));
  const bolsillo = meta && meta.bolsillo;
  if (bolsillo === 'gasto_individual' || bolsillo === 'patrimonio_individual') {
    const persona = DUENO_A_PERSONA[meta.dueno] || String(quienPago || '').trim() || null;
    return { tipo_gasto: 'personal', tipo_gasto_persona: persona, tipo_gasto_auto: true };
  }
  return { tipo_gasto: 'hogar', tipo_gasto_persona: null, tipo_gasto_auto: true };
}
