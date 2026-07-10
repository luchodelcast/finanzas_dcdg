import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import { reporteCostosActividad } from '../netlify/functions/_lib/costos.js';
import {
  ensureCostosActividadSchema, resetCostosActividadSchemaParaTests,
  insertCostoActividad, listCostosActividad,
} from '../netlify/functions/_lib/repo.js';
import { deriveCostoActividadKey } from '../netlify/functions/_lib/idempotency.js';

// ---------------------------------------------------------------------------
// reporteCostosActividad — agregación de solo lectura (fake DB, sin red).
// ---------------------------------------------------------------------------

function fakeReporteDb({ ingresos, costos, entidades }) {
  async function query(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.includes('from costos_actividad c')) return costos;
    if (t.includes('from ingresos')) return ingresos;
    if (t.includes('from costos_actividad')) return []; // queryAportesBase (no se usa acá)
    if (t.includes('from entidades')) return entidades;
    if (t.startsWith('alter table') || t.startsWith('create table') || t.startsWith('create index')) return [];
    return [];
  }
  return { query };
}

test('reporteCostosActividad: mini-P&L por negocio (ingresos − costos deducibles)', async () => {
  resetCostosActividadSchemaParaTests();
  const db = fakeReporteDb({
    ingresos: [{ entidad_id: 3, total: 5_000_000 }], // Ahinoa
    costos: [
      { id: 1, entidad_id: 3, fecha: '2026-07-05', concepto: 'Tejedora', monto: 1_000_000, deducible: true, actividad: 'Ahinoa', entidad: 'Ahinoa', tercero: null },
      { id: 2, entidad_id: 3, fecha: '2026-07-06', concepto: 'No deducible', monto: 500_000, deducible: false, actividad: 'Ahinoa', entidad: 'Ahinoa', tercero: null },
    ],
    entidades: [
      { id: 1, nombre: 'Luis', tipo: 'persona' },
      { id: 3, nombre: 'Ahinoa', tipo: 'negocio' },
    ],
  });
  setSqlForTests(db);

  const r = await reporteCostosActividad({ periodo: '2026-07' });
  assert.equal(r.ok, true);
  assert.equal(r.costos.length, 2);
  assert.equal(r.por_negocio.length, 1, 'solo entidades tipo negocio');

  const ahinoa = r.por_negocio[0];
  assert.equal(ahinoa.entidad, 'Ahinoa');
  assert.equal(ahinoa.ingresos, 5_000_000);
  assert.equal(ahinoa.costos_deducibles, 1_000_000, 'el no-deducible no cuenta en el mini-P&L');
  assert.equal(ahinoa.utilidad, 4_000_000);

  setSqlForTests(null);
});

test('reporteCostosActividad: sin entidades tipo negocio → por_negocio vacío, no revienta', async () => {
  resetCostosActividadSchemaParaTests();
  const db = fakeReporteDb({ ingresos: [], costos: [], entidades: [{ id: 1, nombre: 'Luis', tipo: 'persona' }] });
  setSqlForTests(db);
  const r = await reporteCostosActividad({ periodo: '2026-07' });
  assert.deepEqual(r.por_negocio, []);
  setSqlForTests(null);
});

// ---------------------------------------------------------------------------
// Capa de datos (costos_actividad) — Postgres falseado. DDL idempotente +
// insert idempotente + listado filtrado.
// ---------------------------------------------------------------------------
function fakeRepoDb() {
  const rows = [];
  let nextId = 1;
  const ddlCalls = [];
  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (t.startsWith('create table') || t.startsWith('alter table') || t.startsWith('create index')) {
      ddlCalls.push(t);
      return [];
    }
    if (t.startsWith('insert into costos_actividad')) {
      const [entidad_id, actividad, fecha, concepto, tercero_id, monto, deducible, notas, idempotency_key] = params;
      if (rows.some((r) => r.idempotency_key === idempotency_key)) return [];
      const row = { id: nextId++, entidad_id, actividad, fecha, concepto, tercero_id, monto, deducible, notas, idempotency_key, entidad: 'Ahinoa', tercero: null };
      rows.push(row);
      return [row];
    }
    if (t.startsWith('select * from costos_actividad where idempotency_key')) {
      return rows.filter((r) => r.idempotency_key === params[0]).slice(0, 1);
    }
    if (t.includes('from costos_actividad c')) {
      let out = rows.slice();
      // params van en el mismo orden en que se agregan los cond (entidad_id, desde, hasta) + limit al final.
      // OJO: incrementar `pi` FUERA del callback de filter — adentro se evalúa una vez por fila, no una
      // vez por condición, y desalinea los índices de params.
      let pi = 0;
      if (t.includes('c.entidad_id = $')) { out = out.filter((r) => r.entidad_id === params[pi]); pi++; }
      if (t.includes('c.fecha >= $')) { out = out.filter((r) => r.fecha >= params[pi]); pi++; }
      if (t.includes('c.fecha <= $')) { out = out.filter((r) => r.fecha <= params[pi]); pi++; }
      return out;
    }
    return [];
  }
  return { query, _rows: rows, _ddlCalls: ddlCalls };
}

function reset() {
  resetCostosActividadSchemaParaTests();
  setSqlForTests(null);
}

test('ensureCostosActividadSchema: crea la tabla/columna, memoizado (no repite el DDL)', async () => {
  reset();
  const db = fakeRepoDb();
  setSqlForTests(db);

  await ensureCostosActividadSchema();
  const trasPrimera = db._ddlCalls.length;
  assert.ok(trasPrimera > 0);
  await ensureCostosActividadSchema();
  assert.equal(db._ddlCalls.length, trasPrimera);

  reset();
});

test('insertCostoActividad: idempotente por idempotency_key', async () => {
  reset();
  const db = fakeRepoDb();
  setSqlForTests(db);

  const key = deriveCostoActividadKey({ entidad_id: 3, fecha: '2026-07-05', monto: 1_000_000, concepto: 'Tejedora' });
  const r1 = await insertCostoActividad({ entidad_id: 3, fecha: '2026-07-05', monto: 1_000_000, concepto: 'Tejedora', idempotency_key: key });
  assert.equal(r1.inserted, true);
  const r2 = await insertCostoActividad({ entidad_id: 3, fecha: '2026-07-05', monto: 1_000_000, concepto: 'Tejedora', idempotency_key: key });
  assert.equal(r2.inserted, false);
  assert.equal(r2.row.id, r1.row.id);
  assert.equal(db._rows.length, 1);

  reset();
});

test('listCostosActividad: filtra por entidad y rango de fechas', async () => {
  reset();
  const db = fakeRepoDb();
  setSqlForTests(db);

  await insertCostoActividad({
    entidad_id: 3, fecha: '2026-07-05', monto: 1_000_000, concepto: 'Tejedora',
    idempotency_key: deriveCostoActividadKey({ entidad_id: 3, fecha: '2026-07-05', monto: 1_000_000, concepto: 'Tejedora' }),
  });
  await insertCostoActividad({
    entidad_id: 3, fecha: '2026-06-01', monto: 200_000, concepto: 'Fuera de rango',
    idempotency_key: deriveCostoActividadKey({ entidad_id: 3, fecha: '2026-06-01', monto: 200_000, concepto: 'Fuera de rango' }),
  });

  const delMes = await listCostosActividad({ entidad_id: 3, desde: '2026-07-01', hasta: '2026-07-31' });
  assert.equal(delMes.length, 1);
  assert.equal(delMes[0].concepto, 'Tejedora');

  const otraEntidad = await listCostosActividad({ entidad_id: 99 });
  assert.equal(otraEntidad.length, 0);

  reset();
});
