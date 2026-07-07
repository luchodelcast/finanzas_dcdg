import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvExtracto } from '../netlify/functions/_lib/extractos.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import {
  insertExtracto, insertExtractoLineas, queryExtractos, queryExtractoLineas,
} from '../netlify/functions/_lib/repo.js';

// ---------------------------------------------------------------------------
// parseCsvExtracto — módulo puro.
// ---------------------------------------------------------------------------

test('parseCsvExtracto: parsea filas válidas y detecta tipo por signo del monto', () => {
  const csv = 'Fecha,Descripción,Monto\n2026-07-01,Pago Éxito,-150000\n2026-07-02,Consignación,200000\n';
  const { lineas, errores } = parseCsvExtracto(csv);
  assert.equal(errores.length, 0);
  assert.equal(lineas.length, 2);
  assert.deepEqual(lineas[0], { fecha: '2026-07-01', descripcion: 'Pago Éxito', monto: -150000, tipo: 'debito', referencia: null });
  assert.equal(lineas[1].tipo, 'credito');
});

test('parseCsvExtracto: acepta encabezados alternativos y delimitador ";"', () => {
  const csv = 'date;concepto;valor\n01/07/2026;Uber;-18500\n';
  const { lineas, errores } = parseCsvExtracto(csv);
  assert.equal(errores.length, 0);
  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].fecha, '2026-07-01');
  assert.equal(lineas[0].descripcion, 'Uber');
  assert.equal(lineas[0].monto, -18500);
});

test('parseCsvExtracto: fila con monto inválido se reporta como error, no revienta', () => {
  const csv = 'fecha,descripcion,monto\n2026-07-01,Ok,1000\n2026-07-02,Malo,abc\n2026-07-03,Vacia,\n';
  const { lineas, errores } = parseCsvExtracto(csv);
  assert.equal(lineas.length, 1);
  assert.equal(errores.length, 2);
  assert.match(errores[0], /Fila 3/);
  assert.match(errores[1], /Fila 4/);
});

test('parseCsvExtracto: sin columnas fecha/monto devuelve error de encabezado', () => {
  const { lineas, errores } = parseCsvExtracto('a,b,c\n1,2,3\n');
  assert.equal(lineas.length, 0);
  assert.match(errores[0], /Encabezado inválido/);
});

test('parseCsvExtracto: CSV vacío', () => {
  const { lineas, errores } = parseCsvExtracto('');
  assert.equal(lineas.length, 0);
  assert.match(errores[0], /vacío/);
});

// ---------------------------------------------------------------------------
// repo.js — acceso a datos, con fake de Postgres.
// ---------------------------------------------------------------------------

function fakeDb() {
  const extractos = [];
  const lineas = [];
  let seq = 0;

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim();

    if (t.startsWith('insert into extractos')) {
      const row = {
        id: ++seq, cuenta: params[0], entidad_id: params[1], periodo: params[2],
        fecha_desde: params[3], fecha_hasta: params[4], saldo_inicial: params[5], saldo_final: params[6],
        moneda: params[7], fuente: params[8], estado: params[9], creado_en: '2026-07-07T12:00:00Z',
      };
      extractos.push(row);
      return [row];
    }
    if (t.startsWith('insert into extracto_lineas')) {
      const inserted = [];
      for (let i = 0; i < params.length; i += 6) {
        const row = {
          id: ++seq, extracto_id: params[i], fecha: params[i + 1], descripcion: params[i + 2],
          monto: params[i + 3], tipo: params[i + 4], referencia: params[i + 5], estado: 'sin_conciliar',
        };
        lineas.push(row);
        inserted.push(row);
      }
      return inserted;
    }
    if (t.startsWith('select e.id, e.cuenta')) {
      const [cuenta] = params.length > 1 ? [params[0]] : [null];
      return extractos
        .filter((e) => !cuenta || e.cuenta === cuenta)
        .map((e) => ({ ...e, n_lineas: lineas.filter((l) => l.extracto_id === e.id).length }));
    }
    if (t.startsWith('select id, fecha, descripcion, monto, tipo, referencia, estado')) {
      const [extracto_id] = params;
      return lineas.filter((l) => l.extracto_id === extracto_id);
    }
    return [];
  }

  return { query, _extractos: extractos, _lineas: lineas };
}

test('insertExtracto + insertExtractoLineas: guarda cabecera y líneas sin_conciliar', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const extracto = await insertExtracto({ cuenta: 'Bcol 0965', periodo: '2026-07', moneda: 'COP' });
  assert.equal(extracto.cuenta, 'Bcol 0965');
  assert.equal(extracto.estado, 'cargado');

  const { lineas } = parseCsvExtracto('fecha,descripcion,monto\n2026-07-01,Éxito,-45000\n2026-07-02,Nómina,3200000\n');
  const inserted = await insertExtractoLineas(extracto.id, lineas);
  assert.equal(inserted.length, 2);
  assert.equal(db._lineas.every((l) => l.estado === 'sin_conciliar'), true);
  assert.equal(db._lineas[0].extracto_id, extracto.id);

  setSqlForTests(null);
});

test('queryExtractos: filtra por cuenta e incluye conteo de líneas', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const e1 = await insertExtracto({ cuenta: 'Bcol 0965' });
  const e2 = await insertExtracto({ cuenta: 'Nequi Luis' });
  await insertExtractoLineas(e1.id, [{ fecha: '2026-07-01', descripcion: 'x', monto: 1000, tipo: 'credito' }]);

  const todos = await queryExtractos({});
  assert.equal(todos.length, 2);
  const soloE1 = await queryExtractos({ cuenta: 'Bcol 0965' });
  assert.equal(soloE1.length, 1);
  assert.equal(soloE1[0].n_lineas, 1);

  const lineasE2 = await queryExtractoLineas({ extracto_id: e2.id });
  assert.equal(lineasE2.length, 0);

  setSqlForTests(null);
});

test('queryExtractoLineas: sin extracto_id devuelve vacío sin tocar la DB', async () => {
  setSqlForTests({ query: async () => { throw new Error('no debería llamarse'); } });
  const lineas = await queryExtractoLineas({});
  assert.deepEqual(lineas, []);
  setSqlForTests(null);
});
