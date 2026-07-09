import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMonto, planMarcarSplit } from '../app/src/ui/pagos.js';

test('parseMonto: extrae solo dígitos; vacío → null', () => {
  assert.equal(parseMonto('1.459.896'), 1459896);
  assert.equal(parseMonto('$ 200.000'), 200000);
  assert.equal(parseMonto(''), null);
  assert.equal(parseMonto('  '), null);
  assert.equal(parseMonto(null), null);
});

test('planMarcarSplit: sin porción anterior → una sola marca en el mes actual', () => {
  const marcas = planMarcarSplit({ pago_fijo_id: 7, total: 679297, previo: 0, anio: 2026, mes: 7 });
  assert.deepEqual(marcas, [{ pago_fijo_id: 7, anio: 2026, mes: 7, monto_pagado: 679297 }]);
});

test('planMarcarSplit: con porción anterior → marca mes anterior + mes actual con el resto', () => {
  // Acueducto: pagó 1.459.896, de los cuales 638.566 eran de junio.
  const marcas = planMarcarSplit({ pago_fijo_id: 7, total: 1459896, previo: 638566, anio: 2026, mes: 7 });
  assert.deepEqual(marcas, [
    { pago_fijo_id: 7, anio: 2026, mes: 6, monto_pagado: 638566 },
    { pago_fijo_id: 7, anio: 2026, mes: 7, monto_pagado: 821330 },
  ]);
});

test('planMarcarSplit: enero → el mes anterior es diciembre del año previo', () => {
  const marcas = planMarcarSplit({ pago_fijo_id: 3, total: 100000, previo: 40000, anio: 2026, mes: 1 });
  assert.deepEqual(marcas[0], { pago_fijo_id: 3, anio: 2025, mes: 12, monto_pagado: 40000 });
  assert.deepEqual(marcas[1], { pago_fijo_id: 3, anio: 2026, mes: 1, monto_pagado: 60000 });
});

test('planMarcarSplit: la porción anterior no puede ser ≥ al total', () => {
  assert.throws(() => planMarcarSplit({ pago_fijo_id: 1, total: 100000, previo: 100000, anio: 2026, mes: 7 }));
  assert.throws(() => planMarcarSplit({ pago_fijo_id: 1, total: 100000, previo: 150000, anio: 2026, mes: 7 }));
});
