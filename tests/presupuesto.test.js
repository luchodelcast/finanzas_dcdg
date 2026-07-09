import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularVariacion, reportePresupuesto, guardarPresupuesto,
} from '../netlify/functions/_lib/presupuesto.js';

/**
 * Fake mínimo de Postgres: tabla `presupuestos` en memoria + las consultas de
 * agregado por categoría de `queryResumen` (mismo patrón que
 * `fakeResumenDb` en tests/finanzas-db.test.js), combinadas en un solo fake
 * porque `reportePresupuesto` consulta ambas.
 */
function fakeDb({ presupuestosSeed = [], movimientos = [] } = {}) {
  const presupuestos = presupuestosSeed.map((r, i) => ({ id: i + 1, ...r }));
  let seq = presupuestos.length;
  return {
    _presupuestos: presupuestos,
    async query(text, params = []) {
      const t = text.replace(/\s+/g, ' ').trim();
      if (t.startsWith('create table') || t.startsWith('create index')) return [];
      if (t.startsWith('select * from presupuestos where anio')) {
        const [anio, mes] = params;
        return presupuestos.filter((p) => p.anio === anio && p.mes === mes);
      }
      if (t.startsWith('insert into presupuestos')) {
        const [categoria, anio, mes, monto_ptto] = params;
        let row = presupuestos.find((p) => p.categoria === categoria && p.anio === anio && p.mes === mes);
        if (row) row.monto_ptto = monto_ptto;
        else { row = { id: ++seq, categoria, anio, mes, monto_ptto }; presupuestos.push(row); }
        return [row];
      }
      if (t.startsWith('select coalesce(sum(monto)')) {
        const total = movimientos.reduce((s, m) => s + m.monto, 0);
        return [{ total, n: movimientos.length }];
      }
      if (t.startsWith("select coalesce(categoria,'Sin categoría')")) {
        const porCat = {};
        for (const m of movimientos) porCat[m.categoria] = (porCat[m.categoria] || 0) + m.monto;
        return Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([categoria, monto]) => ({ categoria, monto }));
      }
      if (t.startsWith('select descripcion, sum(monto)')) return [];
      return [];
    },
  };
}

// ---- calcularVariacion (pura) ----

test('calcularVariacion: gasto por debajo del presupuesto → dentro, variación negativa', () => {
  const r = calcularVariacion(100000, 60000);
  assert.equal(r.variacion, -40000);
  assert.equal(r.variacion_pct, -40);
  assert.equal(r.dentro_presupuesto, true);
});

test('calcularVariacion: gasto por encima del presupuesto → fuera, variación positiva', () => {
  const r = calcularVariacion(100000, 150000);
  assert.equal(r.variacion, 50000);
  assert.equal(r.variacion_pct, 50);
  assert.equal(r.dentro_presupuesto, false);
});

test('calcularVariacion: gasto exactamente igual al presupuesto → dentro', () => {
  const r = calcularVariacion(100000, 100000);
  assert.equal(r.variacion, 0);
  assert.equal(r.dentro_presupuesto, true);
});

test('calcularVariacion: sin presupuesto fijado (ptto=0) → variacion_pct null', () => {
  const r = calcularVariacion(0, 30000);
  assert.equal(r.variacion_pct, null);
  assert.equal(r.dentro_presupuesto, false);
});

// ---- reportePresupuesto ----

test('reportePresupuesto: cruza PTTO fijado con ejecutado real por categoría', async () => {
  const db = fakeDb({
    presupuestosSeed: [
      { categoria: 'Alimentación', anio: 2026, mes: 7, monto_ptto: 500000 },
      { categoria: 'Transporte', anio: 2026, mes: 7, monto_ptto: 100000 },
    ],
    movimientos: [
      { categoria: 'Alimentación', monto: 300000 },
      { categoria: 'Transporte', monto: 150000 },
    ],
  });
  const r = await reportePresupuesto({ anio: 2026, mes: 7 }, db);
  assert.equal(r.anio, 2026);
  assert.equal(r.mes, 7);

  const alim = r.categorias.find((c) => c.categoria === 'Alimentación');
  assert.equal(alim.ptto, 500000);
  assert.equal(alim.ejecutado, 300000);
  assert.equal(alim.dentro_presupuesto, true);

  const transp = r.categorias.find((c) => c.categoria === 'Transporte');
  assert.equal(transp.ptto, 100000);
  assert.equal(transp.ejecutado, 150000);
  assert.equal(transp.dentro_presupuesto, false);

  assert.equal(r.total_ptto, 600000);
  assert.equal(r.total_ejecutado, 450000);
});

test('reportePresupuesto: categoría de la taxonomía sin gasto ni presupuesto queda en 0', async () => {
  const db = fakeDb({});
  const r = await reportePresupuesto({ anio: 2026, mes: 7 }, db);
  const salud = r.categorias.find((c) => c.categoria === 'Salud');
  assert.ok(salud, 'Salud debe aparecer aunque no tenga PTTO ni gasto');
  assert.equal(salud.ptto, 0);
  assert.equal(salud.ejecutado, 0);
});

test('reportePresupuesto: gasto en una categoría fuera de la taxonomía oficial no se pierde', async () => {
  const db = fakeDb({ movimientos: [{ categoria: 'Categoría vieja', monto: 20000 }] });
  const r = await reportePresupuesto({ anio: 2026, mes: 7 }, db);
  const vieja = r.categorias.find((c) => c.categoria === 'Categoría vieja');
  assert.ok(vieja, 'una categoría con gasto real no debe desaparecer del reporte');
  assert.equal(vieja.ejecutado, 20000);
});

test('reportePresupuesto: ordena por ejecutado descendente', async () => {
  const db = fakeDb({
    movimientos: [
      { categoria: 'Salud', monto: 10000 },
      { categoria: 'Alimentación', monto: 90000 },
      { categoria: 'Transporte', monto: 50000 },
    ],
  });
  const r = await reportePresupuesto({ anio: 2026, mes: 7 }, db);
  const conGasto = r.categorias.filter((c) => c.ejecutado > 0).map((c) => c.categoria);
  assert.deepEqual(conGasto, ['Alimentación', 'Transporte', 'Salud']);
});

test('reportePresupuesto: sin anio/mes explícito usa el mes en curso', async () => {
  const db = fakeDb({});
  const antes = new Date();
  const r = await reportePresupuesto({}, db);
  assert.equal(r.anio, antes.getFullYear());
  assert.equal(r.mes, antes.getMonth() + 1);
});

// ---- guardarPresupuesto ----

test('guardarPresupuesto: crea el presupuesto de una categoría', async () => {
  const db = fakeDb({});
  const r = await guardarPresupuesto({ categoria: 'Alimentación', anio: 2026, mes: 7, monto_ptto: 500000 }, db);
  assert.equal(r.ok, true);
  assert.equal(db._presupuestos.length, 1);
  assert.equal(db._presupuestos[0].monto_ptto, 500000);
});

test('guardarPresupuesto: re-guardar la misma categoría/mes actualiza (no duplica)', async () => {
  const db = fakeDb({ presupuestosSeed: [{ categoria: 'Alimentación', anio: 2026, mes: 7, monto_ptto: 500000 }] });
  await guardarPresupuesto({ categoria: 'Alimentación', anio: 2026, mes: 7, monto_ptto: 650000 }, db);
  assert.equal(db._presupuestos.length, 1);
  assert.equal(db._presupuestos[0].monto_ptto, 650000);
});

test('guardarPresupuesto: rechaza categoría vacía', async () => {
  const db = fakeDb({});
  await assert.rejects(() => guardarPresupuesto({ categoria: '', anio: 2026, mes: 7, monto_ptto: 1000 }, db), /categoría/);
});

test('guardarPresupuesto: rechaza mes fuera de rango', async () => {
  const db = fakeDb({});
  await assert.rejects(() => guardarPresupuesto({ categoria: 'Salud', anio: 2026, mes: 13, monto_ptto: 1000 }, db), /mes/);
});

test('guardarPresupuesto: rechaza monto negativo', async () => {
  const db = fakeDb({});
  await assert.rejects(() => guardarPresupuesto({ categoria: 'Salud', anio: 2026, mes: 7, monto_ptto: -1 }, db), /monto/);
});
