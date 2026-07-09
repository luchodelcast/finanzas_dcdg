import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularCuotasAporte, buildLineasAporteHogar, CUENTA_FONDO_COMUN,
} from '../netlify/functions/_lib/aportes-hogar.js';
import { indexarReglas, indexarCuentasMeta } from '../netlify/functions/_lib/contabilizar.js';
import { validarAsiento } from '../netlify/functions/_lib/asientos.js';
import {
  ensureAportesHogarSchema, resetAportesHogarSchemaParaTests, insertAporteHogar,
  getAporteHogar, listAportesHogarPeriodo,
} from '../netlify/functions/_lib/repo.js';
import { deriveAporteHogarKey } from '../netlify/functions/_lib/idempotency.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';

// ---------------------------------------------------------------------------
// calcularCuotasAporte — pura. Reparte lo ya aportado entre las personas en
// proporción a su ingreso; sin ingresos, reparte por igual.
// ---------------------------------------------------------------------------
const PERSONAS = [{ id: 1, nombre: 'Luis' }, { id: 2, nombre: 'Carolina' }];

test('calcularCuotasAporte: cuota proporcional al ingreso (Luis gana el doble → cuota el doble)', () => {
  const r = calcularCuotasAporte({
    personas: PERSONAS,
    ingresosPorPersona: new Map([[1, 4000000], [2, 2000000]]),
    aportesPorPersona: new Map([[1, 300000], [2, 300000]]),
  });
  const luis = r.find((p) => p.entidad_id === 1);
  const caro = r.find((p) => p.entidad_id === 2);
  assert.equal(luis.proporcion_ingreso, 66.7); // 4M / 6M
  assert.equal(caro.proporcion_ingreso, 33.3);
  assert.equal(luis.cuota_sugerida, 400000); // 600000 total * 2/3
  assert.equal(caro.cuota_sugerida, 200000); // 600000 total * 1/3
  assert.equal(luis.pct_cumplido, 75); // aportó 300k de una cuota de 400k
  assert.equal(caro.pct_cumplido, 150); // aportó 300k de una cuota de 200k
});

test('calcularCuotasAporte: sin ingresos registrados, reparte la cuota por igual', () => {
  const r = calcularCuotasAporte({
    personas: PERSONAS,
    ingresosPorPersona: new Map(),
    aportesPorPersona: new Map([[1, 100000]]),
  });
  assert.equal(r.find((p) => p.entidad_id === 1).cuota_sugerida, 50000);
  assert.equal(r.find((p) => p.entidad_id === 2).cuota_sugerida, 50000);
});

test('calcularCuotasAporte: sin aportes este mes, pct_cumplido es null (nada que evaluar)', () => {
  const r = calcularCuotasAporte({
    personas: PERSONAS,
    ingresosPorPersona: new Map([[1, 1000000], [2, 1000000]]),
    aportesPorPersona: new Map(),
  });
  assert.ok(r.every((p) => p.pct_cumplido === null));
  assert.ok(r.every((p) => p.cuota_sugerida === 0));
});

test('calcularCuotasAporte: sin personas → []', () => {
  assert.deepEqual(calcularCuotasAporte({ personas: [], ingresosPorPersona: new Map(), aportesPorPersona: new Map() }), []);
});

// ---------------------------------------------------------------------------
// buildLineasAporteHogar — pura. Débito Fondo Común / crédito medio de pago.
// ---------------------------------------------------------------------------
const REGLAS = indexarReglas([
  { ambito: 'medio', clave: 'efectivo', cuenta: '1105' },
  { ambito: 'medio', clave: 'default', cuenta: '1110' },
]);
const CUENTAS = new Set([CUENTA_FONDO_COMUN, '1105', '1110', '2105']);

test('buildLineasAporteHogar: débito fondo común / crédito medio de pago, y cuadra', () => {
  const l = buildLineasAporteHogar({ monto: 300000, metodo_pago: 'Efectivo' }, REGLAS, new Map());
  assert.deepEqual(l[0], { cuenta: CUENTA_FONDO_COMUN, debito: 300000, credito: 0 });
  assert.deepEqual(l[1], { cuenta: '1105', debito: 0, credito: 300000 });
  assert.equal(validarAsiento(l, CUENTAS).ok, true);
});

test('buildLineasAporteHogar: cuenta_puc de cuentas_meta tiene prioridad (issue #112)', () => {
  const meta = indexarCuentasMeta([{ nombre: 'Serfinanza', dueno: 'carolina', bolsillo: 'gasto_individual', cuenta_puc: '2105' }]);
  const l = buildLineasAporteHogar({ monto: 50000, metodo_pago: 'Serfinanza' }, REGLAS, meta);
  assert.equal(l[1].cuenta, '2105');
});

test('buildLineasAporteHogar: monto inválido → lanza', () => {
  assert.throws(() => buildLineasAporteHogar({ monto: 0, metodo_pago: 'Efectivo' }, REGLAS, new Map()), /monto inválido/);
});

// ---------------------------------------------------------------------------
// Capa de datos (aportes_hogar) — Postgres falseado. DDL idempotente + upsert.
// ---------------------------------------------------------------------------
function fakeDb() {
  const rows = [];
  let nextId = 1;
  const ddlCalls = [];
  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (t.startsWith('create table') || t.startsWith('create index')) { ddlCalls.push(t); return []; }
    if (t.startsWith('insert into aportes_hogar')) {
      const [entidad_id, fecha, monto, moneda, metodo_pago, notas, origen, idempotency_key] = params;
      if (rows.some((r) => r.idempotency_key === idempotency_key)) return [];
      const row = { id: nextId++, entidad_id, fecha, monto, moneda, metodo_pago, notas, origen, idempotency_key };
      rows.push(row);
      return [row];
    }
    if (t.startsWith('select * from aportes_hogar where idempotency_key')) {
      return rows.filter((r) => r.idempotency_key === params[0]).slice(0, 1);
    }
    if (t.startsWith('select * from aportes_hogar where id')) {
      return rows.filter((r) => r.id === params[0]).slice(0, 1);
    }
    if (t.startsWith('select id, entidad_id, fecha, monto, moneda, metodo_pago, notas')) {
      let out = rows.slice();
      if (t.includes('fecha >=') && t.includes('fecha <=')) out = out.filter((r) => r.fecha >= params[0] && r.fecha <= params[1]);
      else if (t.includes('fecha >=')) out = out.filter((r) => r.fecha >= params[0]);
      return out;
    }
    return [];
  }
  return { query, _rows: rows, _ddlCalls: ddlCalls };
}

function reset() {
  resetAportesHogarSchemaParaTests();
  setSqlForTests(null);
}

test('ensureAportesHogarSchema: crea la tabla, memoizado (no repite el DDL)', async () => {
  reset();
  const db = fakeDb();
  setSqlForTests(db);

  await ensureAportesHogarSchema();
  const trasPrimera = db._ddlCalls.length;
  assert.ok(trasPrimera > 0);
  await ensureAportesHogarSchema();
  assert.equal(db._ddlCalls.length, trasPrimera);

  reset();
});

test('insertAporteHogar: idempotente por idempotency_key', async () => {
  reset();
  const db = fakeDb();
  setSqlForTests(db);

  const key = deriveAporteHogarKey({ entidad_id: 1, fecha: '2026-07-01', monto: 300000, metodo_pago: 'Efectivo' });
  const r1 = await insertAporteHogar({ entidad_id: 1, fecha: '2026-07-01', monto: 300000, metodo_pago: 'Efectivo', idempotency_key: key });
  assert.equal(r1.inserted, true);
  const r2 = await insertAporteHogar({ entidad_id: 1, fecha: '2026-07-01', monto: 300000, metodo_pago: 'Efectivo', idempotency_key: key });
  assert.equal(r2.inserted, false);
  assert.equal(r2.row.id, r1.row.id);
  assert.equal(db._rows.length, 1);

  reset();
});

test('getAporteHogar + listAportesHogarPeriodo: el aporte registrado aparece en el reporte del mes', async () => {
  reset();
  const db = fakeDb();
  setSqlForTests(db);

  const { row } = await insertAporteHogar({
    entidad_id: 1, fecha: '2026-07-15', monto: 300000, metodo_pago: 'Efectivo',
    idempotency_key: deriveAporteHogarKey({ entidad_id: 1, fecha: '2026-07-15', monto: 300000, metodo_pago: 'Efectivo' }),
  });
  const encontrado = await getAporteHogar(row.id);
  assert.equal(encontrado.monto, 300000);

  const delMes = await listAportesHogarPeriodo({ desde: '2026-07-01', hasta: '2026-07-31' });
  assert.equal(delMes.length, 1);
  assert.equal(delMes[0].id, row.id);

  const otroMes = await listAportesHogarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31' });
  assert.equal(otroMes.length, 0);

  reset();
});
