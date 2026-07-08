import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPlanCuentas, getPlanCuenta, naturalezaDeClase } from '../netlify/functions/_lib/repo.js';
import {
  ensurePlanCuentasSchema, resetPlanCuentasSchemaParaTests, sugerirCodigoCuenta, insertPlanCuenta,
} from '../netlify/functions/_lib/repo.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';

// Fake mínimo de Postgres para las dos consultas del plan de cuentas.
function fakeDb(rows) {
  return {
    query: async (text, params = []) => {
      const t = text.replace(/\s+/g, ' ').trim();
      if (t.startsWith('select codigo, nombre, clase, naturaleza, cuenta_padre from plan_cuentas where codigo =')) {
        return rows.filter((r) => r.codigo === params[0]).slice(0, 1);
      }
      if (t.startsWith('select codigo, nombre, clase')) {
        let out = rows.filter((r) => r.activo !== false);
        if (t.includes('and clase =')) out = out.filter((r) => r.clase === params[0]);
        return out.slice().sort((a, b) => (a.codigo < b.codigo ? -1 : 1));
      }
      return [];
    },
  };
}

const CUENTAS = [
  { codigo: '1105', nombre: 'Caja (efectivo)', clase: 1, naturaleza: 'debito', cuenta_padre: '11', activo: true },
  { codigo: '1110', nombre: 'Bancos y billeteras', clase: 1, naturaleza: 'debito', cuenta_padre: '11', activo: true },
  { codigo: '4155', nombre: 'Honorarios', clase: 4, naturaleza: 'credito', cuenta_padre: '4', activo: true },
  { codigo: '5105', nombre: 'Alimentación', clase: 5, naturaleza: 'debito', cuenta_padre: '5', activo: true },
  { codigo: '9999', nombre: 'Cuenta inactiva', clase: 5, naturaleza: 'debito', cuenta_padre: '5', activo: false },
];

test('listPlanCuentas: devuelve las activas ordenadas por código', async () => {
  const db = fakeDb(CUENTAS);
  const r = await listPlanCuentas({}, db);
  assert.deepEqual(r.map((c) => c.codigo), ['1105', '1110', '4155', '5105']); // 9999 inactiva excluida
});

test('listPlanCuentas: filtra por clase', async () => {
  const db = fakeDb(CUENTAS);
  const r = await listPlanCuentas({ clase: 1 }, db);
  assert.equal(r.length, 2);
  assert.ok(r.every((c) => c.clase === 1));
});

test('listPlanCuentas: clase como string (query param) también filtra', async () => {
  const db = fakeDb(CUENTAS);
  const r = await listPlanCuentas({ clase: '4' }, db);
  assert.deepEqual(r.map((c) => c.codigo), ['4155']);
});

test('getPlanCuenta: encuentra por código y devuelve null si no existe', async () => {
  const db = fakeDb(CUENTAS);
  assert.equal((await getPlanCuenta('4155', db)).nombre, 'Honorarios');
  assert.equal(await getPlanCuenta('0000', db), null);
});

// ---------------------------------------------------------------------------
// naturalezaDeClase — pura.
// ---------------------------------------------------------------------------
test('naturalezaDeClase: activo/gasto/costo debito, pasivo/patrimonio/ingreso credito', () => {
  assert.equal(naturalezaDeClase(1), 'debito');
  assert.equal(naturalezaDeClase(5), 'debito');
  assert.equal(naturalezaDeClase(6), 'debito');
  assert.equal(naturalezaDeClase(2), 'credito');
  assert.equal(naturalezaDeClase(3), 'credito');
  assert.equal(naturalezaDeClase(4), 'credito');
});

// ---------------------------------------------------------------------------
// Ampliación del plan de cuentas (issue #74) — Postgres falseado. Verifica el
// DDL/seed idempotente en runtime (modo auto-ok) y la escritura de "＋ Agregar cuenta".
// ---------------------------------------------------------------------------
function fakeWritableDb(seedRows = []) {
  const rows = seedRows.map((r) => ({ ...r }));
  const ddlCalls = [];
  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (t.startsWith('create table') || t.startsWith('create index')) { ddlCalls.push(t); return []; }
    if (t.startsWith('insert into plan_cuentas') && t.includes('on conflict (codigo) do nothing')) {
      const [codigo, nombre, clase, naturaleza, cuenta_padre] = params;
      if (rows.some((r) => r.codigo === codigo)) return [];
      rows.push({ codigo, nombre, clase, naturaleza, cuenta_padre, activo: true });
      return [];
    }
    if (t.startsWith('insert into plan_cuentas')) {
      const [codigo, nombre, clase, naturaleza, cuenta_padre] = params;
      if (rows.some((r) => r.codigo === codigo)) throw new Error('duplicate key value violates unique constraint');
      const row = { codigo, nombre, clase, naturaleza, cuenta_padre, activo: true };
      rows.push(row);
      return [row];
    }
    if (t.startsWith('select codigo from plan_cuentas where clase')) {
      const [clase] = params;
      const candidatos = rows.filter((r) => r.clase === clase && String(r.codigo).length >= 4)
        .slice().sort((a, b) => (a.codigo > b.codigo ? -1 : 1));
      return candidatos.slice(0, 1);
    }
    return [];
  }
  return { query, _rows: rows, _ddlCalls: ddlCalls };
}

test('ensurePlanCuentasSchema: crea la tabla + siembra las cuentas nuevas, memoizado (no repite el DDL)', async () => {
  resetPlanCuentasSchemaParaTests();
  const db = fakeWritableDb();
  setSqlForTests(db);

  await ensurePlanCuentasSchema();
  const ddlTrasPrimera = db._ddlCalls.length;
  assert.ok(ddlTrasPrimera > 0);
  assert.ok(db._rows.some((r) => r.codigo === '2110'), 'sembró obligaciones financieras');
  assert.ok(db._rows.some((r) => r.codigo === '1315'), 'sembró CxC a empresas/socios');
  assert.ok(db._rows.some((r) => r.codigo === '2340'), 'sembró CxP a empresas/socios');

  await ensurePlanCuentasSchema(); // segunda llamada: no debe repetir el DDL
  assert.equal(db._ddlCalls.length, ddlTrasPrimera);

  setSqlForTests(null);
  resetPlanCuentasSchemaParaTests();
});

test('sugerirCodigoCuenta: siguiente código libre dentro de la clase (paso de 5)', async () => {
  resetPlanCuentasSchemaParaTests();
  const db = fakeWritableDb([{ codigo: '5135', nombre: 'Gastos bancarios', clase: 5, naturaleza: 'debito', cuenta_padre: '5' }]);
  setSqlForTests(db);

  assert.equal(await sugerirCodigoCuenta(5), '5140');

  setSqlForTests(null);
  resetPlanCuentasSchemaParaTests();
});

test('sugerirCodigoCuenta: sin cuentas hoja previas en la clase, arranca en x105', async () => {
  resetPlanCuentasSchemaParaTests();
  const db = fakeWritableDb();
  setSqlForTests(db);

  // La semilla de #74 ya deja algo en clase 1/2; probamos con una clase vacía (6 sin nada aún tras el seed).
  const codigo = await sugerirCodigoCuenta(9);
  assert.equal(codigo, '9105');

  setSqlForTests(null);
  resetPlanCuentasSchemaParaTests();
});

test('insertPlanCuenta: agrega una cuenta de Activo/Pasivo con código sugerido y naturaleza inferida', async () => {
  resetPlanCuentasSchemaParaTests();
  const db = fakeWritableDb();
  setSqlForTests(db);

  const cuenta = await insertPlanCuenta({ clase: 2, nombre: 'Crédito vehículo Bancolombia' });
  assert.equal(cuenta.naturaleza, 'credito');
  assert.equal(cuenta.nombre, 'Crédito vehículo Bancolombia');
  assert.ok(String(cuenta.codigo).length >= 4);
  assert.equal(cuenta.cuenta_padre, '2');

  setSqlForTests(null);
  resetPlanCuentasSchemaParaTests();
});

test('insertPlanCuenta: rechaza clase distinta de Activo/Pasivo y nombre vacío', async () => {
  resetPlanCuentasSchemaParaTests();
  const db = fakeWritableDb();
  setSqlForTests(db);

  await assert.rejects(() => insertPlanCuenta({ clase: 5, nombre: 'Algo' }), /Activo.*Pasivo/);
  await assert.rejects(() => insertPlanCuenta({ clase: 1, nombre: '' }), /nombre/i);

  setSqlForTests(null);
  resetPlanCuentasSchemaParaTests();
});
