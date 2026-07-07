import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangoDashboard, topComercios } from '../app/src/utils/dashboard.js';

const HOY = new Date(2026, 6, 7); // 7 jul 2026

test('rangoDashboard: mes actual', () => {
  const r = rangoDashboard('mes', HOY);
  assert.equal(r.desde, '2026-07-01');
  assert.equal(r.hasta, '2026-07-07');
});

test('rangoDashboard: mes anterior', () => {
  const r = rangoDashboard('mes-anterior', HOY);
  assert.equal(r.desde, '2026-06-01');
  assert.equal(r.hasta, '2026-06-30');
});

test('rangoDashboard: últimos 3 meses', () => {
  const r = rangoDashboard('3-meses', HOY);
  assert.equal(r.desde, '2026-05-01');
  assert.equal(r.hasta, '2026-07-07');
});

const ROWS = [
  ['2026-07-01', 7, 'Alimentación', 'Mercado', 'Éxito', 45000],
  ['2026-07-02', 7, 'Alimentación', 'Mercado', 'Éxito', 30000],
  ['2026-07-03', 7, 'Transporte', 'Uber', 'Uber', 18500],
  ['2026-06-15', 6, 'Alimentación', 'Mercado', 'D1', 20000], // fuera de rango
  ['2026-07-04', 7, 'Ocio', 'Restaurante', 'Cucinare', 85000],
];

test('topComercios: agrupa por descripción y ordena de mayor a menor', () => {
  const top = topComercios(ROWS, { desde: '2026-07-01', hasta: '2026-07-07' });
  assert.deepEqual(top, [
    { descripcion: 'Cucinare', monto: 85000 },
    { descripcion: 'Éxito', monto: 75000 },
    { descripcion: 'Uber', monto: 18500 },
  ]);
});

test('topComercios: respeta el límite', () => {
  const top = topComercios(ROWS, { desde: '2026-07-01', hasta: '2026-07-07', limite: 2 });
  assert.equal(top.length, 2);
});

test('topComercios: sin filas en rango → []', () => {
  assert.deepEqual(topComercios(ROWS, { desde: '2026-08-01', hasta: '2026-08-31' }), []);
});
