import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPlanCuentas, getPlanCuenta } from '../netlify/functions/_lib/repo.js';

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
