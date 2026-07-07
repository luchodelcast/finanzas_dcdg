import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirApertura } from '../netlify/functions/_lib/apertura.js';
import { validarAsiento } from '../netlify/functions/_lib/asientos.js';

// Plan mínimo: 1110 banco (activo), 1105 caja (activo), 2105 tarjeta (pasivo), 3105 capital.
const PLAN = new Map([
  ['1110', { codigo: '1110', clase: 1 }],
  ['1105', { codigo: '1105', clase: 1 }],
  ['2105', { codigo: '2105', clase: 2 }],
  ['3105', { codigo: '3105', clase: 3 }],
  ['5105', { codigo: '5105', clase: 5 }],
]);
const setCuentas = new Set(PLAN.keys());

test('construirApertura: activos débito, pasivos crédito, capital cuadra (A>P)', () => {
  const lineas = construirApertura([
    { cuenta: '1110', monto: 1000000 },
    { cuenta: '1105', monto: 50000 },
    { cuenta: '2105', monto: 200000 }, // deuda tarjeta
  ], PLAN);
  // capital = 1.050.000 − 200.000 = 850.000 (crédito)
  const capital = lineas.find((l) => l.cuenta === '3105');
  assert.equal(capital.credito, 850000);
  assert.equal(capital.debito, 0);
  // Y el asiento completo CUADRA.
  const v = validarAsiento(lineas, setCuentas);
  assert.equal(v.ok, true);
  assert.equal(v.totalDebito, 1050000);
});

test('construirApertura: pasivos > activos → capital al débito', () => {
  const lineas = construirApertura([
    { cuenta: '1110', monto: 100000 },
    { cuenta: '2105', monto: 300000 },
  ], PLAN);
  const capital = lineas.find((l) => l.cuenta === '3105');
  assert.equal(capital.debito, 200000); // 300.000 − 100.000
  assert.equal(validarAsiento(lineas, setCuentas).ok, true);
});

test('construirApertura: ignora montos 0 y exige al menos un saldo', () => {
  assert.throws(() => construirApertura([{ cuenta: '1110', monto: 0 }], PLAN), /al menos un saldo/);
});

test('construirApertura: cuenta inexistente → error', () => {
  assert.throws(() => construirApertura([{ cuenta: '9999', monto: 10 }], PLAN), /no existe/);
});

test('construirApertura: cuenta de gasto (clase 5) no es saldo inicial → error', () => {
  assert.throws(() => construirApertura([{ cuenta: '5105', monto: 10 }], PLAN), /no es de saldo inicial/);
});

test('construirApertura: activos = pasivos → cuadra sin renglón de capital', () => {
  const lineas = construirApertura([
    { cuenta: '1110', monto: 200000 },
    { cuenta: '2105', monto: 200000 },
  ], PLAN);
  assert.equal(lineas.find((l) => l.cuenta === '3105'), undefined);
  assert.equal(validarAsiento(lineas, setCuentas).ok, true);
});
