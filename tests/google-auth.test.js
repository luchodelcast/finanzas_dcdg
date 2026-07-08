import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import { resetUsuariosSchemaParaTests } from '../netlify/functions/_lib/repo.js';
import { verifyFinanceUser } from '../netlify/functions/_lib/google-auth.js';

const CLIENT_ID = '473061009211-972b11u9s6gpqln7n0e6tdn51vjmnv5p.apps.googleusercontent.com';

function fakeTokeninfo(info) {
  return async () => ({ ok: true, json: async () => info });
}

function fakeDbConRoles(rolesPorEmail) {
  return {
    query: async (text, params) => {
      const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (t.startsWith('create table')) return [];
      if (t.startsWith('insert into usuarios')) return [];
      if (t.startsWith('select rol from usuarios')) {
        const [email] = params;
        const rol = rolesPorEmail[email];
        return rol ? [{ rol }] : [];
      }
      return [];
    },
  };
}

function conFetchYDb(fetchImpl, db, run) {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  resetUsuariosSchemaParaTests();
  setSqlForTests(db);
  return run().finally(() => {
    globalThis.fetch = fetchOriginal;
    setSqlForTests(null);
    resetUsuariosSchemaParaTests();
  });
}

test('verifyFinanceUser: rol viene de `usuarios` cuando el email tiene fila', async () => {
  await conFetchYDb(
    fakeTokeninfo({ aud: CLIENT_ID, email: 'santiago@iwin.im' }),
    fakeDbConRoles({ 'santiago@iwin.im': 'contador' }),
    async () => {
      const auth = await verifyFinanceUser('token-valido');
      assert.deepEqual(auth, { email: 'santiago@iwin.im', rol: 'contador' });
    }
  );
});

test('verifyFinanceUser: sin fila en `usuarios`, cae a owner si está en FINANZAS_OWNERS', async () => {
  await conFetchYDb(
    fakeTokeninfo({ aud: CLIENT_ID, email: 'luis@iwin.im' }),
    fakeDbConRoles({}),
    async () => {
      const auth = await verifyFinanceUser('token-valido');
      assert.deepEqual(auth, { email: 'luis@iwin.im', rol: 'owner' });
    }
  );
});

test('verifyFinanceUser: sin fila en `usuarios` y fuera de FINANZAS_OWNERS → solo_lectura (nadie gana acceso de más)', async () => {
  await conFetchYDb(
    fakeTokeninfo({ aud: CLIENT_ID, email: 'angela@iwin.im' }),
    fakeDbConRoles({}),
    async () => {
      const auth = await verifyFinanceUser('token-valido');
      assert.deepEqual(auth, { email: 'angela@iwin.im', rol: 'solo_lectura' });
    }
  );
});

test('verifyFinanceUser: si la DB no responde, cae al mismo criterio legacy (no bloquea el login)', async () => {
  await conFetchYDb(
    fakeTokeninfo({ aud: CLIENT_ID, email: 'carodz2@gmail.com' }),
    { query: async () => { throw new Error('sin conexión'); } },
    async () => {
      const auth = await verifyFinanceUser('token-valido');
      assert.deepEqual(auth, { email: 'carodz2@gmail.com', rol: 'owner' });
    }
  );
});

test('verifyFinanceUser: email fuera de FINANZAS_USERS → 403, sin llegar a mirar `usuarios`', async () => {
  await conFetchYDb(
    fakeTokeninfo({ aud: CLIENT_ID, email: 'desconocido@example.com' }),
    fakeDbConRoles({}),
    async () => {
      await assert.rejects(
        () => verifyFinanceUser('token-valido'),
        (e) => e.status === 403
      );
    }
  );
});

test('verifyFinanceUser: sin token → 401', async () => {
  await assert.rejects(
    () => verifyFinanceUser(''),
    (e) => e.status === 401
  );
});
