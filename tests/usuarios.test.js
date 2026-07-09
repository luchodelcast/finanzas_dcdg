import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import {
  ensureUsuariosSchema, resetUsuariosSchemaParaTests, getUsuarioRolPorEmail, getUsuarioNombrePorEmail,
} from '../netlify/functions/_lib/repo.js';

// ---------------------------------------------------------------------------
// Capa de datos — Postgres falseado. Verifica el DDL idempotente en runtime
// (T8, issue #97) y la lectura del rol.
// ---------------------------------------------------------------------------
function fakeDb(seedRows = []) {
  const usuarios = seedRows.map((r) => ({ activo: true, ...r }));
  const ddlCalls = [];
  const insertCalls = [];

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (t.startsWith('create table')) { ddlCalls.push(t); return []; }
    if (t.startsWith('insert into usuarios')) {
      const [email, nombre, rol, pais] = params;
      insertCalls.push(email);
      if (usuarios.some((u) => u.email === email)) return [];
      usuarios.push({ email, nombre, rol, pais, activo: true });
      return [];
    }
    if (t.startsWith('select rol from usuarios')) {
      const [email] = params;
      const row = usuarios.find((u) => u.email === email && u.activo);
      return row ? [{ rol: row.rol }] : [];
    }
    if (t.startsWith('select nombre from usuarios')) {
      const [email] = params;
      const row = usuarios.find((u) => u.email === email && u.activo);
      return row ? [{ nombre: row.nombre }] : [];
    }
    return [];
  }

  return { query, _usuarios: usuarios, _ddlCalls: ddlCalls, _insertCalls: insertCalls };
}

test('ensureUsuariosSchema: crea la tabla + siembra el equipo conocido, memoizado (no repite el DDL)', async () => {
  resetUsuariosSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);
  await ensureUsuariosSchema();
  const ddlTrasPrimera = db._ddlCalls.length;
  assert.ok(ddlTrasPrimera > 0);
  assert.ok(db._insertCalls.includes('luis@iwin.im'));
  assert.ok(db._insertCalls.includes('santiago@iwin.im'));

  await ensureUsuariosSchema(); // segunda llamada: no debe repetir el DDL
  assert.equal(db._ddlCalls.length, ddlTrasPrimera);
  setSqlForTests(null);
  resetUsuariosSchemaParaTests();
});

test('getUsuarioRolPorEmail: devuelve el rol de una fila sembrada, sin importar mayúsculas', async () => {
  resetUsuariosSchemaParaTests();
  setSqlForTests(fakeDb());
  const rol = await getUsuarioRolPorEmail('SANTIAGO@iwin.im');
  assert.equal(rol, 'contador');
  setSqlForTests(null);
  resetUsuariosSchemaParaTests();
});

test('getUsuarioRolPorEmail: null si el email no tiene fila (el llamador decide el fallback)', async () => {
  resetUsuariosSchemaParaTests();
  setSqlForTests(fakeDb());
  const rol = await getUsuarioRolPorEmail('nadie@iwin.im');
  assert.equal(rol, null);
  setSqlForTests(null);
  resetUsuariosSchemaParaTests();
});

test('getUsuarioRolPorEmail: null (no lanza) si la fila existe pero está inactiva', async () => {
  resetUsuariosSchemaParaTests();
  const db = fakeDb();
  db._usuarios.push({ email: 'exempleado@iwin.im', rol: 'contador', activo: false });
  setSqlForTests(db);
  const rol = await getUsuarioRolPorEmail('exempleado@iwin.im');
  assert.equal(rol, null);
  setSqlForTests(null);
  resetUsuariosSchemaParaTests();
});

test('getUsuarioRolPorEmail: null (no lanza) si la DB no responde', async () => {
  resetUsuariosSchemaParaTests();
  setSqlForTests({ query: async () => { throw new Error('sin conexión'); } });
  const rol = await getUsuarioRolPorEmail('luis@iwin.im');
  assert.equal(rol, null);
  setSqlForTests(null);
  resetUsuariosSchemaParaTests();
});

test('getUsuarioRolPorEmail: null si el email es vacío', async () => {
  const rol = await getUsuarioRolPorEmail('');
  assert.equal(rol, null);
});

// ---------------------------------------------------------------------------
// getUsuarioNombrePorEmail (issue #115, "Mi patrimonio") — mismo criterio de
// nunca-lanzar que getUsuarioRolPorEmail.
// ---------------------------------------------------------------------------
test('getUsuarioNombrePorEmail: devuelve el nombre sembrado de Luis/Carolina, sin importar mayúsculas', async () => {
  resetUsuariosSchemaParaTests();
  setSqlForTests(fakeDb());
  assert.equal(await getUsuarioNombrePorEmail('LUIS@iwin.im'), 'Luis');
  assert.equal(await getUsuarioNombrePorEmail('carodz2@gmail.com'), 'Carolina');
  setSqlForTests(null);
  resetUsuariosSchemaParaTests();
});

test('getUsuarioNombrePorEmail: null si el email no tiene fila o la DB no responde', async () => {
  resetUsuariosSchemaParaTests();
  setSqlForTests(fakeDb());
  assert.equal(await getUsuarioNombrePorEmail('nadie@iwin.im'), null);
  setSqlForTests({ query: async () => { throw new Error('sin conexión'); } });
  assert.equal(await getUsuarioNombrePorEmail('luis@iwin.im'), null);
  setSqlForTests(null);
  resetUsuariosSchemaParaTests();
});
