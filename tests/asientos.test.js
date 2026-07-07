import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarAsiento, crearAsiento } from '../netlify/functions/_lib/asientos.js';

const CUENTAS = new Set(['1110', '5105', '4155', '2105']);

test('validarAsiento: asiento cuadrado (Σd = Σc) → ok', () => {
  const v = validarAsiento([
    { cuenta: '5105', debito: 45000 },
    { cuenta: '1110', credito: 45000 },
  ], CUENTAS);
  assert.equal(v.ok, true);
  assert.equal(v.totalDebito, 45000);
});

test('validarAsiento: descuadre → error claro', () => {
  const v = validarAsiento([
    { cuenta: '5105', debito: 45000 },
    { cuenta: '1110', credito: 40000 },
  ], CUENTAS);
  assert.equal(v.ok, false);
  assert.match(v.error, /no cuadra/);
});

test('validarAsiento: cuenta inexistente → error', () => {
  const v = validarAsiento([
    { cuenta: '9999', debito: 10 },
    { cuenta: '1110', credito: 10 },
  ], CUENTAS);
  assert.equal(v.ok, false);
  assert.match(v.error, /no existe/);
});

test('validarAsiento: renglón con débito Y crédito → error (un solo lado)', () => {
  const v = validarAsiento([
    { cuenta: '5105', debito: 10, credito: 10 },
    { cuenta: '1110', credito: 10 },
  ], CUENTAS);
  assert.equal(v.ok, false);
  assert.match(v.error, /débito O crédito/);
});

test('validarAsiento: menos de 2 renglones → error', () => {
  const v = validarAsiento([{ cuenta: '5105', debito: 10 }], CUENTAS);
  assert.equal(v.ok, false);
});

test('validarAsiento: tolera decimales sin error de punto flotante', () => {
  const v = validarAsiento([
    { cuenta: '5105', debito: 0.1 },
    { cuenta: '1110', credito: 0.1 },
  ], CUENTAS);
  assert.equal(v.ok, true);
});

// ---------------------------------------------------------------------------
// crearAsiento con Postgres falseado: cuadre, guardado e idempotencia.
// ---------------------------------------------------------------------------
function fakeDb() {
  const asientos = [];
  const lineas = [];
  let seq = 0;
  return {
    _asientos: asientos, _lineas: lineas,
    async query(text, params = []) {
      const t = text.replace(/\s+/g, ' ').trim();
      if (t.startsWith('select codigo, nombre, clase')) {
        return [...CUENTAS].map((codigo) => ({ codigo, nombre: codigo, clase: 1, naturaleza: 'debito', cuenta_padre: null }));
      }
      if (t.startsWith('insert into asientos')) {
        const key = params[6];
        if (asientos.some((a) => a.idempotency_key === key)) return []; // ON CONFLICT DO NOTHING
        const row = { id: ++seq, fecha: params[0], descripcion: params[1], origen: params[3], idempotency_key: key };
        asientos.push(row);
        return [row];
      }
      if (t.startsWith('select * from asientos where idempotency_key')) {
        return asientos.filter((a) => a.idempotency_key === params[0]).slice(0, 1);
      }
      if (t.startsWith('insert into asiento_lineas')) {
        // params en grupos de 7: asiento_id, cuenta, debito, credito, ...
        for (let i = 0; i < params.length; i += 7) {
          lineas.push({ asiento_id: params[i], cuenta: params[i + 1], debito: params[i + 2], credito: params[i + 3] });
        }
        return [];
      }
      return [];
    },
  };
}

const base = {
  fecha: '2026-07-05', descripcion: 'Compra mercado', origen: 'manual',
  lineas: [{ cuenta: '5105', debito: 45000 }, { cuenta: '1110', credito: 45000 }],
};

test('crearAsiento: crea cabecera + renglones cuando cuadra', async () => {
  const db = fakeDb();
  const r = await crearAsiento({ ...base }, db);
  assert.equal(r.registrado, true);
  assert.equal(db._asientos.length, 1);
  assert.equal(db._lineas.length, 2);
});

test('crearAsiento: descuadre → lanza, no guarda', async () => {
  const db = fakeDb();
  await assert.rejects(
    () => crearAsiento({ ...base, lineas: [{ cuenta: '5105', debito: 45000 }, { cuenta: '1110', credito: 1 }] }, db),
    /no cuadra/,
  );
  assert.equal(db._asientos.length, 0);
});

test('crearAsiento: mismo asiento dos veces → idempotente (no duplica)', async () => {
  const db = fakeDb();
  const r1 = await crearAsiento({ ...base }, db);
  const r2 = await crearAsiento({ ...base }, db);
  assert.equal(r1.registrado, true);
  assert.equal(r2.ya_existia, true);
  assert.equal(db._asientos.length, 1);
  assert.equal(db._lineas.length, 2);
});
