import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveIdempotencyKey } from '../netlify/functions/_lib/idempotency.js';

test('misma info → misma llave (idempotente ante reintentos)', () => {
  const a = deriveIdempotencyKey({ tipo: 'gasto', fecha: '2026-07-04', monto: 117781, descripcion: 'BOLD*Restaurante gre' });
  const b = deriveIdempotencyKey({ tipo: 'gasto', fecha: '2026-07-04', monto: 117781, descripcion: 'BOLD*Restaurante GRE' });
  assert.equal(a, b); // normaliza mayúsculas/acentos
});

test('distinto monto → distinta llave', () => {
  const a = deriveIdempotencyKey({ fecha: '2026-07-04', monto: 100, descripcion: 'x comercio' });
  const b = deriveIdempotencyKey({ fecha: '2026-07-04', monto: 200, descripcion: 'x comercio' });
  assert.notEqual(a, b);
});

test('respeta un id de evento explícito (p. ej. mensaje de WhatsApp)', () => {
  const k = deriveIdempotencyKey({ source_msg_id: 'wamid.ABC', fecha: '2026-07-04', monto: 100, descripcion: 'algo' });
  assert.equal(k, 'msg:wamid.ABC');
});

test('respeta idempotency_key explícita', () => {
  const k = deriveIdempotencyKey({ idempotency_key: 'k-123', fecha: '2026-07-04', monto: 100, descripcion: 'algo' });
  assert.equal(k, 'k-123');
});
