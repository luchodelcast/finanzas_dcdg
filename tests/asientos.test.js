import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import { crearAsiento } from '../netlify/functions/_lib/asientos.js';

// ---------------------------------------------------------------------------
// Fake mínimo de Postgres: plan_cuentas (solo lectura, semilla fija) + asientos/
// asiento_lineas (con la restricción UNIQUE(idempotency_key) simulada).
// ---------------------------------------------------------------------------
const CUENTAS = [
  { codigo: '1110', nombre: 'Bancos y billeteras', clase: 1, naturaleza: 'debito', activo: true },
  { codigo: '2105', nombre: 'Tarjetas de crédito por pagar', clase: 2, naturaleza: 'credito', activo: true },
  { codigo: '5105', nombre: 'Alimentación', clase: 5, naturaleza: 'debito', activo: true },
  { codigo: '9999', nombre: 'Cuenta inactiva', clase: 5, naturaleza: 'debito', activo: false },
];

function fakeDb() {
  const asientos = [];
  const lineas = [];
  let seq = 0;

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim();

    if (t.startsWith('select codigo, nombre, clase, naturaleza, cuenta_padre from plan_cuentas where codigo =')) {
      const c = CUENTAS.find((x) => x.codigo === params[0]);
      return c ? [c] : [];
    }
    if (t.startsWith('insert into asientos')) {
      // cols: fecha, descripcion, entidad_id, origen, estado, estado_conciliacion, idempotency_key
      const key = params[6];
      if (asientos.some((a) => a.idempotency_key === key)) return []; // ON CONFLICT DO NOTHING
      const row = {
        id: ++seq, fecha: params[0], descripcion: params[1], entidad_id: params[2],
        origen: params[3], estado: params[4], estado_conciliacion: params[5], idempotency_key: key,
      };
      asientos.push(row);
      return [row];
    }
    if (t.startsWith('select * from asientos where idempotency_key')) {
      return asientos.filter((a) => a.idempotency_key === params[0]).slice(0, 1);
    }
    if (t.startsWith('insert into asiento_lineas')) {
      // cols repetidas de a 7: asiento_id, cuenta, debito, credito, tercero_id, movimiento_id, ingreso_id
      const out = [];
      for (let i = 0; i < params.length; i += 7) {
        const row = {
          id: ++seq, asiento_id: params[i], cuenta: params[i + 1], debito: params[i + 2], credito: params[i + 3],
          tercero_id: params[i + 4], movimiento_id: params[i + 5], ingreso_id: params[i + 6],
        };
        lineas.push(row);
        out.push(row);
      }
      return out;
    }
    return [];
  }

  return { query, _asientos: asientos, _lineas: lineas };
}

const base = { fecha: '2026-07-07', descripcion: 'Compra mercado', origen: 'manual' };

test('crearAsiento: cuadre correcto inserta cabecera + líneas', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const r = await crearAsiento({
    ...base,
    lineas: [
      { cuenta: '5105', debito: 50000 },
      { cuenta: '1110', credito: 50000 },
    ],
  });

  assert.equal(r.inserted, true);
  assert.equal(db._asientos.length, 1);
  assert.equal(db._lineas.length, 2);
  assert.equal(r.lineas.length, 2);

  setSqlForTests(null);
});

test('crearAsiento: rechaza un asiento descuadrado (Σdébito ≠ Σcrédito)', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  await assert.rejects(
    () => crearAsiento({
      ...base,
      lineas: [
        { cuenta: '5105', debito: 50000 },
        { cuenta: '1110', credito: 40000 },
      ],
    }),
    /no cuadra/,
  );
  assert.equal(db._asientos.length, 0, 'no debe escribir nada si no cuadra');

  setSqlForTests(null);
});

test('crearAsiento: rechaza una cuenta que no existe en el plan de cuentas', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  await assert.rejects(
    () => crearAsiento({
      ...base,
      lineas: [
        { cuenta: '0000', debito: 50000 },
        { cuenta: '1110', credito: 50000 },
      ],
    }),
    /no existe en el plan de cuentas/,
  );
  assert.equal(db._asientos.length, 0);

  setSqlForTests(null);
});

test('crearAsiento: rechaza una cuenta inactiva', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  await assert.rejects(
    () => crearAsiento({
      ...base,
      lineas: [
        { cuenta: '9999', debito: 50000 },
        { cuenta: '1110', credito: 50000 },
      ],
    }),
    /inactiva/,
  );

  setSqlForTests(null);
});

test('crearAsiento: idempotencia — el mismo asiento reenviado no duplica', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const lineas = [
    { cuenta: '5105', debito: 30000 },
    { cuenta: '2105', credito: 30000 },
  ];
  const r1 = await crearAsiento({ ...base, lineas });
  assert.equal(r1.inserted, true);
  assert.equal(db._asientos.length, 1);

  const r2 = await crearAsiento({ ...base, lineas });
  assert.equal(r2.inserted, false, 'la misma llave derivada no debe duplicar');
  assert.equal(db._asientos.length, 1);
  assert.equal(db._lineas.length, 2, 'no se insertan líneas de nuevo');

  setSqlForTests(null);
});

test('crearAsiento: idempotency_key explícita distingue asientos que de otro modo serían iguales', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const lineas = [
    { cuenta: '5105', debito: 10000 },
    { cuenta: '1110', credito: 10000 },
  ];
  const r1 = await crearAsiento({ ...base, lineas, idempotency_key: 'a' });
  const r2 = await crearAsiento({ ...base, lineas, idempotency_key: 'b' });
  assert.equal(r1.inserted, true);
  assert.equal(r2.inserted, true);
  assert.equal(db._asientos.length, 2);

  setSqlForTests(null);
});

test('crearAsiento: exige al menos 2 líneas y rechaza débito+crédito simultáneos', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  await assert.rejects(() => crearAsiento({ ...base, lineas: [{ cuenta: '1110', debito: 100 }] }), /al menos 2 líneas/);
  await assert.rejects(
    () => crearAsiento({ ...base, lineas: [{ cuenta: '1110', debito: 100, credito: 100 }, { cuenta: '5105', debito: 100 }] }),
    /no puede tener débito y crédito/,
  );

  setSqlForTests(null);
});

test('crearAsiento: valida fecha, descripción y origen', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  const lineas = [{ cuenta: '1110', debito: 100 }, { cuenta: '5105', credito: 100 }];

  await assert.rejects(() => crearAsiento({ ...base, fecha: 'no-es-fecha', lineas }), /fecha inválida/);
  await assert.rejects(() => crearAsiento({ ...base, descripcion: '', lineas }), /descripcion requerida/);
  await assert.rejects(() => crearAsiento({ ...base, origen: 'inventado', lineas }), /origen inválido/);

  setSqlForTests(null);
});
