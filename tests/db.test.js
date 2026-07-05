import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from '../netlify/functions/_lib/db.js';

// Regresión: el driver de Neon se invoca como sql(text, params) — NO tiene .query.
// makeClient debe exponer .query(text, params) delegando en la función cruda,
// para que repo.js (que usa sql.query) funcione contra el driver real.
test('makeClient adapta la función neon (llamada directa) a .query', async () => {
  const calls = [];
  const raw = (text, params) => { calls.push([text, params]); return Promise.resolve([{ id: 1 }]); };
  const client = makeClient(raw);
  assert.equal(typeof client.query, 'function');
  const rows = await client.query('select $1::int as id', [1]);
  assert.deepEqual(rows, [{ id: 1 }]);
  assert.deepEqual(calls, [['select $1::int as id', [1]]]);
});
