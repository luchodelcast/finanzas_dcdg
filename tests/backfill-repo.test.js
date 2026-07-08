import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import {
  getExtractoLinea, marcarLineaMaterializada, insertMovimiento, insertIngreso,
} from '../netlify/functions/_lib/repo.js';

// ---------------------------------------------------------------------------
// Repo del backfill de líneas `solo_extracto` (issue #72). Postgres falseado.
// ---------------------------------------------------------------------------

function fakeDb() {
  const extracto_lineas = [
    { id: 1, extracto_id: 9, fecha: '2026-07-05', descripcion: 'Comision manejo', monto: -12000, estado: 'sin_conciliar', movimiento_id: null, ingreso_id: null },
    { id: 2, extracto_id: 9, fecha: '2026-07-06', descripcion: 'Ya materializada', monto: -9000, estado: 'conciliado', movimiento_id: 555, ingreso_id: null },
  ];
  const movimientos = [];
  const ingresos = [];
  let seq = 100;

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim();

    if (t.startsWith('select * from extracto_lineas where id')) {
      return extracto_lineas.filter((l) => l.id === params[0]);
    }
    if (t.startsWith("update extracto_lineas set estado = 'conciliado', movimiento_id")) {
      const l = extracto_lineas.find((x) => x.id === params[0] && x.estado === 'sin_conciliar');
      if (!l) return [];
      l.estado = 'conciliado'; l.movimiento_id = params[1];
      return [{ id: l.id }];
    }
    if (t.startsWith("update extracto_lineas set estado = 'conciliado', ingreso_id")) {
      const l = extracto_lineas.find((x) => x.id === params[0] && x.estado === 'sin_conciliar');
      if (!l) return [];
      l.estado = 'conciliado'; l.ingreso_id = params[1];
      return [{ id: l.id }];
    }
    if (t.startsWith('insert into movimientos')) {
      // cols: fecha,tipo,categoria,subcategoria,descripcion,monto,moneda,metodo_pago,
      //       quien_pago,tarjeta,cuenta_destino,notas,origen,idempotency_key,
      //       estado_conciliacion,extracto_linea_id
      const key = params[13];
      if (movimientos.some((m) => m.idempotency_key === key)) return [];
      const row = {
        id: ++seq, fecha: params[0], descripcion: params[4], monto: params[5],
        idempotency_key: key, estado_conciliacion: params[14], extracto_linea_id: params[15],
      };
      movimientos.push(row);
      return [row];
    }
    if (t.startsWith('insert into ingresos')) {
      // cols: entidad_id,fecha,cedula,concepto,tercero_id,cuenta_id,monto,moneda,
      //       retencion_fuente,actividad,notas,origen,idempotency_key,
      //       estado_conciliacion,extracto_linea_id
      const key = params[12];
      if (ingresos.some((i) => i.idempotency_key === key)) return [];
      const row = {
        id: ++seq, entidad_id: params[0], fecha: params[1], cedula: params[2], monto: params[6],
        idempotency_key: key, estado_conciliacion: params[13], extracto_linea_id: params[14],
      };
      ingresos.push(row);
      return [row];
    }
    return [];
  }

  return { query, _extracto_lineas: extracto_lineas, _movimientos: movimientos, _ingresos: ingresos };
}

test('getExtractoLinea: devuelve la línea por id o null', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  assert.equal((await getExtractoLinea(1)).descripcion, 'Comision manejo');
  assert.equal(await getExtractoLinea(999), null);
  setSqlForTests(null);
});

test('marcarLineaMaterializada: marca conciliado + movimiento_id si sigue sin_conciliar', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  const ok1 = await marcarLineaMaterializada({ linea_id: 1, tipo: 'movimiento', id: 777 });
  assert.equal(ok1, true);
  assert.equal(db._extracto_lineas[0].estado, 'conciliado');
  assert.equal(db._extracto_lineas[0].movimiento_id, 777);
  setSqlForTests(null);
});

test('marcarLineaMaterializada: no re-materializa una línea ya conciliada (idempotente)', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  const ok2 = await marcarLineaMaterializada({ linea_id: 2, tipo: 'movimiento', id: 888 });
  assert.equal(ok2, false);
  assert.equal(db._extracto_lineas[1].movimiento_id, 555, 'no debe pisar el movimiento_id original');
  setSqlForTests(null);
});

test('insertMovimiento: nace estado_conciliacion=conciliado y ligado a la línea cuando se pide (backfill)', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  const { inserted, row } = await insertMovimiento({
    fecha: '2026-07-05', tipo: 'gasto', descripcion: 'Comision manejo', monto: 12000,
    origen: 'Extracto', idempotency_key: 'extracto:linea:1',
    estado_conciliacion: 'conciliado', extracto_linea_id: 1,
  });
  assert.equal(inserted, true);
  assert.equal(row.estado_conciliacion, 'conciliado');
  assert.equal(row.extracto_linea_id, 1);
  setSqlForTests(null);
});

test('insertMovimiento: sin backfill, sigue naciendo provisional por defecto (compat)', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  const { row } = await insertMovimiento({
    fecha: '2026-07-05', tipo: 'gasto', descripcion: 'Gasto normal', monto: 5000,
    origen: 'App', idempotency_key: 'algo-distinto',
  });
  assert.equal(row.estado_conciliacion, 'provisional');
  assert.equal(row.extracto_linea_id, null);
  setSqlForTests(null);
});

test('insertIngreso: nace estado_conciliacion=conciliado y ligado a la línea cuando se pide (backfill)', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  const { inserted, row } = await insertIngreso({
    entidad_id: 1, fecha: '2026-07-10', cedula: 'no_laboral', concepto: 'Consignación', monto: 3200000,
    origen: 'Extracto', idempotency_key: 'extracto:linea:3',
    estado_conciliacion: 'conciliado', extracto_linea_id: 3,
  });
  assert.equal(inserted, true);
  assert.equal(row.estado_conciliacion, 'conciliado');
  assert.equal(row.extracto_linea_id, 3);
  setSqlForTests(null);
});
