import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferirTipoGasto } from '../netlify/functions/_lib/tipo-gasto.js';
import { indexarCuentasMeta } from '../netlify/functions/_lib/contabilizar.js';

const CUENTAS_META = indexarCuentasMeta([
  { nombre: 'Bcol 0965', dueno: 'comun', bolsillo: 'comun', cuenta_puc: null },
  { nombre: 'Serfinanza', dueno: 'carolina', bolsillo: 'gasto_individual', cuenta_puc: '2105' },
  { nombre: 'Cuenta retiro Carolina', dueno: 'carolina', bolsillo: 'patrimonio_individual', cuenta_puc: null },
  { nombre: 'Efectivo Luis', dueno: 'luis', bolsillo: 'gasto_individual', cuenta_puc: null },
]);

test('sin cuentas_meta ni override → hogar (auto)', () => {
  const r = inferirTipoGasto({ metodoPago: 'Cuenta desconocida', quienPago: 'Luis' });
  assert.deepEqual(r, { tipo_gasto: 'hogar', tipo_gasto_persona: null, tipo_gasto_auto: true });
});

test('bolsillo "comun" → hogar (auto)', () => {
  const r = inferirTipoGasto({ metodoPago: 'Bcol 0965', quienPago: 'Luis', cuentasMeta: CUENTAS_META });
  assert.deepEqual(r, { tipo_gasto: 'hogar', tipo_gasto_persona: null, tipo_gasto_auto: true });
});

test('bolsillo "gasto_individual" → personal del dueño de la cuenta (auto)', () => {
  const r = inferirTipoGasto({ metodoPago: 'Serfinanza', quienPago: 'Luis', cuentasMeta: CUENTAS_META });
  assert.deepEqual(r, { tipo_gasto: 'personal', tipo_gasto_persona: 'Carolina', tipo_gasto_auto: true });
});

test('bolsillo "patrimonio_individual" → personal del dueño de la cuenta (auto)', () => {
  const r = inferirTipoGasto({ metodoPago: 'Cuenta retiro Carolina', quienPago: 'Luis', cuentasMeta: CUENTAS_META });
  assert.deepEqual(r, { tipo_gasto: 'personal', tipo_gasto_persona: 'Carolina', tipo_gasto_auto: true });
});

test('cuenta individual sin dueño luis/carolina reconocible → cae a quien_pago', () => {
  const meta = indexarCuentasMeta([{ nombre: 'Cta rara', dueno: 'comun', bolsillo: 'gasto_individual' }]);
  const r = inferirTipoGasto({ metodoPago: 'Cta rara', quienPago: 'Carolina', cuentasMeta: meta });
  assert.equal(r.tipo_gasto, 'personal');
  assert.equal(r.tipo_gasto_persona, 'Carolina');
});

test('override "hogar" manda aunque la cuenta sea individual', () => {
  const r = inferirTipoGasto({
    metodoPago: 'Efectivo Luis', quienPago: 'Luis', cuentasMeta: CUENTAS_META, tipoGastoOverride: 'hogar',
  });
  assert.deepEqual(r, { tipo_gasto: 'hogar', tipo_gasto_persona: null, tipo_gasto_auto: false });
});

test('override "personal" con persona explícita manda sobre la inferencia', () => {
  const r = inferirTipoGasto({
    metodoPago: 'Bcol 0965', quienPago: 'Luis', cuentasMeta: CUENTAS_META,
    tipoGastoOverride: 'personal', personaOverride: 'Carolina',
  });
  assert.deepEqual(r, { tipo_gasto: 'personal', tipo_gasto_persona: 'Carolina', tipo_gasto_auto: false });
});

test('override "personal" sin persona explícita cae a quien_pago', () => {
  const r = inferirTipoGasto({ metodoPago: 'Bcol 0965', quienPago: 'Carolina', tipoGastoOverride: 'personal' });
  assert.deepEqual(r, { tipo_gasto: 'personal', tipo_gasto_persona: 'Carolina', tipo_gasto_auto: false });
});
