import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession, sessionSecretConfigured } from '../netlify/functions/_lib/session.js';

const NOW = 1_000_000_000_000; // epoch ms fijo (los scripts de workflow no tienen Date.now, aquí sí)

test('signSession/verifySession: roundtrip válido devuelve el payload', () => {
  process.env.AUTH_SECRET = 'test-secret';
  const token = signSession({ email: 'luis@iwin.im' }, 3600, NOW);
  const payload = verifySession(token, NOW + 1000);
  assert.equal(payload.email, 'luis@iwin.im');
  assert.equal(typeof payload.iat, 'number');
  assert.equal(payload.exp, payload.iat + 3600);
});

test('verifySession: null cuando el token expiró', () => {
  process.env.AUTH_SECRET = 'test-secret';
  const token = signSession({ email: 'x@y.z' }, 60, NOW);
  assert.equal(verifySession(token, NOW + 61_000), null);
});

test('verifySession: null si la firma no cuadra (secreto distinto)', () => {
  process.env.AUTH_SECRET = 'secret-a';
  const token = signSession({ email: 'x@y.z' }, 3600, NOW);
  process.env.AUTH_SECRET = 'secret-b';
  assert.equal(verifySession(token, NOW), null);
});

test('verifySession: null ante token manipulado, vacío o basura', () => {
  process.env.AUTH_SECRET = 'test-secret';
  assert.equal(verifySession('no-es-jwt', NOW), null);
  assert.equal(verifySession('', NOW), null);
  assert.equal(verifySession(null, NOW), null);
  const t = signSession({ email: 'a@b.c' }, 3600, NOW);
  assert.equal(verifySession(t.slice(0, -3) + 'xxx', NOW), null); // firma alterada
});

test('sessionSecretConfigured refleja AUTH_SECRET', () => {
  process.env.AUTH_SECRET = 'x';
  assert.equal(sessionSecretConfigured(), true);
  delete process.env.AUTH_SECRET;
  assert.equal(sessionSecretConfigured(), false);
});

test('signSession: lanza 503 si falta AUTH_SECRET', () => {
  delete process.env.AUTH_SECRET;
  assert.throws(() => signSession({ email: 'a@b.c' }, 3600, NOW), (e) => e.status === 503);
});
