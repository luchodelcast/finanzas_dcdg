import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cierreDelMes, periodoAnteriorA, armarResumenTexto } from '../netlify/functions/_lib/cierre-mes.js';
import { notificarSilvia } from '../netlify/functions/_lib/silvia-notify.js';
import { resetAportesHogarSchemaParaTests } from '../netlify/functions/_lib/repo.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';

/**
 * Fake mínimo de Postgres que combina lo que ya usan `aportes-hogar.test.js`
 * y `patrimonio.test.js`: entidades (Luis=1, Carolina=2), ingresos/aportes al
 * fondo común por mes, y asientos (para el patrimonio por persona).
 *
 * Enero: apertura de Luis (1.000.000) y Carolina (500.000). Febrero: Luis
 * recibe un depósito extra de 300.000 (para que su patrimonio varíe vs. el
 * mes anterior; Carolina se queda igual).
 */
function fakeDb() {
  const entidades = [
    { id: 1, nombre: 'Luis', tipo: 'persona', pais: 'CO', moneda: 'COP' },
    { id: 2, nombre: 'Carolina', tipo: 'persona', pais: 'CO', moneda: 'COP' },
  ];
  const plan = [
    { codigo: '1110', nombre: 'Bancos y billeteras', clase: 1, naturaleza: 'debito' },
    { codigo: '3105', nombre: 'Capital / saldo inicial', clase: 3, naturaleza: 'credito' },
  ];
  const lineas = [
    { fecha: '2026-01-01', entidad_id: 1, cuenta: '1110', debito: 1000000, credito: 0 },
    { fecha: '2026-01-01', entidad_id: 1, cuenta: '3105', debito: 0, credito: 1000000 },
    { fecha: '2026-01-01', entidad_id: 2, cuenta: '1110', debito: 500000, credito: 0 },
    { fecha: '2026-01-01', entidad_id: 2, cuenta: '3105', debito: 0, credito: 500000 },
    { fecha: '2026-02-10', entidad_id: 1, cuenta: '1110', debito: 300000, credito: 0 },
    { fecha: '2026-02-10', entidad_id: 1, cuenta: '3105', debito: 0, credito: 300000 },
  ];
  const ingresos = [
    { entidad_id: 1, fecha: '2026-01-05', monto: 4000000 },
    { entidad_id: 2, fecha: '2026-01-05', monto: 2000000 },
    { entidad_id: 1, fecha: '2026-02-05', monto: 4200000 },
    { entidad_id: 2, fecha: '2026-02-05', monto: 2100000 },
  ];
  const aportesHogar = [];
  let nextAporteId = 1;

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim();
    const tl = t.toLowerCase();
    if (tl.startsWith('create table') || tl.startsWith('create index')) return [];
    if (t.startsWith('select id, nombre, tipo, pais, moneda from entidades')) return entidades;
    if (t.includes('from ingresos') && t.includes('group by entidad_id')) {
      const [desde, hasta] = params;
      const filas = ingresos.filter((r) => r.fecha >= desde && r.fecha <= hasta);
      const totales = new Map();
      for (const r of filas) totales.set(r.entidad_id, (totales.get(r.entidad_id) || 0) + r.monto);
      return [...totales.entries()].map(([entidad_id, total]) => ({ entidad_id, total }));
    }
    if (t.includes('from costos_actividad')) return [];
    if (tl.startsWith('insert into aportes_hogar')) {
      const [entidad_id, fecha, monto, moneda, metodo_pago, notas, origen, idempotency_key] = params;
      const row = { id: nextAporteId++, entidad_id, fecha, monto, moneda, metodo_pago, notas, origen, idempotency_key };
      aportesHogar.push(row);
      return [row];
    }
    if (tl.startsWith('select id, entidad_id, fecha, monto, moneda, metodo_pago, notas')) {
      let out = aportesHogar.slice();
      if (t.includes('fecha >=') && t.includes('fecha <=')) out = out.filter((r) => r.fecha >= params[0] && r.fecha <= params[1]);
      return out;
    }
    if (t.includes('group by p.codigo, p.nombre, p.clase, p.naturaleza')) {
      let filas = lineas;
      let pi = 0;
      if (t.includes('a.fecha >= $')) { const desde = params[pi++]; filas = filas.filter((l) => l.fecha >= desde); }
      if (t.includes('a.fecha <= $')) { const hasta = params[pi++]; filas = filas.filter((l) => l.fecha <= hasta); }
      if (t.includes('a.entidad_id is null')) { filas = filas.filter((l) => l.entidad_id == null); }
      else if (t.includes('a.entidad_id = $')) { const eid = params[pi++]; filas = filas.filter((l) => l.entidad_id === eid); }
      const totales = new Map();
      for (const l of filas) {
        const cur = totales.get(l.cuenta) || { debito: 0, credito: 0 };
        cur.debito += l.debito; cur.credito += l.credito;
        totales.set(l.cuenta, cur);
      }
      return plan.map((p) => ({ ...p, ...(totales.get(p.codigo) || { debito: 0, credito: 0 }) }));
    }
    return [];
  }
  return { query, aportesHogar, seedAporte: (a) => aportesHogar.push({ id: nextAporteId++, ...a }) };
}

function reset() {
  resetAportesHogarSchemaParaTests();
  setSqlForTests(null);
}

test('periodoAnteriorA: mes anterior, con cruce de año', () => {
  assert.equal(periodoAnteriorA('2026-02-15'), '2026-01');
  assert.equal(periodoAnteriorA('2026-01'), '2025-12');
});

test('cierreDelMes: consolida aportes/ingresos, patrimonio y variación vs. el mes anterior', async () => {
  reset();
  const db = fakeDb();
  setSqlForTests(db);
  db.seedAporte({ entidad_id: 1, fecha: '2026-02-05', monto: 300000, moneda: 'COP', metodo_pago: 'Efectivo', notas: null, origen: 'App', idempotency_key: 'k1' });
  db.seedAporte({ entidad_id: 1, fecha: '2026-01-05', monto: 200000, moneda: 'COP', metodo_pago: 'Efectivo', notas: null, origen: 'App', idempotency_key: 'k0' });

  const r = await cierreDelMes({ periodo: '2026-02', hoy: new Date('2026-02-15') });

  assert.equal(r.ok, true);
  assert.equal(r.periodo, '2026-02');
  assert.equal(r.periodo_anterior, '2026-01');

  const luis = r.por_persona.find((p) => p.entidad === 'Luis');
  assert.equal(luis.ingreso, 4200000);
  assert.equal(luis.ingreso_anterior, 4000000);
  assert.equal(luis.aportado, 300000);
  assert.equal(luis.aportado_anterior, 200000);
  assert.equal(luis.patrimonio_neto, 1300000);
  assert.equal(luis.patrimonio_neto_anterior, 1000000);
  assert.equal(luis.variacion_patrimonio, 300000);

  const caro = r.por_persona.find((p) => p.entidad === 'Carolina');
  assert.equal(caro.patrimonio_neto, 500000);
  assert.equal(caro.variacion_patrimonio, 0);

  assert.equal(r.comun.neto, 0);
  assert.equal(r.consolidado.neto, 1800000);
  assert.equal(r.metas, null); // #117 aún no fusionado — se omite con gracia
  assert.match(r.nota, /metas/);

  reset();
});

test('cierreDelMes: sin datos, no rompe (todo en cero, sin lanzar)', async () => {
  reset();
  const db = fakeDb();
  setSqlForTests(db);

  const r = await cierreDelMes({ periodo: '2026-05', hoy: new Date('2026-05-10') });
  assert.equal(r.ok, true);
  assert.ok(r.por_persona.every((p) => p.aportado === 0 && p.ingreso === 0));

  reset();
});

test('armarResumenTexto: arma un texto corto con el resumen por persona', async () => {
  reset();
  const db = fakeDb();
  setSqlForTests(db);
  const r = await cierreDelMes({ periodo: '2026-02', hoy: new Date('2026-02-15') });
  const texto = armarResumenTexto(r);
  assert.match(texto, /Cierre del mes \(2026-02\)/);
  assert.match(texto, /Luis:/);
  assert.match(texto, /Carolina:/);
  reset();
});

test('notificarSilvia: sin AUTOBUILD_NOTIFY_URL/SECRET configurados, degrada con gracia', async () => {
  const prevUrl = process.env.AUTOBUILD_NOTIFY_URL;
  const prevSecret = process.env.AUTOBUILD_NOTIFY_SECRET;
  delete process.env.AUTOBUILD_NOTIFY_URL;
  delete process.env.AUTOBUILD_NOTIFY_SECRET;
  const r = await notificarSilvia('hola');
  assert.equal(r.enviado, false);
  assert.match(r.motivo, /AUTOBUILD_NOTIFY_URL/);
  if (prevUrl != null) process.env.AUTOBUILD_NOTIFY_URL = prevUrl;
  if (prevSecret != null) process.env.AUTOBUILD_NOTIFY_SECRET = prevSecret;
});
