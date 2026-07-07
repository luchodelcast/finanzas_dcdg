import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapClaudeLineas, parseExtractoPdfText } from '../netlify/functions/_lib/extracto-pdf.js';

test('mapClaudeLineas: signo → tipo, y arma el shape de líneas', () => {
  const { lineas, errores } = mapClaudeLineas([
    { fecha: '2026-07-03', descripcion: 'PAGO NEQUI', monto: -50000 },
    { fecha: '2026-07-04', descripcion: 'CONSIGNACION', monto: 120000 },
  ]);
  assert.equal(errores.length, 0);
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0].tipo, 'debito');
  assert.equal(lineas[0].monto, -50000);
  assert.equal(lineas[0].descripcion, 'PAGO NEQUI');
  assert.equal(lineas[1].tipo, 'credito');
});

test('mapClaudeLineas: monto como string ("1.234,56") también se parsea', () => {
  const { lineas } = mapClaudeLineas([{ fecha: '2026-07-05', descripcion: 'X', monto: '-1.234,56' }]);
  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].tipo, 'debito');
  assert.ok(lineas[0].monto < 0);
});

test('mapClaudeLineas: filas sin fecha o sin monto se omiten con aviso', () => {
  const { lineas, errores } = mapClaudeLineas([
    { descripcion: 'sin fecha', monto: -10 },
    { fecha: '2026-07-05', descripcion: 'sin monto' },
    { fecha: '2026-07-05', descripcion: 'ok', monto: -10 },
  ]);
  assert.equal(lineas.length, 1);
  assert.equal(errores.length, 2);
});

test('mapClaudeLineas: entrada no-array → vacío sin lanzar', () => {
  assert.deepEqual(mapClaudeLineas(null), { lineas: [], errores: [] });
  assert.deepEqual(mapClaudeLineas(undefined), { lineas: [], errores: [] });
});

test('parseExtractoPdfText: texto vacío → error, sin llamar al modelo', async () => {
  let llamado = false;
  const r = await parseExtractoPdfText('   ', { callAnthropic: async () => { llamado = true; return ''; } });
  assert.equal(r.lineas.length, 0);
  assert.equal(llamado, false);
  assert.match(r.errores[0], /vac/i);
});

test('parseExtractoPdfText: estructura el texto vía el modelo (inyectado)', async () => {
  const fakeCall = async ({ content, system }) => {
    assert.ok(system.includes('extractos bancarios'));
    assert.ok(content[0].text.includes('MOVIMIENTO'));
    return '```json\n{"transacciones":[{"fecha":"2026-07-06","descripcion":"COMPRA","monto":-9900}]}\n```';
  };
  const r = await parseExtractoPdfText('... MOVIMIENTO 06/07 COMPRA -9.900 ...', { callAnthropic: fakeCall });
  assert.equal(r.lineas.length, 1);
  assert.equal(r.lineas[0].tipo, 'debito');
  assert.equal(r.lineas[0].descripcion, 'COMPRA');
});

test('parseExtractoPdfText: respuesta no-JSON del modelo → error controlado', async () => {
  const r = await parseExtractoPdfText('algo', { callAnthropic: async () => 'lo siento, no puedo' });
  assert.equal(r.lineas.length, 0);
  assert.match(r.errores[0], /JSON/);
});
