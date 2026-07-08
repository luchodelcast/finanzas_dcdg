import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  construirEstadoResultados, estadoResultados,
  construirBalanceGeneral, balanceGeneral,
} from '../netlify/functions/_lib/estados.js';

test('construirEstadoResultados: ingresos - gastos - costos = resultado', () => {
  const r = construirEstadoResultados([
    { codigo: '4110', nombre: 'Salario', clase: 4, saldo: 3000000 },
    { codigo: '5105', nombre: 'Alimentación', clase: 5, saldo: 800000 },
    { codigo: '6105', nombre: 'Costo de venta', clase: 6, saldo: 200000 },
    { codigo: '1110', nombre: 'Bancos', clase: 1, saldo: 2000000 },
  ]);
  assert.equal(r.totalIngresos, 3000000);
  assert.equal(r.totalGastos, 800000);
  assert.equal(r.totalCostos, 200000);
  assert.equal(r.resultado, 2000000);
  assert.equal(r.ingresos.length, 1);
  assert.equal(r.gastos.length, 1);
  assert.equal(r.costos.length, 1);
});

test('construirEstadoResultados: sin cuentas de resultado → todo en 0', () => {
  const r = construirEstadoResultados([{ codigo: '1110', nombre: 'Bancos', clase: 1, saldo: 500000 }]);
  assert.equal(r.totalIngresos, 0);
  assert.equal(r.totalGastos, 0);
  assert.equal(r.totalCostos, 0);
  assert.equal(r.resultado, 0);
});

test('construirEstadoResultados: gastos/costos mayores a ingresos → resultado negativo', () => {
  const r = construirEstadoResultados([
    { codigo: '4110', nombre: 'Salario', clase: 4, saldo: 100000 },
    { codigo: '5105', nombre: 'Alimentación', clase: 5, saldo: 150000 },
  ]);
  assert.equal(r.resultado, -50000);
});

test('construirEstadoResultados: tolera decimales sin ruido de punto flotante', () => {
  const r = construirEstadoResultados([
    { codigo: '4110', nombre: 'Salario', clase: 4, saldo: 0.3 },
    { codigo: '5105', nombre: 'Gasto', clase: 5, saldo: 0.1 },
  ]);
  assert.equal(r.resultado, 0.2);
});

test('construirBalanceGeneral: Activo = Pasivo + Patrimonio (sin resultado del periodo)', () => {
  const r = construirBalanceGeneral([
    { codigo: '1110', nombre: 'Bancos', clase: 1, saldo: 500000 },
    { codigo: '3105', nombre: 'Capital', clase: 3, saldo: 500000 },
  ]);
  assert.equal(r.totalActivo, 500000);
  assert.equal(r.totalPatrimonio, 500000);
  assert.equal(r.cuadra, true);
});

test('construirBalanceGeneral: sin sumar el resultado del periodo, no cuadra si hubo movimiento', () => {
  const r = construirBalanceGeneral([
    { codigo: '1110', nombre: 'Bancos', clase: 1, saldo: 2500000 }, // 500000 apertura + 3000000 salario - 800000 gasto - 200000 costo
    { codigo: '3105', nombre: 'Capital', clase: 3, saldo: 500000 },
  ], 0);
  assert.equal(r.cuadra, false);
});

test('construirBalanceGeneral: sumando el resultado del periodo a patrimonio, cuadra', () => {
  const r = construirBalanceGeneral([
    { codigo: '1110', nombre: 'Bancos', clase: 1, saldo: 2500000 },
    { codigo: '3105', nombre: 'Capital', clase: 3, saldo: 500000 },
  ], 2000000); // resultado: 3000000 ingreso - 800000 gasto - 200000 costo
  assert.equal(r.totalActivo, 2500000);
  assert.equal(r.totalPatrimonio, 2500000);
  assert.equal(r.resultadoEjercicio, 2000000);
  assert.equal(r.cuadra, true);
});

test('construirBalanceGeneral: pasivo se incluye en el cuadre', () => {
  const r = construirBalanceGeneral([
    { codigo: '1110', nombre: 'Bancos', clase: 1, saldo: 300000 },
    { codigo: '2105', nombre: 'Tarjeta de crédito', clase: 2, saldo: 100000 },
    { codigo: '3105', nombre: 'Capital', clase: 3, saldo: 200000 },
  ]);
  assert.equal(r.totalPasivo, 100000);
  assert.equal(r.cuadra, true);
});

// ---------------------------------------------------------------------------
// estadoResultados / balanceGeneral con Postgres falseado (vía balanceComprobacion).
// ---------------------------------------------------------------------------
function fakeDbFull() {
  const plan = [
    { codigo: '1110', nombre: 'Bancos y billeteras', clase: 1, naturaleza: 'debito', cuenta_padre: '11' },
    { codigo: '5105', nombre: 'Alimentación', clase: 5, naturaleza: 'debito', cuenta_padre: '5' },
    { codigo: '4110', nombre: 'Salario', clase: 4, naturaleza: 'credito', cuenta_padre: '4' },
    { codigo: '3105', nombre: 'Capital / saldo inicial', clase: 3, naturaleza: 'credito', cuenta_padre: '3' },
  ];
  // Apertura: 500000 a Bancos / Capital. Ingreso: 200000 salario. Gasto: 45000 alimentación.
  const lineas = [
    { fecha: '2026-07-01', cuenta: '1110', debito: 500000, credito: 0 },
    { fecha: '2026-07-01', cuenta: '3105', debito: 0, credito: 500000 },
    { fecha: '2026-07-03', cuenta: '1110', debito: 200000, credito: 0 },
    { fecha: '2026-07-03', cuenta: '4110', debito: 0, credito: 200000 },
    { fecha: '2026-07-05', cuenta: '5105', debito: 45000, credito: 0 },
    { fecha: '2026-07-05', cuenta: '1110', debito: 0, credito: 45000 },
  ];
  return {
    async query(text, params = []) {
      const t = text.replace(/\s+/g, ' ').trim();
      if (t.includes('group by p.codigo, p.nombre, p.clase, p.naturaleza')) {
        let filas = lineas;
        const desdeIdx = t.indexOf('a.fecha >= $');
        const hastaIdx = t.indexOf('a.fecha <= $');
        // Aplica los mismos filtros desde/hasta que queryComprobacion (por orden de params).
        let pi = 0;
        if (desdeIdx !== -1) { const desde = params[pi++]; filas = filas.filter((l) => l.fecha >= desde); }
        if (hastaIdx !== -1) { const hasta = params[pi++]; filas = filas.filter((l) => l.fecha <= hasta); }
        const totales = new Map();
        for (const l of filas) {
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

test('estadoResultados: agrega ingresos/gastos del periodo contra Postgres falseado', async () => {
  const db = fakeDbFull();
  const r = await estadoResultados({}, db);
  assert.equal(r.totalIngresos, 200000);
  assert.equal(r.totalGastos, 45000);
  assert.equal(r.resultado, 155000);
});

test('balanceGeneral: cuadra sumando el resultado corrido a patrimonio', async () => {
  const db = fakeDbFull();
  const r = await balanceGeneral({ fecha: '2026-07-31' }, db);
  assert.equal(r.totalActivo, 655000); // 500000 + 200000 - 45000
  assert.equal(r.resultadoEjercicio, 155000);
  assert.equal(r.totalPatrimonio, 655000); // 500000 capital + 155000 resultado
  assert.equal(r.cuadra, true);
});

test('balanceGeneral: a una fecha anterior al ingreso/gasto, solo ve la apertura', async () => {
  const db = fakeDbFull();
  const r = await balanceGeneral({ fecha: '2026-07-01' }, db);
  assert.equal(r.totalActivo, 500000);
  assert.equal(r.resultadoEjercicio, 0);
  assert.equal(r.cuadra, true);
});
