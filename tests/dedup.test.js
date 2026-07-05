import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchDuplicate } from '../netlify/functions/_lib/dedup.js';

// Filas simuladas de Registro Gastos (A..L). Índices: 0=fecha,4=desc,5=monto,6=metodo,9=tarjeta
const rows = [
  ['2026-07-01', 7, 'Alimentación', 'Mercado', 'Tienda D1', 45000, 'Nequi Luis', 'Luis', '', '', '', ''],
  ['2026-07-04', 7, 'Alimentación', 'Restaurante', 'BOLD*Restaurante gre', 117781, '', 'Luis', 'Cena', '', '', ''],
  ['2026-07-04', 7, 'Transporte', 'Uber-Taxi', 'Uber', 18500, 'Bcol 0965', 'Luis', '', '2331', '', ''],
];

test('detecta duplicado por fecha+monto+comercio (fila 3 del Sheet)', () => {
  const d = matchDuplicate(rows, { fecha: '2026-07-04', monto: 117781, descripcion: 'BOLD*Restaurante gre' });
  assert.ok(d);
  assert.equal(d.rowNumber, 3); // índice 1 → fila 3 (datos desde la fila 2)
  assert.equal(d.metodoActual, ''); // esa fila no tenía cuenta
});

test('tolera ±1 COP y compara solo los primeros 6 chars del comercio', () => {
  const d = matchDuplicate(rows, { fecha: '2026-07-04', monto: 117780, descripcion: 'BOLD*Rest otra cosa' });
  assert.ok(d);
  assert.equal(d.rowNumber, 3);
});

test('no marca duplicado si el monto difiere', () => {
  assert.equal(matchDuplicate(rows, { fecha: '2026-07-04', monto: 50000, descripcion: 'BOLD*Restaurante gre' }), null);
});

test('marca duplicado si la fecha difiere pocos días (re-registro sin fecha del recibo)', () => {
  // Fila del recibo es 07-04; el re-registro queda con la fecha de hoy (07-06).
  const d = matchDuplicate(rows, { fecha: '2026-07-06', monto: 117781, descripcion: 'BOLD*Restaurante gre' });
  assert.ok(d, 'debería atrapar el duplicado dentro de la ventana de ±3 días');
  assert.equal(d.rowNumber, 3);
});

test('no marca duplicado si la fecha difiere más que la ventana (±3 días)', () => {
  assert.equal(matchDuplicate(rows, { fecha: '2026-08-01', monto: 117781, descripcion: 'BOLD*Restaurante gre' }), null);
});

test('lee el método existente (col G) cuando la fila ya tiene cuenta', () => {
  const d = matchDuplicate(rows, { fecha: '2026-07-04', monto: 18500, descripcion: 'Uber' });
  assert.ok(d);
  assert.equal(d.metodoActual, 'Bcol 0965');
  assert.equal(d.tarjetaActual, '2331');
});

test('sin filas → null', () => {
  assert.equal(matchDuplicate([], { fecha: '2026-07-04', monto: 100, descripcion: 'algo' }), null);
});
