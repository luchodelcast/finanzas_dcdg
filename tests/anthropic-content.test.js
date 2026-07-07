import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiptContent, MAX_PDF_BYTES } from '../netlify/functions/_lib/anthropic.js';

test('buildReceiptContent: imagen arma bloque `image`', () => {
  const content = buildReceiptContent({ base64: 'ZmFrZQ==', mediaType: 'image/jpeg' });
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/jpeg');
  assert.equal(content[0].source.data, 'ZmFrZQ==');
});

test('buildReceiptContent: sin mediaType asume image/jpeg (compatibilidad)', () => {
  const content = buildReceiptContent({ base64: 'ZmFrZQ==' });
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/jpeg');
});

test('buildReceiptContent: PDF arma bloque `document`', () => {
  const content = buildReceiptContent({ base64: 'ZmFrZQ==', mediaType: 'application/pdf' });
  assert.equal(content[0].type, 'document');
  assert.equal(content[0].source.media_type, 'application/pdf');
  assert.match(content[1].text, /PDF/);
});

test('buildReceiptContent: PDF que excede MAX_PDF_BYTES lanza error amigable', () => {
  // Genera un base64 cuyo tamaño decodificado supera el límite.
  const approxBytes = MAX_PDF_BYTES + 1024;
  const big = 'A'.repeat(Math.ceil((approxBytes * 4) / 3));
  assert.throws(
    () => buildReceiptContent({ base64: big, mediaType: 'application/pdf' }),
    /supera el límite/
  );
});

test('buildReceiptContent: imagen del mismo tamaño NO lanza (el límite solo aplica a PDF)', () => {
  const approxBytes = MAX_PDF_BYTES + 1024;
  const big = 'A'.repeat(Math.ceil((approxBytes * 4) / 3));
  assert.doesNotThrow(() => buildReceiptContent({ base64: big, mediaType: 'image/jpeg' }));
});
