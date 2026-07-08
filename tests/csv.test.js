import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  csvLibroDiario, csvLibroMayor, csvComprobacion, csvEstadoResultados, csvBalanceGeneral,
} from '../netlify/functions/_lib/csv.js';

test('csvLibroDiario: un renglón por línea de asiento', () => {
  const asientos = [
    {
      id: 1, fecha: '2026-07-01', descripcion: 'Apertura',
      lineas: [
        { cuenta: '1110', debito: 500000, credito: 0 },
        { cuenta: '3105', debito: 0, credito: 500000 },
      ],
    },
  ];
  const csv = csvLibroDiario(asientos);
  const lineas = csv.trim().split('\r\n');
  assert.equal(lineas[0], 'asiento_id,fecha,descripcion,cuenta,debito,credito');
  assert.equal(lineas.length, 3); // header + 2 renglones
  assert.equal(lineas[1], '1,2026-07-01,Apertura,1110,500000,0');
});

test('csvLibroDiario: sin asientos → solo el encabezado', () => {
  const csv = csvLibroDiario([]);
  assert.equal(csv.trim(), 'asiento_id,fecha,descripcion,cuenta,debito,credito');
});

test('csvLibroDiario: escapa comas y comillas en la descripción', () => {
  const asientos = [{ id: 2, fecha: '2026-07-02', descripcion: 'Mercado, "D1"', lineas: [{ cuenta: '5105', debito: 45000, credito: 0 }] }];
  const csv = csvLibroDiario(asientos);
  assert.match(csv, /"Mercado, ""D1"""/);
});

test('csvLibroMayor: incluye el saldo corrido de cada renglón', () => {
  const cuenta = { codigo: '1110', nombre: 'Bancos' };
  const lineas = [
    { fecha: '2026-07-01', asiento_id: 1, descripcion: 'Apertura', debito: 500000, credito: 0, saldo: 500000 },
    { fecha: '2026-07-05', asiento_id: 2, descripcion: 'Mercado', debito: 0, credito: 45000, saldo: 455000 },
  ];
  const csv = csvLibroMayor(cuenta, lineas);
  const filas = csv.trim().split('\r\n');
  assert.equal(filas.length, 3);
  assert.equal(filas[2], '1110,Bancos,2026-07-05,2,Mercado,0,45000,455000');
});

test('csvComprobacion: agrega una fila de totales al final', () => {
  const r = {
    cuentas: [{ codigo: '1110', nombre: 'Bancos', clase: 1, naturaleza: 'debito', debito: 500000, credito: 45000, saldo: 455000 }],
    totalDebito: 500000,
    totalCredito: 500000,
  };
  const csv = csvComprobacion(r);
  const filas = csv.trim().split('\r\n');
  assert.equal(filas.length, 3); // header + 1 cuenta + total
  assert.equal(filas[2], ',TOTAL,,,500000,500000,');
});

test('csvEstadoResultados: agrupa por ingresos/gastos/costos y agrega totales', () => {
  const r = {
    ingresos: [{ codigo: '4110', nombre: 'Salario', saldo: 3000000 }],
    gastos: [{ codigo: '5105', nombre: 'Alimentación', saldo: 500000 }],
    costos: [],
    totalIngresos: 3000000, totalGastos: 500000, totalCostos: 0, resultado: 2500000,
  };
  const csv = csvEstadoResultados(r);
  const filas = csv.trim().split('\r\n');
  assert.equal(filas[0], 'grupo,codigo,nombre,saldo');
  assert.equal(filas[1], 'Ingresos,4110,Salario,3000000');
  assert.equal(filas[2], 'Gastos,5105,Alimentación,500000');
  assert.ok(filas.includes(',,Resultado del periodo,2500000'));
});

test('csvBalanceGeneral: agrupa por activo/pasivo/patrimonio y agrega el cuadre', () => {
  const r = {
    activo: [{ codigo: '1110', nombre: 'Bancos', saldo: 455000 }],
    pasivo: [],
    patrimonio: [{ codigo: '3105', nombre: 'Capital', saldo: 500000 }],
    resultadoEjercicio: -45000,
    totalActivo: 455000, totalPasivo: 0, totalPatrimonio: 455000,
  };
  const csv = csvBalanceGeneral(r);
  const filas = csv.trim().split('\r\n');
  assert.ok(filas.includes('Activo,1110,Bancos,455000'));
  assert.ok(filas.includes('Patrimonio,3105,Capital,500000'));
  assert.ok(filas.includes(',,Resultado del ejercicio,-45000'));
  assert.ok(filas.includes(',,Total patrimonio (con resultado),455000'));
});
