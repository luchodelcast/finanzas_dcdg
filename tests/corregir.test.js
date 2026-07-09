import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reversarLineas, activeKey, anularMovimientoCompleto, recategorizarMovimiento } from '../netlify/functions/_lib/corregir.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import { resetCorreccionSchemaParaTests } from '../netlify/functions/_lib/repo.js';

// ---------------------------------------------------------------------------
// Lógica pura del reverso contable (lo crítico: neutraliza el asiento).
// ---------------------------------------------------------------------------
test('reversarLineas: invierte débito↔crédito de cada renglón', () => {
  const orig = [
    { cuenta: '5135', debito: 100, credito: 0 },
    { cuenta: '1110', debito: 0, credito: 100 },
  ];
  const rev = reversarLineas(orig);
  assert.deepEqual(rev, [
    { cuenta: '5135', debito: 0, credito: 100 },
    { cuenta: '1110', debito: 100, credito: 0 },
  ]);
  // El reverso sumado al original cuadra en cero por cuenta (se neutraliza).
  const neto = {};
  for (const l of [...orig, ...rev]) {
    neto[l.cuenta] = (neto[l.cuenta] || 0) + (l.debito - l.credito);
  }
  assert.deepEqual(neto, { 5135: 0, 1110: 0 });
});

test('activeKey: v1 sin sufijo, v>1 con :v<n>', () => {
  assert.equal(activeKey(7, 1), 'auto:mov:7');
  assert.equal(activeKey(7, 2), 'auto:mov:7:v2');
  assert.equal(activeKey(7, undefined), 'auto:mov:7');
});

// ---------------------------------------------------------------------------
// Guarda de idempotencia: anular algo ya anulado no reversa de nuevo.
// ---------------------------------------------------------------------------
test('anularMovimientoCompleto: si ya está anulado, no hace nada (idempotente)', async () => {
  resetCorreccionSchemaParaTests();
  const calls = [];
  setSqlForTests({
    query: async (text, params = []) => {
      const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
      calls.push(t.slice(0, 24));
      if (t.startsWith('alter table')) return [];
      if (t.startsWith('select * from movimientos where id')) {
        return [{ id: params[0], anulado: true, contab_version: 1, fecha: '2026-07-08', descripcion: 'x' }];
      }
      return [];
    },
  });

  const r = await anularMovimientoCompleto(99);
  assert.equal(r.ya_anulado, true);
  // No debe haber intentado insertar un asiento de reverso ni actualizar.
  assert.ok(!calls.some((c) => c.startsWith('insert into asientos')));
  assert.ok(!calls.some((c) => c.startsWith('update movimientos set anulado')));

  setSqlForTests(null);
  resetCorreccionSchemaParaTests();
});

test('recategorizarMovimiento: corregir solo la fecha propaga la fecha nueva al update', async () => {
  resetCorreccionSchemaParaTests();
  let updateParams = null;
  setSqlForTests({
    query: async (text, params = []) => {
      const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (t.startsWith('alter table')) return [];
      if (t.startsWith('select * from movimientos where id')) {
        return [{ id: params[0], anulado: false, contab_version: 1, fecha: '2026-09-07',
          descripcion: 'Triple A', categoria: 'Servicios Públicos', subcategoria: 'Agua', tipo: 'gasto',
          quien_pago: 'Luis' }];
      }
      if (t.startsWith('update movimientos set tipo')) {
        updateParams = params;
        return [{ id: params[0], fecha: '2026-07-09', categoria: 'Servicios Públicos', descripcion: 'Triple A' }];
      }
      return [];
    },
  });

  const r = await recategorizarMovimiento(5, { fecha: '2026-07-09' });
  assert.equal(r.ok, true);
  // $7 (índice 6) es campos.fecha en updateMovimientoCampos.
  assert.equal(updateParams[6], '2026-07-09');

  setSqlForTests(null);
  resetCorreccionSchemaParaTests();
});

test('anularMovimientoCompleto: movimiento inexistente → error 404', async () => {
  resetCorreccionSchemaParaTests();
  setSqlForTests({
    query: async (text) => {
      const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (t.startsWith('alter table')) return [];
      return []; // getMovimiento devuelve vacío
    },
  });
  await assert.rejects(() => anularMovimientoCompleto(12345), (e) => e.status === 404);
  setSqlForTests(null);
  resetCorreccionSchemaParaTests();
});
