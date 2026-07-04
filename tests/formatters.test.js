import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCOP,
  parseMonto,
  normalizarFecha,
  mesDeISO,
  ultimos4,
} from '../app/src/utils/formatters.js';

test('formatCOP formatea pesos', () => {
  assert.equal(formatCOP(45000), '$45.000');
  assert.equal(formatCOP(1200000), '$1.200.000');
});

test('parseMonto: formato CO con puntos de miles', () => {
  assert.equal(parseMonto('45.000'), 45000);
  assert.equal(parseMonto('1.234.567'), 1234567);
});

test('parseMonto: sufijos mil/k/M', () => {
  assert.equal(parseMonto('120mil'), 120000);
  assert.equal(parseMonto('45k'), 45000);
  assert.equal(parseMonto('1.2M'), 1200000);
});

test('parseMonto: con símbolo $ y espacios', () => {
  assert.equal(parseMonto('$ 45.000'), 45000);
});

test('parseMonto: número simple', () => {
  assert.equal(parseMonto('45000'), 45000);
  assert.equal(parseMonto(45000), 45000);
});

test('parseMonto: inválido → null', () => {
  assert.equal(parseMonto(''), null);
  assert.equal(parseMonto('abc'), null);
});

test('normalizarFecha acepta ISO y DD/MM', () => {
  assert.equal(normalizarFecha('2026-07-04'), '2026-07-04');
  assert.equal(normalizarFecha('4/7', 2026), '2026-07-04');
  assert.equal(normalizarFecha('04/07/2026'), '2026-07-04');
});

test('mesDeISO extrae el mes', () => {
  assert.equal(mesDeISO('2026-07-04'), 7);
});

test('ultimos4 extrae 4 dígitos finales', () => {
  assert.equal(ultimos4('Bcol 0965 tarjeta 2331'), '2331');
  assert.equal(ultimos4('sin numero'), '');
});
