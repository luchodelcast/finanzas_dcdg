import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectarTipoLinea, proponerBackfillLinea, proponerBackfillExtracto, CONFIANZA_AUTO,
} from '../netlify/functions/_lib/backfill.js';

// ---------------------------------------------------------------------------
// detectarTipoLinea — signo + palabras clave de transferencia (issue #72).
// ---------------------------------------------------------------------------

test('detectarTipoLinea: débito (monto negativo) → gasto', () => {
  assert.equal(detectarTipoLinea('Pago Exito Envigado', -45000), 'gasto');
});

test('detectarTipoLinea: crédito (monto positivo) → ingreso', () => {
  assert.equal(detectarTipoLinea('Consignacion Nomina', 3200000), 'ingreso');
});

test('detectarTipoLinea: palabra clave de traslado → transferencia (aunque el monto sea negativo)', () => {
  assert.equal(detectarTipoLinea('Transferencia a cuenta propia', -100000), 'transferencia');
  assert.equal(detectarTipoLinea('TRASLADO ENTRE CUENTAS', 100000), 'transferencia');
});

// ---------------------------------------------------------------------------
// proponerBackfillLinea — clasificación pura (sin red, sin DB).
// ---------------------------------------------------------------------------

test('proponerBackfillLinea: gasto con regla conocida → auto=true, alta confianza', () => {
  const p = proponerBackfillLinea({ id: 1, fecha: '2026-07-05', descripcion: 'COMPRA TIENDA D1 BOGOTA', monto: -45000 }, { cuenta: 'Bcol 0965' });
  assert.equal(p.linea_id, 1);
  assert.equal(p.tipo, 'gasto');
  assert.equal(p.categoria, 'Alimentación');
  assert.equal(p.subcategoria, 'Mercado');
  assert.equal(p.monto, 45000);
  assert.ok(p.confianza >= CONFIANZA_AUTO);
  assert.equal(p.auto, true);
});

test('proponerBackfillLinea: gasto sin regla → dudosa (auto=false, confianza 0)', () => {
  const p = proponerBackfillLinea({ id: 2, fecha: '2026-07-05', descripcion: 'PAGO COMERCIO DESCONOCIDO XYZ', monto: -12000 }, { cuenta: 'Bcol 0965' });
  assert.equal(p.tipo, 'gasto');
  assert.equal(p.auto, false);
  assert.equal(p.confianza, 0);
  assert.equal(p.categoria, '');
  assert.ok(p.motivo.length > 0);
});

test('proponerBackfillLinea: crédito → ingreso, siempre dudosa (requiere entidad/cédula)', () => {
  const p = proponerBackfillLinea({ id: 3, fecha: '2026-07-10', descripcion: 'Consignacion Nomina', monto: 3200000 });
  assert.equal(p.tipo, 'ingreso');
  assert.equal(p.auto, false);
  assert.match(p.motivo, /entidad/i);
});

test('proponerBackfillLinea: transferencia → siempre dudosa (requiere cuenta destino)', () => {
  const p = proponerBackfillLinea({ id: 4, fecha: '2026-07-05', descripcion: 'Transferencia a otra cuenta', monto: -100000 });
  assert.equal(p.tipo, 'transferencia');
  assert.equal(p.auto, false);
  assert.match(p.motivo, /cuenta destino/i);
});

test('proponerBackfillLinea: usa la cuenta del extracto como metodo_pago del gasto', () => {
  const p = proponerBackfillLinea({ id: 5, fecha: '2026-07-05', descripcion: 'Uber viaje centro', monto: -18500 }, { cuenta: 'TC Colpatria' });
  assert.equal(p.metodo_pago, 'TC Colpatria');
});

test('proponerBackfillLinea: monto siempre positivo (valor absoluto) sin importar el signo del extracto', () => {
  const gasto = proponerBackfillLinea({ id: 6, fecha: '2026-07-05', descripcion: 'Compra', monto: -5000 });
  const ingreso = proponerBackfillLinea({ id: 7, fecha: '2026-07-05', descripcion: 'Abono', monto: 5000 });
  assert.equal(gasto.monto, 5000);
  assert.equal(ingreso.monto, 5000);
});

test('proponerBackfillExtracto: mapea una lista de líneas solo_extracto', () => {
  const lineas = [
    { id: 1, fecha: '2026-07-05', descripcion: 'Tienda D1', monto: -20000 },
    { id: 2, fecha: '2026-07-06', descripcion: 'Nómina', monto: 3000000 },
  ];
  const props = proponerBackfillExtracto(lineas, { cuenta: 'Bcol 0965' });
  assert.equal(props.length, 2);
  assert.equal(props[0].tipo, 'gasto');
  assert.equal(props[1].tipo, 'ingreso');
});

test('proponerBackfillExtracto: lista vacía o nula no explota', () => {
  assert.deepEqual(proponerBackfillExtracto([], {}), []);
  assert.deepEqual(proponerBackfillExtracto(null, {}), []);
});
