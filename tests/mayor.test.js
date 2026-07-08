import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirMayor, construirComprobacion, mayorCuenta, balanceComprobacion } from '../netlify/functions/_lib/mayor.js';

test('construirMayor: cuenta de naturaleza débito acumula saldo con el débito', () => {
  const r = construirMayor([
    { fecha: '2026-07-01', descripcion: 'Apertura', debito: 100000, credito: 0 },
    { fecha: '2026-07-05', descripcion: 'Mercado', debito: 45000, credito: 0 },
    { fecha: '2026-07-10', descripcion: 'Pago', debito: 0, credito: 20000 },
  ], 'debito');
  assert.equal(r.saldoFinal, 125000);
  assert.equal(r.lineas.length, 3);
  assert.equal(r.lineas[0].saldo, 100000);
  assert.equal(r.lineas[2].saldo, 125000);
});

test('construirMayor: cuenta de naturaleza crédito acumula saldo con el crédito', () => {
  const r = construirMayor([
    { fecha: '2026-07-01', debito: 0, credito: 50000 },
    { fecha: '2026-07-05', debito: 10000, credito: 0 },
  ], 'credito');
  assert.equal(r.saldoFinal, 40000);
});

test('construirMayor: sin renglones → saldo 0', () => {
  const r = construirMayor([], 'debito');
  assert.equal(r.saldoFinal, 0);
  assert.deepEqual(r.lineas, []);
});

test('construirMayor: tolera decimales sin error de punto flotante', () => {
  const r = construirMayor([{ fecha: '2026-07-01', debito: 0.1, credito: 0 }, { fecha: '2026-07-02', debito: 0.2, credito: 0 }], 'debito');
  assert.equal(r.saldoFinal, 0.3);
});

test('construirComprobacion: cuadra cuando Σdébito = Σcrédito, omite cuentas sin movimiento', () => {
  const r = construirComprobacion([
    { codigo: '5105', nombre: 'Alimentación', clase: 5, naturaleza: 'debito', debito: 45000, credito: 0 },
    { codigo: '1110', nombre: 'Bancos', clase: 1, naturaleza: 'debito', debito: 0, credito: 45000 },
    { codigo: '4110', nombre: 'Salario', clase: 4, naturaleza: 'credito', debito: 0, credito: 0 },
  ]);
  assert.equal(r.cuadra, true);
  assert.equal(r.totalDebito, 45000);
  assert.equal(r.totalCredito, 45000);
  assert.equal(r.cuentas.length, 2); // la cuenta sin movimiento se omite
});

test('construirComprobacion: descuadre → cuadra false', () => {
  const r = construirComprobacion([
    { codigo: '5105', nombre: 'Alimentación', clase: 5, naturaleza: 'debito', debito: 45000, credito: 0 },
    { codigo: '1110', nombre: 'Bancos', clase: 1, naturaleza: 'debito', debito: 0, credito: 40000 },
  ]);
  assert.equal(r.cuadra, false);
});

test('construirComprobacion: saldo respeta la naturaleza de cada cuenta', () => {
  const r = construirComprobacion([
    { codigo: '1110', nombre: 'Bancos', clase: 1, naturaleza: 'debito', debito: 100000, credito: 30000 },
    { codigo: '4110', nombre: 'Salario', clase: 4, naturaleza: 'credito', debito: 0, credito: 70000 },
  ]);
  const bancos = r.cuentas.find((c) => c.codigo === '1110');
  const salario = r.cuentas.find((c) => c.codigo === '4110');
  assert.equal(bancos.saldo, 70000); // débito - crédito
  assert.equal(salario.saldo, 70000); // crédito - débito
});

// ---------------------------------------------------------------------------
// mayorCuenta / balanceComprobacion con Postgres falseado.
// ---------------------------------------------------------------------------
function fakeDbFull() {
  const plan = [
    { codigo: '1110', nombre: 'Bancos y billeteras', clase: 1, naturaleza: 'debito', cuenta_padre: '11' },
    { codigo: '5105', nombre: 'Alimentación', clase: 5, naturaleza: 'debito', cuenta_padre: '5' },
    { codigo: '4110', nombre: 'Salario', clase: 4, naturaleza: 'credito', cuenta_padre: '4' },
    { codigo: '3105', nombre: 'Capital / saldo inicial', clase: 3, naturaleza: 'credito', cuenta_padre: '3' },
  ];
  const lineas = [
    { asiento_id: 1, fecha: '2026-07-01', descripcion: 'Apertura', debito: 500000, credito: 0, cuenta: '1110' },
    { asiento_id: 1, fecha: '2026-07-01', descripcion: 'Apertura', debito: 0, credito: 500000, cuenta: '3105' },
    { asiento_id: 2, fecha: '2026-07-05', descripcion: 'Mercado', debito: 45000, credito: 0, cuenta: '5105' },
    { asiento_id: 2, fecha: '2026-07-05', descripcion: 'Mercado', debito: 0, credito: 45000, cuenta: '1110' },
  ];
  return {
    async query(text, params = []) {
      const t = text.replace(/\s+/g, ' ').trim();
      if (t.startsWith('select codigo, nombre, clase, naturaleza, cuenta_padre from plan_cuentas where codigo')) {
        return plan.filter((p) => p.codigo === params[0]).slice(0, 1);
      }
      if (t.startsWith('select a.id as asiento_id, a.fecha, a.descripcion, l.debito, l.credito')) {
        return lineas.filter((l) => l.cuenta === params[0]).map(({ cuenta, ...l }) => l);
      }
      if (t.includes('group by p.codigo, p.nombre, p.clase, p.naturaleza')) {
        const totales = new Map();
        for (const l of lineas) {
          const cur = totales.get(l.cuenta) || { debito: 0, credito: 0 };
          cur.debito += l.debito; cur.credito += l.credito;
          totales.set(l.cuenta, cur);
        }
        return plan.map((p) => ({ ...p, ...(totales.get(p.codigo) || { debito: 0, credito: 0 }) }));
      }
      return [];
    },
  };
}

test('mayorCuenta: arma el mayor de una cuenta existente contra Postgres falseado', async () => {
  const db = fakeDbFull();
  const r = await mayorCuenta({ cuenta: '1110' }, db);
  assert.equal(r.cuenta.codigo, '1110');
  assert.equal(r.saldoFinal, 455000); // 500000 - 45000
  assert.equal(r.lineas.length, 2);
});

test('mayorCuenta: cuenta inexistente → lanza', async () => {
  const db = fakeDbFull();
  await assert.rejects(() => mayorCuenta({ cuenta: '9999' }, db), /no existe/);
});

test('mayorCuenta: sin cuenta → lanza', async () => {
  const db = fakeDbFull();
  await assert.rejects(() => mayorCuenta({}, db), /cuenta requerida/);
});

test('balanceComprobacion: agrega todas las cuentas y cuadra', async () => {
  const db = fakeDbFull();
  const r = await balanceComprobacion({}, db);
  assert.equal(r.cuadra, true);
  assert.equal(r.totalDebito, 545000);
  assert.equal(r.totalCredito, 545000);
  assert.equal(r.cuentas.length, 3);
});
