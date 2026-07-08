import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularSaldoPrestamos } from '../netlify/functions/_lib/prestamos.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import {
  ensurePrestamosSchema, resetPrestamosSchemaParaTests, listPrestamos, insertPrestamo, marcarPrestamoSaldado,
} from '../netlify/functions/_lib/repo.js';

// ---------------------------------------------------------------------------
// calcularSaldoPrestamos — pura.
// ---------------------------------------------------------------------------
test('calcularSaldoPrestamos: Luis→Carolina neto positivo → Carolina debe', () => {
  const r = calcularSaldoPrestamos([{ de: 'Luis', para: 'Carolina', monto: 100, moneda: 'COP', saldado: false }]);
  assert.deepEqual(r, [{ moneda: 'COP', neto: 100, deudor: 'Carolina' }]);
});

test('calcularSaldoPrestamos: Carolina→Luis neto negativo → Luis debe', () => {
  const r = calcularSaldoPrestamos([{ de: 'Carolina', para: 'Luis', monto: 40, moneda: 'COP', saldado: false }]);
  assert.deepEqual(r, [{ moneda: 'COP', neto: 40, deudor: 'Luis' }]);
});

test('calcularSaldoPrestamos: un abono (sentido inverso) reduce el neto', () => {
  const r = calcularSaldoPrestamos([
    { de: 'Luis', para: 'Carolina', monto: 100, moneda: 'COP', saldado: false },
    { de: 'Carolina', para: 'Luis', monto: 30, moneda: 'COP', saldado: false }, // abono
  ]);
  assert.deepEqual(r, [{ moneda: 'COP', neto: 70, deudor: 'Carolina' }]);
});

test('calcularSaldoPrestamos: préstamo saldado no cuenta para el neto', () => {
  const r = calcularSaldoPrestamos([
    { de: 'Luis', para: 'Carolina', monto: 100, moneda: 'COP', saldado: true },
    { de: 'Luis', para: 'Carolina', monto: 20, moneda: 'COP', saldado: false },
  ]);
  assert.deepEqual(r, [{ moneda: 'COP', neto: 20, deudor: 'Carolina' }]);
});

test('calcularSaldoPrestamos: neto en 0 → deudor null (a paz y salvo)', () => {
  const r = calcularSaldoPrestamos([
    { de: 'Luis', para: 'Carolina', monto: 50, moneda: 'COP', saldado: false },
    { de: 'Carolina', para: 'Luis', monto: 50, moneda: 'COP', saldado: false },
  ]);
  assert.deepEqual(r, [{ moneda: 'COP', neto: 0, deudor: null }]);
});

test('calcularSaldoPrestamos: agrupa por moneda por separado', () => {
  const r = calcularSaldoPrestamos([
    { de: 'Luis', para: 'Carolina', monto: 100, moneda: 'COP', saldado: false },
    { de: 'Carolina', para: 'Luis', monto: 10, moneda: 'USD', saldado: false },
  ]);
  assert.deepEqual(r.find((s) => s.moneda === 'COP'), { moneda: 'COP', neto: 100, deudor: 'Carolina' });
  assert.deepEqual(r.find((s) => s.moneda === 'USD'), { moneda: 'USD', neto: 10, deudor: 'Luis' });
});

test('calcularSaldoPrestamos: sin préstamos → []', () => {
  assert.deepEqual(calcularSaldoPrestamos([]), []);
});

// ---------------------------------------------------------------------------
// Capa de datos — Postgres falseado. Verifica el DDL idempotente en runtime
// (modo auto-ok) y las operaciones de escritura.
// ---------------------------------------------------------------------------
function fakeDb() {
  const prestamos = [];
  let nextId = 1;
  const ddlCalls = [];

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (t.startsWith('create table')) { ddlCalls.push(t); return []; }
    if (t.startsWith('insert into prestamos')) {
      const [fecha, de, para, monto, concepto, moneda, notas] = params;
      const row = { id: nextId++, fecha, de, para, monto, concepto, moneda, saldado: false, notas };
      prestamos.push(row);
      return [row];
    }
    if (t.startsWith('select * from prestamos where saldado')) {
      const [saldado] = params;
      return prestamos.filter((p) => p.saldado === saldado);
    }
    if (t.startsWith('select * from prestamos order')) {
      return prestamos.slice();
    }
    if (t.startsWith('update prestamos set saldado')) {
      const [id, saldado] = params;
      const row = prestamos.find((p) => p.id === id);
      if (!row) return [];
      row.saldado = saldado;
      return [row];
    }
    return [];
  }

  return { query, _prestamos: prestamos, _ddlCalls: ddlCalls };
}

test('ensurePrestamosSchema: crea la tabla, memoizado (no repite el DDL)', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  await ensurePrestamosSchema();
  const ddlTrasPrimera = db._ddlCalls.length;
  assert.ok(ddlTrasPrimera > 0);

  await ensurePrestamosSchema(); // segunda llamada: no debe repetir el DDL
  assert.equal(db._ddlCalls.length, ddlTrasPrimera);

  setSqlForTests(null);
  resetPrestamosSchemaParaTests();
});

test('ensurePrestamosSchema: llamadas concurrentes (Promise.all) corren el DDL una sola vez', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  await Promise.all([ensurePrestamosSchema(), ensurePrestamosSchema(), ensurePrestamosSchema()]);
  assert.equal(db._ddlCalls.length, 1);

  setSqlForTests(null);
  resetPrestamosSchemaParaTests();
});

test('insertPrestamo: registra un préstamo válido', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  const p = await insertPrestamo({ fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 100, concepto: 'Mercado' });
  assert.equal(p.de, 'Luis');
  assert.equal(p.para, 'Carolina');
  assert.equal(p.monto, 100);

  setSqlForTests(null);
  resetPrestamosSchemaParaTests();
});

test('insertPrestamo: rechaza personas inválidas, misma persona, y monto <= 0', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  await assert.rejects(() => insertPrestamo({ fecha: '2026-07-08', de: 'Luis', para: 'Santiago', monto: 100 }), /Luis.*Carolina/);
  await assert.rejects(() => insertPrestamo({ fecha: '2026-07-08', de: 'Luis', para: 'Luis', monto: 100 }), /misma persona/);
  await assert.rejects(() => insertPrestamo({ fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 0 }), /mayor a 0/);

  setSqlForTests(null);
  resetPrestamosSchemaParaTests();
});

test('listPrestamos / marcarPrestamoSaldado: filtra por saldado y actualiza', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  const p = await insertPrestamo({ fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 100 });
  assert.equal((await listPrestamos({ saldado: false })).length, 1);
  assert.equal((await listPrestamos({ saldado: true })).length, 0);

  const actualizado = await marcarPrestamoSaldado(p.id, true);
  assert.equal(actualizado.saldado, true);
  assert.equal((await listPrestamos({ saldado: true })).length, 1);
  assert.equal((await listPrestamos({ saldado: false })).length, 0);

  setSqlForTests(null);
  resetPrestamosSchemaParaTests();
});
