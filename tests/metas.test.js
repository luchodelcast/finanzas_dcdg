import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularProgresoMeta, saldoActualMeta, listarMetasConProgreso, asegurarMetasSemilla,
  crearMeta, editarMeta, CATEGORIAS_META,
} from '../netlify/functions/_lib/metas.js';

/**
 * Fake mínimo de Postgres: plan de cuentas + asientos (para `mayorCuenta`),
 * entidades (para resolver a Carolina en la semilla de pensión) y la tabla
 * `metas` en memoria (create/select/insert/update).
 */
function fakeDb({ plan = [], lineas = [], entidades = [] } = {}) {
  const metas = [];
  let nextId = 1;
  return {
    _metas: metas,
    async query(text, params = []) {
      const t = text.replace(/\s+/g, ' ').trim();
      if (t.startsWith('create table') || t.startsWith('create index')) return [];
      if (t.startsWith('insert into plan_cuentas')) return [];
      if (t.startsWith('select codigo, nombre, clase, naturaleza, cuenta_padre from plan_cuentas where codigo')) {
        return plan.filter((p) => p.codigo === params[0]).slice(0, 1);
      }
      if (t.startsWith('select a.id as asiento_id, a.fecha, a.descripcion, l.debito, l.credito')) {
        return lineas.filter((l) => l.cuenta === params[0]).map(({ cuenta, ...l }) => l);
      }
      if (t.includes('from entidades where lower(nombre)')) {
        const nombre = String(params[0] || '').toLowerCase();
        const e = entidades.find((x) => x.nombre.toLowerCase() === nombre);
        return e ? [{ id: e.id }] : [];
      }
      if (t.startsWith('select * from metas where activa')) return metas.filter((m) => m.activa);
      if (t.startsWith('select * from metas order by')) return metas.slice();
      if (t.startsWith('select * from metas where id =')) return metas.filter((m) => m.id === params[0]);
      if (t.startsWith('insert into metas')) {
        const row = {
          id: nextId++, nombre: params[0], categoria: params[1], monto_objetivo: Number(params[2]),
          fecha_objetivo: params[3], cuentas_puc: params[4], entidad_id: params[5], notas: params[6],
          activa: true, creado_en: `2026-07-0${nextId}T00:00:00Z`, actualizado_en: '2026-07-01T00:00:00Z',
        };
        metas.push(row);
        return [row];
      }
      if (t.startsWith('update metas set')) {
        const [id, nombre, categoria, monto_objetivo, fecha_objetivo, cuentas_puc, activa, notas] = params;
        const m = metas.find((x) => x.id === id);
        if (!m) return [];
        if (nombre != null) m.nombre = nombre;
        if (categoria != null) m.categoria = categoria;
        if (monto_objetivo != null) m.monto_objetivo = Number(monto_objetivo);
        if (fecha_objetivo != null) m.fecha_objetivo = fecha_objetivo;
        if (cuentas_puc != null) m.cuentas_puc = cuentas_puc;
        if (activa != null) m.activa = activa;
        if (notas != null) m.notas = notas;
        return [m];
      }
      return [];
    },
  };
}

// ---------------------------------------------------------------------------
// calcularProgresoMeta (pura)
// ---------------------------------------------------------------------------

test('calcularProgresoMeta: avance parcial, no cumplida', () => {
  const r = calcularProgresoMeta({ monto_objetivo: 1000000 }, 250000);
  assert.equal(r.pct_avance, 25);
  assert.equal(r.cumplida, false);
});

test('calcularProgresoMeta: saldo por encima del objetivo → tope 100%, cumplida', () => {
  const r = calcularProgresoMeta({ monto_objetivo: 1000000 }, 1500000);
  assert.equal(r.pct_avance, 100);
  assert.equal(r.cumplida, true);
});

test('calcularProgresoMeta: exactamente el objetivo → 100%, cumplida', () => {
  const r = calcularProgresoMeta({ monto_objetivo: 500000 }, 500000);
  assert.equal(r.pct_avance, 100);
  assert.equal(r.cumplida, true);
});

test('calcularProgresoMeta: sin monto_objetivo → pct null, no cumplida', () => {
  const r = calcularProgresoMeta({ monto_objetivo: 0 }, 100000);
  assert.equal(r.pct_avance, null);
  assert.equal(r.cumplida, false);
});

// ---------------------------------------------------------------------------
// saldoActualMeta
// ---------------------------------------------------------------------------

test('saldoActualMeta: sin cuentas vinculadas → 0', async () => {
  const db = fakeDb();
  const saldo = await saldoActualMeta({ cuentas_puc: '' }, db);
  assert.equal(saldo, 0);
});

test('saldoActualMeta: una cuenta vinculada suma su saldo del Mayor', async () => {
  const db = fakeDb({
    plan: [{ codigo: '1105', nombre: 'Ahorros emergencia', clase: 1, naturaleza: 'debito' }],
    lineas: [{ cuenta: '1105', asiento_id: 1, fecha: '2026-07-01', descripcion: 'Apertura', debito: 3000000, credito: 0 }],
  });
  const saldo = await saldoActualMeta({ cuentas_puc: '1105' }, db);
  assert.equal(saldo, 3000000);
});

test('saldoActualMeta: varias cuentas separadas por coma se suman', async () => {
  const db = fakeDb({
    plan: [
      { codigo: '1105', nombre: 'Ahorros', clase: 1, naturaleza: 'debito' },
      { codigo: '1106', nombre: 'CDT', clase: 1, naturaleza: 'debito' },
    ],
    lineas: [
      { cuenta: '1105', asiento_id: 1, fecha: '2026-07-01', descripcion: 'x', debito: 1000000, credito: 0 },
      { cuenta: '1106', asiento_id: 2, fecha: '2026-07-01', descripcion: 'y', debito: 2000000, credito: 0 },
    ],
  });
  const saldo = await saldoActualMeta({ cuentas_puc: '1105, 1106' }, db);
  assert.equal(saldo, 3000000);
});

test('saldoActualMeta: una cuenta inexistente no rompe el cálculo (no suma, no lanza)', async () => {
  const db = fakeDb({ plan: [], lineas: [] });
  const saldo = await saldoActualMeta({ cuentas_puc: '9999' }, db);
  assert.equal(saldo, 0);
});

// ---------------------------------------------------------------------------
// asegurarMetasSemilla / listarMetasConProgreso
// ---------------------------------------------------------------------------

test('asegurarMetasSemilla: crea las 3 metas semilla + pensión de Carolina la primera vez', async () => {
  const db = fakeDb({ entidades: [{ id: 2, nombre: 'Carolina' }] });
  const creadas = await asegurarMetasSemilla(db);
  assert.equal(creadas, 4);
  const nombres = db._metas.map((m) => m.nombre);
  assert.ok(nombres.includes('Fondo de emergencia'));
  assert.ok(nombres.includes('Retiro'));
  assert.ok(nombres.includes('Educación de los hijos'));
  const pension = db._metas.find((m) => m.nombre.includes('Pensión'));
  assert.ok(pension);
  assert.equal(pension.entidad_id, 2);
});

test('asegurarMetasSemilla: es idempotente, no duplica en una segunda corrida', async () => {
  const db = fakeDb({ entidades: [{ id: 2, nombre: 'Carolina' }] });
  await asegurarMetasSemilla(db);
  const creadas2 = await asegurarMetasSemilla(db);
  assert.equal(creadas2, 0);
  assert.equal(db._metas.length, 4);
});

test('listarMetasConProgreso: arma el progreso de cada meta y crea las semillas si faltan', async () => {
  const db = fakeDb({ entidades: [] });
  const r = await listarMetasConProgreso({}, db);
  assert.equal(r.ok, true);
  assert.equal(r.metas.length, 4);
  for (const m of r.metas) {
    assert.equal(m.saldo_actual, 0); // ninguna semilla trae cuenta vinculada todavía
    assert.equal(m.pct_avance, 0);
  }
});

// ---------------------------------------------------------------------------
// crearMeta / editarMeta
// ---------------------------------------------------------------------------

test('crearMeta: nombre vacío → lanza', async () => {
  const db = fakeDb();
  await assert.rejects(() => crearMeta({ nombre: '  ', monto_objetivo: 1000 }, db), /nombre/);
});

test('crearMeta: monto objetivo inválido → lanza', async () => {
  const db = fakeDb();
  await assert.rejects(() => crearMeta({ nombre: 'Viaje', monto_objetivo: 0 }, db), /monto objetivo/);
});

test('crearMeta: categoría desconocida cae a "otra"', async () => {
  const db = fakeDb();
  const r = await crearMeta({ nombre: 'Viaje', monto_objetivo: 2000000, categoria: 'no-existe' }, db);
  assert.equal(r.ok, true);
  assert.equal(db._metas[0].categoria, 'otra');
});

test('crearMeta: crea la meta con los campos dados', async () => {
  const db = fakeDb();
  const r = await crearMeta({ nombre: 'Carro nuevo', monto_objetivo: 40000000, categoria: 'otra', cuentas_puc: '1105' }, db);
  assert.equal(r.ok, true);
  assert.ok(r.id);
  assert.equal(db._metas[0].nombre, 'Carro nuevo');
  assert.equal(db._metas[0].cuentas_puc, '1105');
});

test('editarMeta: meta inexistente → lanza', async () => {
  const db = fakeDb();
  await assert.rejects(() => editarMeta(999, { monto_objetivo: 100 }, db), /no encontrada/);
});

test('editarMeta: monto objetivo inválido → lanza', async () => {
  const db = fakeDb();
  const { id } = await crearMeta({ nombre: 'Meta', monto_objetivo: 100000 }, db);
  await assert.rejects(() => editarMeta(id, { monto_objetivo: -5 }, db), /monto objetivo/);
});

test('editarMeta: vincula una cuenta y desactiva la meta', async () => {
  const db = fakeDb();
  const { id } = await crearMeta({ nombre: 'Meta', monto_objetivo: 100000 }, db);
  const r = await editarMeta(id, { cuentas_puc: '1105,1106', activa: false }, db);
  assert.equal(r.ok, true);
  const m = db._metas.find((x) => x.id === id);
  assert.equal(m.cuentas_puc, '1105,1106');
  assert.equal(m.activa, false);
});

test('CATEGORIAS_META incluye las categorías esperadas', () => {
  assert.deepEqual(CATEGORIAS_META, ['emergencia', 'retiro', 'educacion', 'pension_carolina', 'otra']);
});
