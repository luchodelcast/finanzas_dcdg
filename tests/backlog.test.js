import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarPayloadSolicitud, mapearIssuesGithub } from '../netlify/functions/_lib/backlog.js';

// ---------------------------------------------------------------------------
// armarPayloadSolicitud — pura.
// ---------------------------------------------------------------------------
test('armarPayloadSolicitud: arma título/cuerpo/labels a partir del texto', () => {
  const p = armarPayloadSolicitud('que el dashboard muestre gasto por tarjeta');
  assert.equal(p.title, '[Solicitud] que el dashboard muestre gasto por tarjeta');
  assert.match(p.body, /que el dashboard muestre gasto por tarjeta/);
  assert.deepEqual(p.labels, ['autobuild', 'enhancement']);
});

test('armarPayloadSolicitud: recorta el título si el texto es muy largo', () => {
  const texto = 'x'.repeat(100);
  const p = armarPayloadSolicitud(texto);
  assert.ok(p.title.length < 90);
  assert.ok(p.title.endsWith('…'));
  assert.match(p.body, new RegExp(texto)); // el cuerpo conserva el texto completo
});

test('armarPayloadSolicitud: rechaza texto vacío', () => {
  assert.throws(() => armarPayloadSolicitud(''), /Escribe/);
  assert.throws(() => armarPayloadSolicitud('   '), /Escribe/);
});

// ---------------------------------------------------------------------------
// mapearIssuesGithub — pura.
// ---------------------------------------------------------------------------
test('mapearIssuesGithub: adapta issues crudos y excluye pull requests', () => {
  const raw = [
    { number: 41, title: '[propuesta] Backup', html_url: 'https://x/41', labels: [{ name: 'autobuild' }, { name: 'autobuild-espera' }], created_at: '2026-07-07T12:00:00Z' },
    { number: 90, title: 'Un PR', html_url: 'https://x/90', pull_request: {}, labels: ['autobuild'], created_at: '2026-07-08T00:00:00Z' },
  ];
  const r = mapearIssuesGithub(raw);
  assert.equal(r.length, 1);
  assert.equal(r[0].number, 41);
  assert.deepEqual(r[0].labels, ['autobuild', 'autobuild-espera']);
});

test('mapearIssuesGithub: acepta labels como strings o como objetos', () => {
  const raw = [{ number: 1, title: 'a', html_url: 'u', labels: ['autobuild'], created_at: 't' }];
  assert.deepEqual(mapearIssuesGithub(raw)[0].labels, ['autobuild']);
});

test('mapearIssuesGithub: sin issues → []', () => {
  assert.deepEqual(mapearIssuesGithub([]), []);
  assert.deepEqual(mapearIssuesGithub(null), []);
});
