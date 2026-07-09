import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mesAnterior, estadoPago, armarPagosDelMes, resumenPagos, estaVigenteEnMes, ultimosMeses, historialPagos } from '../netlify/functions/_lib/pagos.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import {
  ensurePagosFijosSchema, resetPagosFijosSchemaParaTests, listPagosFijos,
  queryPagosEstadoMes, insertPagoFijo, updatePagoFijo, upsertPagoEstado, desmarcarPagoEstado,
  autovincularPagoFijo,
} from '../netlify/functions/_lib/repo.js';

// ---------------------------------------------------------------------------
// autovincularPagoFijo — casa un movimiento con su pago fijo y lo marca pagado.
// ---------------------------------------------------------------------------
function fakeSqlPagoFijo({ pf, estadoExistente = [] }) {
  const calls = [];
  const db = {
    query: async (text, params = []) => {
      const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
      calls.push({ t: t.slice(0, 40), params });
      if (t.startsWith('create table') || t.startsWith('create unique index') || t.startsWith('alter table')) return [];
      if (t.startsWith('insert into pagos_fijos')) return [];
      if (t.startsWith('select * from pagos_fijos')) return pf ? [pf] : [];
      if (t.startsWith('select 1 from pagos_estado')) return estadoExistente;
      if (t.startsWith('insert into pagos_estado')) return [{ id: 1, pago_fijo_id: params[0], anio: params[1], mes: params[2], estado: 'pagado', monto_pagado: params[5], movimiento_id: params[6] }];
      return [];
    },
  };
  return { db, calls };
}

test('autovincularPagoFijo: casa por categoria/subcategoria y marca pagado con el monto real', async () => {
  resetPagosFijosSchemaParaTests();
  const pf = { id: 7, concepto: 'Acueducto Apto', categoria: 'Servicios Públicos', subcategoria: 'Agua', dia_vencimiento: 16, activo: true };
  const { db } = fakeSqlPagoFijo({ pf });
  setSqlForTests(db);
  const r = await autovincularPagoFijo({ movimiento_id: 99, categoria: 'Servicios Públicos', subcategoria: 'Agua', fecha: '2026-07-09', monto: 1459896, moneda: 'COP' });
  assert.equal(r.concepto, 'Acueducto Apto');
  setSqlForTests(null);
  resetPagosFijosSchemaParaTests();
});

test('autovincularPagoFijo: no toca un pago fijo que ya tiene estado ese mes', async () => {
  resetPagosFijosSchemaParaTests();
  const pf = { id: 7, concepto: 'Acueducto Apto', categoria: 'Servicios Públicos', subcategoria: 'Agua', activo: true };
  const { db, calls } = fakeSqlPagoFijo({ pf, estadoExistente: [{ x: 1 }] });
  setSqlForTests(db);
  const r = await autovincularPagoFijo({ movimiento_id: 99, categoria: 'Servicios Públicos', subcategoria: 'Agua', fecha: '2026-07-09', monto: 1459896, moneda: 'COP' });
  assert.equal(r, null);
  assert.ok(!calls.some((c) => c.t.startsWith('insert into pagos_estado')));
  setSqlForTests(null);
  resetPagosFijosSchemaParaTests();
});

test('autovincularPagoFijo: no-op si el movimiento es USD o sin categoria', async () => {
  resetPagosFijosSchemaParaTests();
  const { db } = fakeSqlPagoFijo({ pf: null });
  setSqlForTests(db);
  assert.equal(await autovincularPagoFijo({ categoria: 'Servicios Públicos', fecha: '2026-07-09', monto: 100, moneda: 'USD' }), null);
  assert.equal(await autovincularPagoFijo({ categoria: '', fecha: '2026-07-09', monto: 100, moneda: 'COP' }), null);
  setSqlForTests(null);
  resetPagosFijosSchemaParaTests();
});

// ---------------------------------------------------------------------------
// mesAnterior — pura.
// ---------------------------------------------------------------------------
test('mesAnterior: rollover de enero al diciembre del año previo', () => {
  assert.deepEqual(mesAnterior(2026, 1), { anio: 2025, mes: 12 });
  assert.deepEqual(mesAnterior(2026, 7), { anio: 2026, mes: 6 });
});

// ---------------------------------------------------------------------------
// estadoPago — pura.
// ---------------------------------------------------------------------------
test('estadoPago: pagado si hay fila de estado con estado=pagado', () => {
  const p = { dia_vencimiento: 5 };
  assert.equal(estadoPago(p, { estado: 'pagado' }, 2026, 7, '2026-07-01'), 'pagado');
});

test('estadoPago: mes ya cerrado y sin pagar → vencido', () => {
  const p = { dia_vencimiento: 5 };
  assert.equal(estadoPago(p, null, 2026, 6, '2026-07-08'), 'vencido');
});

test('estadoPago: mes futuro y sin pagar → pendiente', () => {
  const p = { dia_vencimiento: 5 };
  assert.equal(estadoPago(p, null, 2026, 8, '2026-07-08'), 'pendiente');
});

test('estadoPago: mismo mes, antes del día de vencimiento → pendiente', () => {
  const p = { dia_vencimiento: 20 };
  assert.equal(estadoPago(p, null, 2026, 7, '2026-07-08'), 'pendiente');
});

test('estadoPago: mismo mes, después del día de vencimiento → vencido', () => {
  const p = { dia_vencimiento: 5 };
  assert.equal(estadoPago(p, null, 2026, 7, '2026-07-08'), 'vencido');
});

// ---------------------------------------------------------------------------
// estaVigenteEnMes — pura. Evita que un pago fijo agregado hoy aparezca como
// "vencido" en un mes anterior a su creación (regresión encontrada en code review).
// ---------------------------------------------------------------------------
test('estaVigenteEnMes: un pago fijo creado este mes NO existía en meses anteriores', () => {
  const nuevo = { creado_en: '2026-07-08T10:00:00Z' };
  assert.equal(estaVigenteEnMes(nuevo, 2026, 6), false); // junio: aún no existía
  assert.equal(estaVigenteEnMes(nuevo, 2026, 7), true); // julio: sí existe
});

test('estaVigenteEnMes: sin creado_en (dato viejo/sembrado) no se excluye', () => {
  assert.equal(estaVigenteEnMes({ creado_en: null }, 2020, 1), true);
});

// ---------------------------------------------------------------------------
// armarPagosDelMes / resumenPagos — puras.
// ---------------------------------------------------------------------------
test('armarPagosDelMes: une catálogo + estado y calcula el estado visual de cada uno', () => {
  const pagosFijos = [
    { id: 1, concepto: 'Arriendo', monto: 2000000, dia_vencimiento: 5 },
    { id: 2, concepto: 'Internet', monto: 150000, dia_vencimiento: 20 },
  ];
  const estados = [{ pago_fijo_id: 1, anio: 2026, mes: 7, estado: 'pagado', fecha_pago: '2026-07-03', monto_pagado: 2000000 }];
  const pagos = armarPagosDelMes(pagosFijos, estados, 2026, 7, '2026-07-08');
  assert.equal(pagos[0].estado, 'pagado');
  assert.equal(pagos[0].fecha_pago, '2026-07-03');
  assert.equal(pagos[1].estado, 'pendiente'); // vence el 20, hoy es 8
});

test('resumenPagos: suma pagado vs. pendiente y cuenta vencidos', () => {
  const pagos = [
    { monto: 100, estado: 'pagado', monto_pagado: 100 },
    { monto: 200, estado: 'vencido' },
    { monto: 300, estado: 'pendiente' },
  ];
  const r = resumenPagos(pagos);
  assert.equal(r.total_presupuestado, 600);
  assert.equal(r.total_pagado, 100);
  assert.equal(r.total_pendiente, 500);
  assert.equal(r.n_pagados, 1);
  assert.equal(r.n_vencidos, 1);
  assert.equal(r.n_pendientes, 1);
});

// ---------------------------------------------------------------------------
// Capa de datos — Postgres falseado. Verifica el DDL idempotente en runtime
// (modo auto-ok: nada de migraciones manuales) y las operaciones de escritura.
// ---------------------------------------------------------------------------
function fakeDb() {
  const pagos_fijos = [];
  const pagos_estado = [];
  let nextFijoId = 1;
  let nextEstadoId = 1;
  const ddlCalls = [];

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase();

    if (t.startsWith('create table') || t.startsWith('create unique index')) {
      ddlCalls.push(t);
      return [];
    }
    if (t.startsWith('insert into pagos_fijos') && t.includes('on conflict (concepto, familia) do nothing')) {
      const [concepto, dia_vencimiento, familia, categoria] = params;
      if (pagos_fijos.some((p) => p.concepto === concepto && p.familia === familia)) return [];
      pagos_fijos.push({ id: nextFijoId++, concepto, monto: 0, dia_vencimiento, familia, categoria, moneda: 'COP', activo: true });
      return [];
    }
    if (t.startsWith('insert into pagos_fijos')) {
      const [concepto, monto, dia_vencimiento, familia, categoria, moneda] = params;
      const row = { id: nextFijoId++, concepto, monto, dia_vencimiento, familia, categoria, moneda, activo: true };
      pagos_fijos.push(row);
      return [row];
    }
    if (t.startsWith('select * from pagos_fijos where activo')) {
      const [activo] = params;
      return pagos_fijos.filter((p) => p.activo === activo);
    }
    if (t.startsWith('select * from pagos_fijos order')) {
      return pagos_fijos;
    }
    if (t.startsWith('update pagos_fijos set')) {
      const [id, concepto, monto, dia_vencimiento, categoria, activo] = params;
      const row = pagos_fijos.find((p) => p.id === id);
      if (!row) return [];
      if (concepto != null) row.concepto = concepto;
      if (monto != null) row.monto = monto;
      if (dia_vencimiento != null) row.dia_vencimiento = dia_vencimiento;
      if (categoria != null) row.categoria = categoria;
      if (activo != null) row.activo = activo;
      return [row];
    }
    if (t.startsWith('select * from pagos_estado where anio')) {
      const [anio, mes] = params;
      return pagos_estado.filter((e) => e.anio === anio && e.mes === mes);
    }
    if (t.startsWith('insert into pagos_estado')) {
      const [pago_fijo_id, anio, mes, fecha_pago, monto_pagado, movimiento_id] = params;
      let row = pagos_estado.find((e) => e.pago_fijo_id === pago_fijo_id && e.anio === anio && e.mes === mes);
      if (row) { row.estado = 'pagado'; row.fecha_pago = fecha_pago; row.monto_pagado = monto_pagado; row.movimiento_id = movimiento_id; }
      else { row = { id: nextEstadoId++, pago_fijo_id, anio, mes, estado: 'pagado', fecha_pago, monto_pagado, movimiento_id }; pagos_estado.push(row); }
      return [row];
    }
    if (t.startsWith('delete from pagos_estado')) {
      const [pago_fijo_id, anio, mes] = params;
      const i = pagos_estado.findIndex((e) => e.pago_fijo_id === pago_fijo_id && e.anio === anio && e.mes === mes);
      if (i >= 0) pagos_estado.splice(i, 1);
      return [];
    }
    return [];
  }

  return { query, _pagos_fijos: pagos_fijos, _pagos_estado: pagos_estado, _ddlCalls: ddlCalls };
}

test('ensurePagosFijosSchema: crea tablas + siembra el catálogo, memoizado (no repite el DDL)', async () => {
  resetPagosFijosSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  await ensurePagosFijosSchema();
  const ddlTrasPrimera = db._ddlCalls.length;
  assert.ok(ddlTrasPrimera > 0);
  assert.ok(db._pagos_fijos.length > 0, 'sembró el catálogo conocido');

  await ensurePagosFijosSchema(); // segunda llamada: no debe repetir el DDL
  assert.equal(db._ddlCalls.length, ddlTrasPrimera);

  setSqlForTests(null);
  resetPagosFijosSchemaParaTests();
});

test('ensurePagosFijosSchema: llamadas concurrentes (Promise.all) corren el DDL una sola vez', async () => {
  resetPagosFijosSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  // Mismo patrón que el handler: varias funciones que dependen del esquema se
  // llaman en paralelo (Promise.all). Con memoización por booleano, las 3
  // llamadas ven el flag en `false` antes de que la primera termine y corren
  // el DDL/seed 3 veces (regresión encontrada en code review); con
  // memoización por PROMESA, las 3 esperan la misma corrida.
  await Promise.all([ensurePagosFijosSchema(), ensurePagosFijosSchema(), ensurePagosFijosSchema()]);
  assert.equal(db._ddlCalls.length, 3); // create table x2 + create index x1, una sola vez

  setSqlForTests(null);
  resetPagosFijosSchemaParaTests();
});

test('ultimosMeses: N meses hacia atrás con rollover de año', () => {
  assert.deepEqual(ultimosMeses(2026, 2, 4), [
    { anio: 2026, mes: 2 }, { anio: 2026, mes: 1 }, { anio: 2025, mes: 12 }, { anio: 2025, mes: 11 },
  ]);
});

test('historialPagos: resumen por mes + acumulado por quién asume', () => {
  const pagosFijos = [
    { id: 1, concepto: 'Agua', monto: 100, asumido_por: 'LADCC', activo: true, dia_vencimiento: 10, creado_en: '2026-01-01' },
    { id: 2, concepto: 'Gas', monto: 50, asumido_por: 'CMDG', activo: true, dia_vencimiento: 10, creado_en: '2026-01-01' },
  ];
  const estados = [
    { pago_fijo_id: 1, anio: 2026, mes: 6, estado: 'pagado', monto_pagado: 120 },
    { pago_fijo_id: 2, anio: 2026, mes: 7, estado: 'pagado', monto_pagado: 55 },
  ];
  const meses = ultimosMeses(2026, 7, 2); // [jul, jun]
  const h = historialPagos(pagosFijos, estados, meses, '2026-07-31');
  assert.equal(h.por_mes.find((m) => m.mes === 7).total_pagado, 55);
  assert.equal(h.por_mes.find((m) => m.mes === 6).total_pagado, 120);
  assert.equal(h.acumulado.por_asumido.LADCC, 120);
  assert.equal(h.acumulado.por_asumido.CMDG, 55);
  assert.equal(h.acumulado.total_pagado, 175);
});

// Fake enfocado en la siembra canónica (#136): modela el centinela, el retiro
// de placeholders y el upsert de los 22.
function fakeSeedDb(preexisting = []) {
  const rows = preexisting.map((r, i) => ({ id: i + 1, activo: true, monto: 0, familia: 'DCDG', ...r }));
  let nextId = rows.length + 1;
  const query = async (text, params = []) => {
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (t.startsWith('create table') || t.startsWith('create unique index') || t.startsWith('alter table')) return [];
    if (t.startsWith("select 1 from pagos_fijos where concepto = 'acueducto apto'")) {
      return rows.some((r) => r.concepto === 'Acueducto Apto') ? [{ x: 1 }] : [];
    }
    if (t.startsWith('update pagos_fijos set activo = false where monto = 0 and concepto = any')) {
      for (const r of rows) if (Number(r.monto) === 0 && params[0].includes(r.concepto)) r.activo = false;
      return [];
    }
    if (t.startsWith('insert into pagos_fijos') && t.includes('on conflict (concepto, familia) do update')) {
      const [concepto, monto, dia, familia, categoria, subcategoria, asumido] = params;
      const r = rows.find((x) => x.concepto === concepto && x.familia === familia);
      if (r) Object.assign(r, { monto, dia_vencimiento: dia, categoria, subcategoria, asumido_por: asumido, activo: true });
      else rows.push({ id: nextId++, concepto, monto, dia_vencimiento: dia, familia, categoria, subcategoria, asumido_por: asumido, activo: true });
      return [];
    }
    return [];
  };
  return { query, rows };
}

test('siembra canónica: carga los 22 con subcategoría, retira placeholders y no re-siembra', async () => {
  resetPagosFijosSchemaParaTests();
  const db = fakeSeedDb([
    { concepto: 'Agua', familia: 'DCDG', monto: 0 },        // placeholder → se retira
    { concepto: 'Internet Apto', familia: 'DCDG', monto: 0 }, // canónico → se actualiza en su lugar
  ]);
  setSqlForTests(db);

  await ensurePagosFijosSchema();
  const acueducto = db.rows.find((r) => r.concepto === 'Acueducto Apto');
  assert.equal(acueducto.subcategoria, 'Agua');
  assert.equal(Number(acueducto.monto), 679297);
  assert.equal(db.rows.find((r) => r.concepto === 'Agua').activo, false); // placeholder retirado
  const internet = db.rows.filter((r) => r.concepto === 'Internet Apto');
  assert.equal(internet.length, 1);                    // no se duplica
  assert.equal(internet[0].activo, true);
  assert.equal(Number(internet[0].monto), 104000);     // actualizado con el monto real

  // Centinela presente → re-aplicar no vuelve a sembrar (respeta ediciones).
  resetPagosFijosSchemaParaTests();
  const antes = db.rows.length;
  await ensurePagosFijosSchema();
  assert.equal(db.rows.length, antes);

  setSqlForTests(null);
  resetPagosFijosSchemaParaTests();
});

test('listPagosFijos / insertPagoFijo / updatePagoFijo: catálogo editable', async () => {
  resetPagosFijosSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  const activos = await listPagosFijos({ activo: true });
  assert.ok(activos.length > 0);

  const nuevo = await insertPagoFijo({ concepto: 'Netflix', monto: 45000, dia_vencimiento: 22, familia: 'DCDG', categoria: 'Entretenimiento' });
  assert.equal(nuevo.concepto, 'Netflix');

  const editado = await updatePagoFijo(nuevo.id, { monto: 50000 });
  assert.equal(editado.monto, 50000);

  const desactivado = await updatePagoFijo(nuevo.id, { activo: false });
  assert.equal(desactivado.activo, false);

  setSqlForTests(null);
  resetPagosFijosSchemaParaTests();
});

test('upsertPagoEstado / desmarcarPagoEstado: marcar y desmarcar un pago del mes', async () => {
  resetPagosFijosSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  const [arriendo] = await listPagosFijos({ activo: true });

  const marcado = await upsertPagoEstado({ pago_fijo_id: arriendo.id, anio: 2026, mes: 7, fecha_pago: '2026-07-05', monto_pagado: 2000000 });
  assert.equal(marcado.estado, 'pagado');

  const estados = await queryPagosEstadoMes({ anio: 2026, mes: 7 });
  assert.equal(estados.length, 1);
  assert.equal(estados[0].pago_fijo_id, arriendo.id);

  // Re-marcar (mismo mes) actualiza en vez de duplicar.
  await upsertPagoEstado({ pago_fijo_id: arriendo.id, anio: 2026, mes: 7, fecha_pago: '2026-07-06', monto_pagado: 2000000 });
  assert.equal((await queryPagosEstadoMes({ anio: 2026, mes: 7 })).length, 1);

  await desmarcarPagoEstado({ pago_fijo_id: arriendo.id, anio: 2026, mes: 7 });
  assert.equal((await queryPagosEstadoMes({ anio: 2026, mes: 7 })).length, 0);

  setSqlForTests(null);
  resetPagosFijosSchemaParaTests();
});
