import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import { registrarMovimiento } from '../netlify/functions/_lib/finanzas.js';

// ---------------------------------------------------------------------------
// Fake mínimo de Postgres: implementa `sql.query(text, params)` para las pocas
// consultas que emite el flujo de registro (insert/on-conflict, dedup, update,
// empresas, eventos). Simula la restricción UNIQUE(idempotency_key).
// ---------------------------------------------------------------------------
function fakeDb() {
  const movimientos = [];
  const empresas = [];
  let seq = 0;
  const diasEntre = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim();

    if (t.startsWith('insert into movimientos')) {
      const key = params[11];
      if (movimientos.some((m) => m.idempotency_key === key)) return []; // ON CONFLICT DO NOTHING
      const row = {
        id: ++seq, fecha: params[0], tipo: params[1], categoria: params[2],
        subcategoria: params[3], descripcion: params[4], monto: params[5],
        metodo_pago: params[6], quien_pago: params[7], tarjeta: params[8],
        notas: params[9], origen: params[10], idempotency_key: key,
        creado_en: '2026-07-05T12:00:00Z', actualizado_en: null,
      };
      movimientos.push(row);
      return [row];
    }
    if (t.startsWith('select * from movimientos where idempotency_key')) {
      return movimientos.filter((m) => m.idempotency_key === params[0]).slice(0, 1);
    }
    if (t.startsWith('select id, fecha, descripcion, monto')) {
      // findPosibleDuplicado: monto between $1..$2, fecha ±$4 días
      const [lo, hi, fecha, dias] = params;
      return movimientos
        .filter((m) => m.monto >= lo && m.monto <= hi && diasEntre(m.fecha, fecha) <= dias)
        .sort((a, b) => b.id - a.id)
        .map((m) => ({ id: m.id, fecha: m.fecha, descripcion: m.descripcion, monto: m.monto, metodo_pago: m.metodo_pago, tarjeta: m.tarjeta }));
    }
    if (t.startsWith('update movimientos')) {
      const m = movimientos.find((x) => x.id === params[0]);
      if (!m) return [];
      if (params[1]) m.metodo_pago = params[1];
      if (params[2]) m.tarjeta = params[2];
      m.actualizado_en = '2026-07-05T12:05:00Z';
      return [m];
    }
    if (t.startsWith('insert into empresas_mov')) {
      const row = { id: ++seq, empresa: params[0], monto: params[6] };
      empresas.push(row);
      return [row];
    }
    if (t.startsWith('insert into eventos')) return [];
    return [];
  }

  return { query, _movimientos: movimientos, _empresas: empresas };
}

const base = {
  tipo: 'gasto', monto: 117781, descripcion: 'BOLD*Restaurante gre',
  categoria: 'Alimentación', subcategoria: 'Restaurante', fecha: '2026-07-04', quien_pago: 'Luis',
};

test('flujo dedup: alta → actualiza-cuenta → pregunta → fuerza', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  // 1) Alta inicial SIN cuenta (como la foto del recibo).
  const r1 = await registrarMovimiento({ ...base });
  assert.equal(r1.registrado, true);
  assert.equal(db._movimientos.length, 1);

  // 2) Mismo gasto, ahora con la tarjeta Delca2 7730 → ACTUALIZA la fila (no duplica) + retiro.
  const r2 = await registrarMovimiento({ ...base, metodo_pago: 'Mercury Delca2 (7730)', tarjeta_ultimos4: '7730' });
  assert.equal(r2.actualizado, true);
  assert.equal(db._movimientos.length, 1, 'no debe crear otra fila');
  assert.ok(r2.retiro_delca2, 'debe registrar el retiro Delca2');
  assert.equal(db._movimientos[0].metodo_pago, 'Mercury Delca2 (7730)');

  // 3) Duplicado genuino (ya tiene la info) → pregunta, NO escribe.
  const r3 = await registrarMovimiento({ ...base, metodo_pago: 'Mercury Delca2 (7730)', tarjeta_ultimos4: '7730' });
  assert.equal(r3.registrado, false);
  assert.ok(r3.posible_duplicado);
  assert.equal(db._movimientos.length, 1);

  // 4) Con confirmar:true → fuerza una segunda fila.
  const r4 = await registrarMovimiento({ ...base, metodo_pago: 'Mercury Delca2 (7730)', tarjeta_ultimos4: '7730', confirmar: true });
  assert.equal(r4.registrado, true);
  assert.equal(db._movimientos.length, 2);

  setSqlForTests(null);
});

test('idempotencia: reintento exacto NO duplica (misma llave)', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const r1 = await registrarMovimiento({ ...base, metodo_pago: 'Bcol 0965', tarjeta_ultimos4: '2331' });
  assert.equal(r1.registrado, true);
  assert.equal(db._movimientos.length, 1);

  // Mismo evento reenviado (p. ej. reintento de red): misma idempotency_key.
  // El dedup humano no aplica aquí porque forzamos el mismo camino: quitamos la
  // detección previa insertando por llave. Verificamos con source_msg_id igual.
  const r2 = await registrarMovimiento({ ...base, metodo_pago: 'Bcol 0965', tarjeta_ultimos4: '2331', source_msg_id: 'wamid.X', confirmar: true });
  assert.equal(r2.registrado, true); // primera vez con esa llave explícita
  const r3 = await registrarMovimiento({ ...base, metodo_pago: 'Bcol 0965', tarjeta_ultimos4: '2331', source_msg_id: 'wamid.X', confirmar: true });
  assert.equal(r3.ya_existia, true, 'la misma source_msg_id no debe duplicar');
  assert.equal(r3.registrado, false);

  setSqlForTests(null);
});
