import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveIdempotencyKey, deriveIngresoKey } from '../netlify/functions/_lib/idempotency.js';

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

test('ingreso: misma info → misma llave; distinta entidad → distinta', () => {
  const a = deriveIngresoKey({ entidad_id: 2, fecha: '2026-07-05', monto: 5000000, concepto: 'Honorarios', cedula: 'honorarios' });
  const b = deriveIngresoKey({ entidad_id: 2, fecha: '2026-07-05', monto: 5000000, concepto: 'honorarios', cedula: 'honorarios' });
  const c = deriveIngresoKey({ entidad_id: 3, fecha: '2026-07-05', monto: 5000000, concepto: 'Honorarios', cedula: 'honorarios' });
  assert.equal(a, b); // normaliza el concepto
  assert.notEqual(a, c); // otra entidad → otra llave
});
