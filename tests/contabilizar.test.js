import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  indexarReglas, indexarCuentasMeta, buildLineasMovimiento, buildLineasIngreso,
} from '../netlify/functions/_lib/contabilizar.js';
import { validarAsiento } from '../netlify/functions/_lib/asientos.js';

const REGLAS = indexarReglas([
  { ambito: 'categoria', clave: 'alimentación', cuenta: '5105' },
  { ambito: 'categoria', clave: 'default', cuenta: '5195' },
  { ambito: 'cedula', clave: 'honorarios', cuenta: '4155' },
  { ambito: 'cedula', clave: 'default', cuenta: '4155' },
  { ambito: 'medio', clave: 'efectivo', cuenta: '1105' },
  { ambito: 'medio', clave: 'tarjeta credito', cuenta: '2105' },
  { ambito: 'medio', clave: 'default', cuenta: '1110' },
]);
const CUENTAS = new Set(['5105', '5195', '4155', '1105', '2105', '1110']);

test('gasto → débito cuenta de gasto (categoría) / crédito medio de pago, y cuadra', () => {
  const l = buildLineasMovimiento({ id: 1, tipo: 'gasto', categoria: 'Alimentación', metodo_pago: 'Bcol 0965', monto: 45000 }, REGLAS);
  assert.deepEqual(l[0], { cuenta: '5105', debito: 45000, credito: 0, movimiento_id: 1 });
  assert.deepEqual(l[1], { cuenta: '1110', debito: 0, credito: 45000, movimiento_id: 1 });
  assert.equal(validarAsiento(l, CUENTAS).ok, true);
});

test('gasto en efectivo → crédito a caja (1105)', () => {
  const l = buildLineasMovimiento({ id: 2, tipo: 'gasto', categoria: 'Alimentación', metodo_pago: 'Efectivo', monto: 10000 }, REGLAS);
  assert.equal(l[1].cuenta, '1105');
});

test('categoría desconocida → cuenta de gasto por defecto (5195)', () => {
  const l = buildLineasMovimiento({ id: 3, tipo: 'gasto', categoria: 'Cripto', metodo_pago: 'Nequi', monto: 5000 }, REGLAS);
  assert.equal(l[0].cuenta, '5195');
});

test('transferencia → débito destino / crédito origen', () => {
  const l = buildLineasMovimiento({ id: 4, tipo: 'transferencia', metodo_pago: 'Nequi', cuenta_destino: 'Efectivo', monto: 100000 }, REGLAS);
  assert.equal(l[0].cuenta, '1105'); // destino (efectivo) al débito
  assert.equal(l[1].cuenta, '1110'); // origen (Nequi → default banco) al crédito
  assert.equal(validarAsiento(l, CUENTAS).ok, true);
});

test('ingreso → débito banco / crédito cuenta de ingreso (cédula)', () => {
  const l = buildLineasIngreso({ id: 5, cedula: 'honorarios', monto: 2000000 }, REGLAS);
  assert.equal(l[0].cuenta, '1110');
  assert.equal(l[1].cuenta, '4155');
  assert.equal(l[1].ingreso_id, 5);
  assert.equal(validarAsiento(l, CUENTAS).ok, true);
});

test('falta regla (sin default) → lanza', () => {
  const parcial = indexarReglas([{ ambito: 'medio', clave: 'default', cuenta: '1110' }]); // sin reglas de categoria
  assert.throws(() => buildLineasMovimiento({ id: 6, tipo: 'gasto', categoria: 'X', metodo_pago: 'Y', monto: 1 }, parcial), /faltan reglas/);
});

// ---------------------------------------------------------------------------
// cuentas_meta (issue #112): cuenta_puc explícito tiene prioridad sobre la
// heurística por palabra clave; sin fila en meta, el comportamiento es idéntico.
// ---------------------------------------------------------------------------
test('cuentas_meta: cuenta_puc explícito manda, aunque el nombre no tenga la palabra clave', () => {
  const meta = indexarCuentasMeta([
    { nombre: 'Serfinanza', dueno: 'carolina', bolsillo: 'gasto_individual', cuenta_puc: '2105' },
  ]);
  // "Serfinanza" no matchea /crédito|tc/, así que sin cuentas_meta caería a 1110 (default banco).
  const l = buildLineasMovimiento({ id: 7, tipo: 'gasto', categoria: 'Alimentación', metodo_pago: 'Serfinanza', monto: 20000 }, REGLAS, meta);
  assert.equal(l[1].cuenta, '2105');
  assert.equal(validarAsiento(l, new Set([...CUENTAS, '2105'])).ok, true);
});

test('cuentas_meta: sin fila para la cuenta usada, cae a la heurística de siempre (comportamiento preservado)', () => {
  const meta = indexarCuentasMeta([
    { nombre: 'Otra cuenta', dueno: 'luis', bolsillo: 'comun', cuenta_puc: '9999' },
  ]);
  const l = buildLineasMovimiento({ id: 8, tipo: 'gasto', categoria: 'Alimentación', metodo_pago: 'Bcol 0965', monto: 45000 }, REGLAS, meta);
  assert.equal(l[1].cuenta, '1110'); // sin fila propia → heurística/default, igual que sin cuentas_meta
});

test('cuentas_meta: sin tercer argumento, el comportamiento es idéntico al actual', () => {
  const l = buildLineasMovimiento({ id: 9, tipo: 'gasto', categoria: 'Alimentación', metodo_pago: 'Efectivo', monto: 10000 }, REGLAS);
  assert.equal(l[1].cuenta, '1105');
});

test('cuentas_meta: transferencia usa cuenta_puc en cualquiera de las dos patas', () => {
  const meta = indexarCuentasMeta([
    { nombre: 'Serfinanza', dueno: 'carolina', bolsillo: 'gasto_individual', cuenta_puc: '2105' },
  ]);
  const l = buildLineasMovimiento({ id: 10, tipo: 'transferencia', metodo_pago: 'Nequi', cuenta_destino: 'Serfinanza', monto: 30000 }, REGLAS, meta);
  assert.equal(l[0].cuenta, '2105'); // destino con meta explícita
  assert.equal(l[1].cuenta, '1110'); // origen sin meta → default banco
});
