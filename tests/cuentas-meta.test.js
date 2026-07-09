import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listCuentasMeta, upsertCuentaMeta, ensureCuentasMetaSchema, resetCuentasMetaSchemaParaTests,
} from '../netlify/functions/_lib/repo.js';
import { resetPlanCuentasSchemaParaTests } from '../netlify/functions/_lib/repo.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';

// Fake mínimo de Postgres: soporta el DDL/seed de plan_cuentas (dependencia de
// cuentas_meta por la FK) y las consultas propias de cuentas_meta.
function fakeDb() {
  const planCuentas = [];
  const cuentasMeta = [];
  const ddlCalls = [];
  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (t.startsWith('create table') || t.startsWith('create index')) { ddlCalls.push(t); return []; }
    if (t.startsWith('insert into plan_cuentas')) {
      const [codigo, nombre, clase, naturaleza, cuenta_padre] = params;
      if (planCuentas.some((r) => r.codigo === codigo)) return [];
      planCuentas.push({ codigo, nombre, clase, naturaleza, cuenta_padre });
      return [];
    }
    if (t.startsWith('insert into cuentas_meta')) {
      const [nombre, dueno, bolsillo, cuenta_puc] = params;
      if (cuenta_puc && !planCuentas.some((p) => p.codigo === cuenta_puc)) {
        throw new Error(`insert or update on table "cuentas_meta" violates foreign key constraint`);
      }
      const existente = cuentasMeta.find((r) => r.nombre === nombre);
      if (existente) { Object.assign(existente, { dueno, bolsillo, cuenta_puc }); return [existente]; }
      const row = { nombre, dueno, bolsillo, cuenta_puc };
      cuentasMeta.push(row);
      return [row];
    }
    if (t.startsWith('select nombre, dueno, bolsillo, cuenta_puc from cuentas_meta')) {
      return cuentasMeta.slice().sort((a, b) => (a.nombre < b.nombre ? -1 : 1));
    }
    return [];
  }
  return { query, _planCuentas: planCuentas, _cuentasMeta: cuentasMeta, _ddlCalls: ddlCalls };
}

function reset() {
  resetCuentasMetaSchemaParaTests();
  resetPlanCuentasSchemaParaTests();
  setSqlForTests(null);
}

test('ensureCuentasMetaSchema: crea la tabla (y plan_cuentas, su dependencia), memoizado', async () => {
  reset();
  const db = fakeDb();
  setSqlForTests(db);

  await ensureCuentasMetaSchema();
  const ddlTrasPrimera = db._ddlCalls.length;
  assert.ok(ddlTrasPrimera > 0);
  assert.ok(db._ddlCalls.some((c) => c.includes('cuentas_meta')));

  await ensureCuentasMetaSchema(); // segunda llamada: no repite el DDL
  assert.equal(db._ddlCalls.length, ddlTrasPrimera);

  reset();
});

test('upsertCuentaMeta: crea y luego actualiza (upsert por nombre), valida dueno/bolsillo', async () => {
  reset();
  const db = fakeDb();
  setSqlForTests(db);

  const m1 = await upsertCuentaMeta({ nombre: 'Serfinanza', dueno: 'carolina', bolsillo: 'gasto_individual' });
  assert.equal(m1.dueno, 'carolina');
  assert.equal(m1.cuenta_puc, null);

  const m2 = await upsertCuentaMeta({ nombre: 'Serfinanza', dueno: 'luis', bolsillo: 'comun' });
  assert.equal(m2.dueno, 'luis'); // update, no duplica
  assert.equal(db._cuentasMeta.length, 1);

  await assert.rejects(() => upsertCuentaMeta({ nombre: 'X', dueno: 'nadie' }), /dueno inválido/);
  await assert.rejects(() => upsertCuentaMeta({ nombre: 'X', bolsillo: 'otro' }), /bolsillo inválido/);
  await assert.rejects(() => upsertCuentaMeta({ nombre: '' }), /nombre/i);

  reset();
});

test('upsertCuentaMeta: cuenta_puc explícito debe existir en plan_cuentas (FK)', async () => {
  reset();
  const db = fakeDb();
  setSqlForTests(db);
  db._planCuentas.push({ codigo: '2105', nombre: 'Tarjeta de crédito', clase: 2, naturaleza: 'credito', cuenta_padre: '21' });

  const m = await upsertCuentaMeta({ nombre: 'Serfinanza', dueno: 'carolina', bolsillo: 'gasto_individual', cuenta_puc: '2105' });
  assert.equal(m.cuenta_puc, '2105');

  await assert.rejects(() => upsertCuentaMeta({ nombre: 'Otra', cuenta_puc: '9999' }), /foreign key/i);

  reset();
});

test('listCuentasMeta: devuelve las cuentas con fila propia, ordenadas por nombre', async () => {
  reset();
  const db = fakeDb();
  setSqlForTests(db);

  await upsertCuentaMeta({ nombre: 'Serfinanza', dueno: 'carolina', bolsillo: 'gasto_individual' });
  await upsertCuentaMeta({ nombre: 'Efectivo Luis', dueno: 'luis', bolsillo: 'gasto_individual' });

  const rows = await listCuentasMeta();
  assert.deepEqual(rows.map((r) => r.nombre), ['Efectivo Luis', 'Serfinanza']);

  reset();
});
