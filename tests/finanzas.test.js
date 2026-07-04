import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluarMovimiento, esCuentaIwin, esCuentaDelca2 } from '../app/src/config/iwin.js';
import { cuentaPorTarjeta } from '../app/src/config/accounts.js';
import { rangoPeriodo } from '../netlify/functions/_lib/finanzas.js';

test('cuenta iWin se ignora', () => {
  assert.equal(esCuentaIwin('5401'), true);
  const r = evaluarMovimiento({ tarjeta_ultimos4: '5401' });
  assert.equal(r.registrar, false);
});

test('cuenta Delca2 es ingreso, no gasto', () => {
  assert.equal(esCuentaDelca2('3851'), true);
  assert.equal(evaluarMovimiento({ tarjeta_ultimos4: '3851' }).registrar, false);
});

test('cuenta DCDG se registra', () => {
  const r = evaluarMovimiento({ tarjeta_ultimos4: '2331' });
  assert.equal(r.registrar, true);
  assert.equal(r.adelanto_empresas, false);
});

test('gasto con Jeeves → registra gasto + adelanto EMPRESAS', () => {
  const r = evaluarMovimiento({ metodo_pago: 'TC iWin (Superlikers)', iwin_prestamo: true });
  assert.equal(r.registrar, true);
  assert.equal(r.adelanto_empresas, true);
});

test('cuentaPorTarjeta resuelve nombre de cuenta', () => {
  assert.equal(cuentaPorTarjeta('2331').nombre, 'Bcol 0965');
  assert.equal(cuentaPorTarjeta('5773').nombre, 'Bcol 4549');
});

test('rangoPeriodo: mes específico YYYY-MM', () => {
  const r = rangoPeriodo('2026-07', new Date(2026, 6, 4));
  assert.equal(r.desde, '2026-07-01');
  assert.equal(r.hasta, '2026-07-31');
});

test('rangoPeriodo: rango explícito', () => {
  const r = rangoPeriodo('2026-07-01..2026-07-15');
  assert.equal(r.desde, '2026-07-01');
  assert.equal(r.hasta, '2026-07-15');
});

test('rangoPeriodo: mes en curso por defecto', () => {
  const r = rangoPeriodo(undefined, new Date(2026, 6, 4));
  assert.equal(r.desde, '2026-07-01');
  assert.equal(r.hasta, '2026-07-04');
});
