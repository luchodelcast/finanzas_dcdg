import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexarReglas, buildLineasMovimiento, buildLineasIngreso } from '../netlify/functions/_lib/contabilizar.js';
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
