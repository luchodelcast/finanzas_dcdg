import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cuentaLiquidezPorMedioPago, lineasGasto, lineasTransferencia, lineasIngreso,
  contabilizarMovimiento, contabilizarIngreso,
} from '../netlify/functions/_lib/contabilizar.js';

const REGLAS = [
  { tipo: 'categoria', criterio: 'Alimentación', cuenta: '5105' },
  { tipo: 'categoria', criterio: 'Transporte', cuenta: '5110' },
  { tipo: 'cedula', criterio: 'trabajo', cuenta: '4110' },
  { tipo: 'cedula', criterio: 'honorarios', cuenta: '4155' },
];

// ---------------------------------------------------------------------------
// cuentaLiquidezPorMedioPago (puro)
// ---------------------------------------------------------------------------

test('cuentaLiquidezPorMedioPago: efectivo → caja (1105)', () => {
  assert.equal(cuentaLiquidezPorMedioPago('Efectivo'), '1105');
});

test('cuentaLiquidezPorMedioPago: tarjeta de crédito (prefijo "TC ") → pasivo (2105)', () => {
  assert.equal(cuentaLiquidezPorMedioPago('TC Colpatria'), '2105');
  assert.equal(cuentaLiquidezPorMedioPago('TC iWin (Superlikers)'), '2105');
});

test('cuentaLiquidezPorMedioPago: banco/billetera/USD → bancos (1110) por defecto', () => {
  assert.equal(cuentaLiquidezPorMedioPago('Bcol 0965'), '1110');
  assert.equal(cuentaLiquidezPorMedioPago('Nequi'), '1110');
  assert.equal(cuentaLiquidezPorMedioPago('DollarApp'), '1110');
});

test('cuentaLiquidezPorMedioPago: vacío → null', () => {
  assert.equal(cuentaLiquidezPorMedioPago(''), null);
  assert.equal(cuentaLiquidezPorMedioPago(null), null);
});

// ---------------------------------------------------------------------------
// lineasGasto / lineasTransferencia / lineasIngreso (puros)
// ---------------------------------------------------------------------------

test('lineasGasto: categoría con regla → cuenta de gasto correcta, cuadra', () => {
  const lineas = lineasGasto({ id: 1, categoria: 'Alimentación', metodo_pago: 'Efectivo', monto: 45000, moneda: 'COP' }, REGLAS);
  assert.deepEqual(lineas, [
    { cuenta: '5105', debito: 45000, credito: 0, movimiento_id: 1 },
    { cuenta: '1105', debito: 0, credito: 45000, movimiento_id: 1 },
  ]);
});

test('lineasGasto: categoría sin regla → cae a 5195 (Otros gastos)', () => {
  const lineas = lineasGasto({ id: 2, categoria: 'Categoría rara', metodo_pago: 'Nequi', monto: 10000, moneda: 'COP' }, REGLAS);
  assert.equal(lineas[0].cuenta, '5195');
});

test('lineasGasto: moneda distinta de COP → null (no contabiliza, sin subcuenta por moneda)', () => {
  assert.equal(lineasGasto({ id: 3, categoria: 'Alimentación', metodo_pago: 'DollarApp', monto: 10, moneda: 'USD' }, REGLAS), null);
});

test('lineasGasto: sin medio de pago resuelto → null', () => {
  assert.equal(lineasGasto({ id: 4, categoria: 'Alimentación', metodo_pago: '', monto: 10000, moneda: 'COP' }, REGLAS), null);
});

test('lineasTransferencia: cuentas de distinto tipo → cuadra', () => {
  const lineas = lineasTransferencia({ id: 5, metodo_pago: 'Bcol 0965', cuenta_destino: 'Efectivo', monto: 50000, moneda: 'COP' });
  assert.deepEqual(lineas, [
    { cuenta: '1105', debito: 50000, credito: 0, movimiento_id: 5 },
    { cuenta: '1110', debito: 0, credito: 50000, movimiento_id: 5 },
  ]);
});

test('lineasTransferencia: origen y destino resuelven a la misma cuenta → null (no arma asiento de 1 sola cuenta)', () => {
  assert.equal(lineasTransferencia({ id: 6, metodo_pago: 'Bcol 0965', cuenta_destino: 'Nequi', monto: 1000, moneda: 'COP' }), null);
});

test('lineasIngreso: cédula con regla → cuadra contra bancos', () => {
  const lineas = lineasIngreso({ id: 7, cedula: 'honorarios', monto: 2000000, moneda: 'COP' }, REGLAS);
  assert.deepEqual(lineas, [
    { cuenta: '1110', debito: 2000000, credito: 0, ingreso_id: 7 },
    { cuenta: '4155', debito: 0, credito: 2000000, ingreso_id: 7 },
  ]);
});

test('lineasIngreso: cédula sin regla → null (se omite, no adivina la cuenta)', () => {
  assert.equal(lineasIngreso({ id: 8, cedula: 'pension', monto: 100000, moneda: 'COP' }, REGLAS), null);
});

// ---------------------------------------------------------------------------
// contabilizarMovimiento / contabilizarIngreso con Postgres falseado.
// ---------------------------------------------------------------------------

function fakeDb() {
  const asientos = [];
  const lineas = [];
  let seq = 0;
  const CUENTAS = ['5105', '5110', '5195', '1110', '1105', '2105', '4110', '4155'];
  return {
    _asientos: asientos, _lineas: lineas,
    async query(text, params = []) {
      const t = text.replace(/\s+/g, ' ').trim();
      if (t.startsWith('select tipo, criterio, cuenta from reglas_contables')) return REGLAS;
      if (t.startsWith('select codigo, nombre, clase')) {
        return CUENTAS.map((codigo) => ({ codigo, nombre: codigo, clase: 1, naturaleza: 'debito', cuenta_padre: null }));
      }
      if (t.startsWith('insert into asientos')) {
        const key = params[6];
        if (asientos.some((a) => a.idempotency_key === key)) return [];
        const row = { id: ++seq, fecha: params[0], descripcion: params[1], entidad_id: params[2], origen: params[3], idempotency_key: key };
        asientos.push(row);
        return [row];
      }
      if (t.startsWith('select * from asientos where idempotency_key')) {
        return asientos.filter((a) => a.idempotency_key === params[0]).slice(0, 1);
      }
      if (t.startsWith('insert into asiento_lineas')) {
        for (let i = 0; i < params.length; i += 7) {
          lineas.push({ asiento_id: params[i], cuenta: params[i + 1], debito: params[i + 2], credito: params[i + 3] });
        }
        return [];
      }
      return [];
    },
  };
}

test('contabilizarMovimiento: gasto en COP → arma y guarda el asiento', async () => {
  const db = fakeDb();
  const r = await contabilizarMovimiento({ id: 10, tipo: 'gasto', categoria: 'Transporte', metodo_pago: 'Bcol 0965', monto: 15000, moneda: 'COP', fecha: '2026-07-07', descripcion: 'Uber' }, db);
  assert.equal(r.registrado, true);
  assert.equal(db._asientos.length, 1);
  assert.equal(db._lineas.length, 2);
});

test('contabilizarMovimiento: idempotente por movimiento_id (dos llamadas, un solo asiento)', async () => {
  const db = fakeDb();
  const mov = { id: 11, tipo: 'gasto', categoria: 'Transporte', metodo_pago: 'Bcol 0965', monto: 15000, moneda: 'COP', fecha: '2026-07-07', descripcion: 'Uber' };
  await contabilizarMovimiento(mov, db);
  const r2 = await contabilizarMovimiento(mov, db);
  assert.equal(r2.ya_existia, true);
  assert.equal(db._asientos.length, 1);
});

test('contabilizarMovimiento: USD → omitido, no escribe nada', async () => {
  const db = fakeDb();
  const r = await contabilizarMovimiento({ id: 12, tipo: 'gasto', categoria: 'Viajes', metodo_pago: 'DollarApp', monto: 100, moneda: 'USD', fecha: '2026-07-07', descripcion: 'Hotel' }, db);
  assert.equal(r.omitido, true);
  assert.equal(db._asientos.length, 0);
});

test('contabilizarIngreso: cédula con regla → arma y guarda el asiento', async () => {
  const db = fakeDb();
  const r = await contabilizarIngreso({ id: 20, cedula: 'trabajo', entidad_id: 1, monto: 3000000, moneda: 'COP', fecha: '2026-07-07', concepto: 'Salario julio' }, db);
  assert.equal(r.registrado, true);
  assert.equal(db._asientos.length, 1);
});

test('contabilizarIngreso: cédula sin regla → omitido, no escribe nada', async () => {
  const db = fakeDb();
  const r = await contabilizarIngreso({ id: 21, cedula: 'pension', entidad_id: 1, monto: 500000, moneda: 'COP', fecha: '2026-07-07' }, db);
  assert.equal(r.omitido, true);
  assert.equal(db._asientos.length, 0);
});
