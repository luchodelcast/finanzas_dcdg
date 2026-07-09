import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monedaDeCuenta, tasaTransferencia } from '../app/src/utils/transferencia-monedas.js';

const cuentas = [
  { name: 'Bcol 0965', moneda: 'COP', tipoEspecial: 'Normal' },
  { name: 'DollarApp', moneda: 'USD', tipoEspecial: 'USD-Internacional' },
  { name: 'Sin moneda explícita', tipoEspecial: 'USD-Internacional' },
  { name: 'Normal sin moneda', tipoEspecial: 'Normal' },
];

test('monedaDeCuenta: usa el campo moneda cuando está presente', () => {
  assert.equal(monedaDeCuenta('Bcol 0965', cuentas), 'COP');
  assert.equal(monedaDeCuenta('DollarApp', cuentas), 'USD');
});

test('monedaDeCuenta: infiere de tipoEspecial cuando falta moneda', () => {
  assert.equal(monedaDeCuenta('Sin moneda explícita', cuentas), 'USD');
  assert.equal(monedaDeCuenta('Normal sin moneda', cuentas), 'COP');
});

test('monedaDeCuenta: cuenta no encontrada o lista vacía → COP por defecto', () => {
  assert.equal(monedaDeCuenta('No existe', cuentas), 'COP');
  assert.equal(monedaDeCuenta('Bcol 0965', []), 'COP');
  assert.equal(monedaDeCuenta('Bcol 0965', undefined), 'COP');
});

test('tasaTransferencia: USD→COP calcula COP por USD', () => {
  const r = tasaTransferencia({ monto: 3899, moneda: 'USD', montoDestino: 12919288, monedaDestino: 'COP' });
  assert.ok(r);
  assert.equal(r.monedaExtranjera, 'USD');
  assert.ok(Math.abs(r.tasa - 3313.49) < 0.01);
});

test('tasaTransferencia: COP→USD también expresa la tasa como COP por USD', () => {
  const r = tasaTransferencia({ monto: 12919288, moneda: 'COP', montoDestino: 3899, monedaDestino: 'USD' });
  assert.ok(r);
  assert.equal(r.monedaExtranjera, 'USD');
  assert.ok(Math.abs(r.tasa - 3313.49) < 0.01);
});

test('tasaTransferencia: misma moneda → null (no es transferencia entre monedas)', () => {
  assert.equal(tasaTransferencia({ monto: 100, moneda: 'COP', montoDestino: 100, monedaDestino: 'COP' }), null);
});

test('tasaTransferencia: faltan datos → null', () => {
  assert.equal(tasaTransferencia({ monto: 100, moneda: 'COP', montoDestino: 0, monedaDestino: 'USD' }), null);
  assert.equal(tasaTransferencia({ monto: 0, moneda: 'COP', montoDestino: 100, monedaDestino: 'USD' }), null);
  assert.equal(tasaTransferencia({ monto: 100, moneda: 'COP', montoDestino: null, monedaDestino: '' }), null);
});

test('tasaTransferencia: ninguna pata en COP → null (fuera de alcance del modelo pragmático)', () => {
  assert.equal(tasaTransferencia({ monto: 100, moneda: 'USD', montoDestino: 90, monedaDestino: 'EUR' }), null);
});
