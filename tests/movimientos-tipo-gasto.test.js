import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import { insertMovimiento, queryMovimientos } from '../netlify/functions/_lib/repo.js';

// ---------------------------------------------------------------------------
// Repo de tipo_gasto (hogar/personal, issue #114). Postgres falseado: solo
// las consultas que emite insertMovimiento/queryMovimientos para esta feature.
// ---------------------------------------------------------------------------
function fakeDb() {
  const movimientos = [];
  let seq = 0;

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim();

    if (t.startsWith('alter table')) return [];

    if (t.startsWith('insert into movimientos')) {
      const key = params[13];
      if (movimientos.some((m) => m.idempotency_key === key)) return [];
      const row = {
        id: ++seq, fecha: params[0], tipo: params[1], categoria: params[2], subcategoria: params[3],
        descripcion: params[4], monto: params[5], moneda: params[6], metodo_pago: params[7],
        quien_pago: params[8], tarjeta: params[9], cuenta_destino: params[10], notas: params[11],
        origen: params[12], idempotency_key: key, anulado: false,
        tipo_gasto: params[16], tipo_gasto_persona: params[17], tipo_gasto_auto: params[18],
        creado_en: '2026-07-09T12:00:00Z',
      };
      movimientos.push(row);
      return [row];
    }
    if (t.startsWith('select * from movimientos where idempotency_key')) {
      return movimientos.filter((m) => m.idempotency_key === params[0]).slice(0, 1);
    }
    if (t.startsWith('select id, fecha, tipo, categoria')) {
      // queryMovimientos: where dinámico + límite como último parámetro.
      const limit = params[params.length - 1];
      let rows = movimientos.slice();
      if (t.includes('tipo_gasto = $')) {
        const idx = t.indexOf('tipo_gasto = $');
        const num = parseInt(t.slice(idx + 'tipo_gasto = $'.length), 10);
        rows = rows.filter((m) => m.tipo_gasto === params[num - 1]);
      }
      return rows.slice(0, limit);
    }
    return [];
  }

  return { query, _movimientos: movimientos };
}

test('insertMovimiento: persiste tipo_gasto/tipo_gasto_persona/tipo_gasto_auto', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  const { row } = await insertMovimiento({
    fecha: '2026-07-09', tipo: 'gasto', categoria: 'Alimentación', descripcion: 'Éxito', monto: 50000,
    metodo_pago: 'Serfinanza', quien_pago: 'Carolina', origen: 'App', idempotency_key: 'k1',
    tipo_gasto: 'personal', tipo_gasto_persona: 'Carolina', tipo_gasto_auto: false,
  });
  assert.equal(row.tipo_gasto, 'personal');
  assert.equal(row.tipo_gasto_persona, 'Carolina');
  assert.equal(row.tipo_gasto_auto, false);
  setSqlForTests(null);
});

test('insertMovimiento: sin tipo_gasto explícito, nace "hogar" (auto) por compat', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  const { row } = await insertMovimiento({
    fecha: '2026-07-09', tipo: 'gasto', categoria: 'Alimentación', descripcion: 'Éxito', monto: 50000,
    metodo_pago: 'Bcol 0965', quien_pago: 'Luis', origen: 'App', idempotency_key: 'k2',
  });
  assert.equal(row.tipo_gasto, 'hogar');
  assert.equal(row.tipo_gasto_persona, null);
  assert.equal(row.tipo_gasto_auto, true);
  setSqlForTests(null);
});

test('queryMovimientos: expone tipo_gasto y filtra por tipoGasto', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  await insertMovimiento({
    fecha: '2026-07-09', tipo: 'gasto', descripcion: 'Hogar', monto: 10000,
    metodo_pago: 'Bcol 0965', quien_pago: 'Luis', origen: 'App', idempotency_key: 'k3',
    tipo_gasto: 'hogar',
  });
  await insertMovimiento({
    fecha: '2026-07-09', tipo: 'gasto', descripcion: 'Personal', monto: 20000,
    metodo_pago: 'Serfinanza', quien_pago: 'Carolina', origen: 'App', idempotency_key: 'k4',
    tipo_gasto: 'personal', tipo_gasto_persona: 'Carolina', tipo_gasto_auto: false,
  });

  const todos = await queryMovimientos({});
  assert.equal(todos.length, 2);
  assert.ok(todos.every((m) => 'tipo_gasto' in m));

  const soloPersonal = await queryMovimientos({ tipoGasto: 'personal' });
  assert.equal(soloPersonal.length, 1);
  assert.equal(soloPersonal[0].descripcion, 'Personal');
  assert.equal(soloPersonal[0].tipo_gasto_persona, 'Carolina');

  setSqlForTests(null);
});
