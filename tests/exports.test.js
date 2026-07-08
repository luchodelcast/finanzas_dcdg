import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  csvLibroDiario, csvLibroMayor, csvComprobacion, csvEstadoResultados, csvBalanceGeneral,
} from '../netlify/functions/_lib/exports.js';

test('csvLibroDiario: un renglón por línea, explota `lineas` de cada asiento', () => {
  const asientos = [
    { id: 1, fecha: '2026-07-01', descripcion: 'Apertura', entidad_id: null, origen: 'apertura', lineas: [
      { cuenta: '1110', debito: 100, credito: 0 },
      { cuenta: '3105', debito: 0, credito: 100 },
    ] },
  ];
  const out = csvLibroDiario(asientos);
  const filas = out.split('\r\n');
  assert.equal(filas.length, 3); // header + 2 líneas
  assert.equal(filas[0], 'fecha,asiento_id,descripcion,entidad_id,origen,cuenta,debito,credito');
  assert.equal(filas[1], '2026-07-01,1,Apertura,,apertura,1110,100,0');
  assert.equal(filas[2], '2026-07-01,1,Apertura,,apertura,3105,0,100');
});

test('csvLibroDiario: sin asientos → solo encabezado', () => {
  assert.equal(csvLibroDiario([]), 'fecha,asiento_id,descripcion,entidad_id,origen,cuenta,debito,credito');
});

test('csvLibroDiario: escapa comas y comillas en la descripción', () => {
  const asientos = [{ id: 1, fecha: '2026-07-01', descripcion: 'Pago, con "comillas"', lineas: [{ cuenta: '5105', debito: 10, credito: 0 }] }];
  const filas = csvLibroDiario(asientos).split('\r\n');
  assert.equal(filas[1], '2026-07-01,1,"Pago, con ""comillas""",,,5105,10,0');
});

test('csvLibroMayor: un renglón por línea con saldo corrido', () => {
  const cuenta = { codigo: '1110', nombre: 'Bancos y billeteras' };
  const lineas = [
    { asiento_id: 1, fecha: '2026-07-01', descripcion: 'Apertura', debito: 100, credito: 0, saldo: 100 },
    { asiento_id: 2, fecha: '2026-07-05', descripcion: 'Mercado', debito: 0, credito: 30, saldo: 70 },
  ];
  const filas = csvLibroMayor(cuenta, lineas).split('\r\n');
  assert.equal(filas.length, 3);
  assert.equal(filas[1], '1110,Bancos y billeteras,2026-07-01,1,Apertura,100,0,100');
  assert.equal(filas[2], '1110,Bancos y billeteras,2026-07-05,2,Mercado,0,30,70');
});

test('csvComprobacion: una fila por cuenta', () => {
  const cuentas = [{ codigo: '1110', nombre: 'Bancos', clase: 1, naturaleza: 'debito', debito: 100, credito: 30, saldo: 70 }];
  const filas = csvComprobacion(cuentas).split('\r\n');
  assert.equal(filas[0], 'codigo,nombre,clase,naturaleza,debito,credito,saldo');
  assert.equal(filas[1], '1110,Bancos,1,debito,100,30,70');
});

test('csvEstadoResultados: filas por grupo + totales', () => {
  const estado = {
    ingresos: [{ codigo: '4110', nombre: 'Salario', debito: 0, credito: 5000, saldo: 5000 }],
    gastos: [{ codigo: '5105', nombre: 'Alimentación', debito: 1000, credito: 0, saldo: 1000 }],
    costos: [],
    totalIngresos: 5000, totalGastos: 1000, totalCostos: 0, resultado: 4000,
  };
  const filas = csvEstadoResultados(estado).split('\r\n');
  assert.equal(filas[0], 'grupo,codigo,nombre,debito,credito,saldo');
  assert.equal(filas[1], 'ingresos,4110,Salario,0,5000,5000');
  assert.equal(filas[2], 'gastos,5105,Alimentación,1000,0,1000');
  assert.ok(filas.includes('total,,Resultado del periodo,,,4000'));
  assert.ok(filas.includes('total,,Total ingresos,,,5000'));
});

test('csvBalanceGeneral: filas por grupo + totales + cuadre', () => {
  const balance = {
    activo: [{ codigo: '1110', nombre: 'Bancos', debito: 100, credito: 0, saldo: 100 }],
    pasivo: [], patrimonio: [{ codigo: '3105', nombre: 'Capital', debito: 0, credito: 100, saldo: 100 }],
    totalActivo: 100, totalPasivo: 0, totalPatrimonio: 100, resultadoEjercicio: 0, cuadra: true,
  };
  const filas = csvBalanceGeneral(balance).split('\r\n');
  assert.equal(filas[1], 'activo,1110,Bancos,100,0,100');
  assert.equal(filas[2], 'patrimonio,3105,Capital,0,100,100');
  assert.ok(filas.includes('total,,Cuadra (Activo = Pasivo + Patrimonio),,,true'));
});
