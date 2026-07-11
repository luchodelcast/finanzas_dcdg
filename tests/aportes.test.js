import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularIBC, calcularAportes, smmlvDe } from '../app/src/config/aportes.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import { reporteAportes } from '../netlify/functions/_lib/aportes.js';

const SMMLV_2025 = 1423500;

// ---------------------------------------------------------------------------
// calcularIBC / calcularAportes — funciones puras (piso/techo SMMLV, FSP).
// ---------------------------------------------------------------------------

test('calcularIBC: por debajo del 40% mínimo → se topa al PISO (1 SMMLV)', () => {
  const r = calcularIBC({ ingresos: 500000, costosDeducibles: 0, anio: 2025 });
  assert.equal(r.smmlv, SMMLV_2025);
  assert.equal(r.ibc, SMMLV_2025);
  assert.equal(r.topado, 'piso');
});

test('calcularIBC: ingresos muy altos → se topa al TECHO (25 SMMLV)', () => {
  const r = calcularIBC({ ingresos: 200_000_000, costosDeducibles: 0, anio: 2025 });
  assert.equal(r.techo, SMMLV_2025 * 25);
  assert.equal(r.ibc, SMMLV_2025 * 25);
  assert.equal(r.topado, 'techo');
});

test('calcularIBC: caso normal (sin tope) resta costos deducibles y aplica 40%', () => {
  const r = calcularIBC({ ingresos: 10_000_000, costosDeducibles: 2_000_000, anio: 2025 });
  assert.equal(r.base, 8_000_000);
  assert.equal(r.ibc, 3_200_000);
  assert.equal(r.topado, null);
});

test('calcularIBC: costos nunca dejan la base en negativo', () => {
  const r = calcularIBC({ ingresos: 1_000_000, costosDeducibles: 5_000_000, anio: 2025 });
  assert.equal(r.base, 0);
  assert.equal(r.topado, 'piso'); // 0 < piso
});

test('smmlvDe: año no confirmado en la tabla → usa el último conocido y marca aproximado', () => {
  const r = smmlvDe(2026);
  assert.equal(r.aproximado, true);
  assert.equal(r.anio, 2025);
  assert.equal(r.valor, SMMLV_2025);
});

test('smmlvDe: año confirmado → aproximado:false', () => {
  const r = smmlvDe(2025);
  assert.equal(r.aproximado, false);
  assert.equal(r.valor, SMMLV_2025);
});

test('calcularAportes: tarifas de salud (12.5%) y pensión (16%) sobre el IBC', () => {
  const r = calcularAportes({ ibc: 3_200_000, smmlv: SMMLV_2025 });
  assert.equal(r.salud, 400_000);
  assert.equal(r.pension, 512_000);
  assert.equal(r.fspAplica, false);
  assert.equal(r.fsp, 0);
  assert.equal(r.total, 912_000);
});

test('calcularAportes: FSP aplica cuando el IBC >= 4 SMMLV', () => {
  const ibc = SMMLV_2025 * 4; // justo en el umbral
  const r = calcularAportes({ ibc, smmlv: SMMLV_2025 });
  assert.equal(r.fspAplica, true);
  assert.equal(r.fsp, ibc * 0.01);
});

test('calcularAportes: FSP NO aplica justo por debajo del umbral (4 SMMLV)', () => {
  const ibc = SMMLV_2025 * 4 - 1;
  const r = calcularAportes({ ibc, smmlv: SMMLV_2025 });
  assert.equal(r.fspAplica, false);
  assert.equal(r.fsp, 0);
});

test('calcularAportes: ARL queda pendiente (no se calcula en esta versión)', () => {
  const r = calcularAportes({ ibc: 3_200_000, smmlv: SMMLV_2025 });
  assert.equal(r.arlPendiente, true);
});

// ---------------------------------------------------------------------------
// reporteAportes — agregación de solo lectura (fake DB, sin red).
// ---------------------------------------------------------------------------

function fakeAportesDb({ ingresos, costos, entidades }) {
  async function query(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.includes('from ingresos')) return ingresos;
    if (t.includes('from costos_actividad')) return costos;
    if (t.includes('from entidades')) return entidades;
    return [];
  }
  return { query };
}

test('reporteAportes: agrega ingresos/costos por persona, calcula IBC y aportes', async () => {
  const db = fakeAportesDb({
    ingresos: [
      { entidad_id: 1, total: 10_000_000 }, // Luis
      { entidad_id: 3, total: 5_000_000 }, // Ahinoa (negocio, no es "persona")
    ],
    costos: [
      { entidad_id: 1, total: 2_000_000 }, // Luis
    ],
    entidades: [
      { id: 1, nombre: 'Luis', tipo: 'persona' },
      { id: 2, nombre: 'Carolina', tipo: 'persona' },
      { id: 3, nombre: 'Ahinoa', tipo: 'negocio' },
    ],
  });
  setSqlForTests(db);

  const r = await reporteAportes({ periodo: '2025-06' });
  assert.equal(r.ok, true);
  assert.equal(r.por_persona.length, 2, 'solo entidades tipo persona (Ahinoa queda fuera)');

  const luis = r.por_persona.find((p) => p.entidad === 'Luis');
  assert.equal(luis.ingresos, 10_000_000);
  assert.equal(luis.costos_deducibles, 2_000_000);
  assert.equal(luis.ibc, 3_200_000);
  assert.equal(luis.ibc_topado, null);
  assert.equal(luis.aportes.salud, 400_000);
  assert.equal(luis.aportes.pension, 512_000);
  assert.equal(luis.aportes.fsp_aplica, false);

  const caro = r.por_persona.find((p) => p.entidad === 'Carolina');
  assert.equal(caro.ingresos, 0);
  assert.equal(caro.costos_deducibles, 0);
  assert.equal(caro.ibc, SMMLV_2025, 'sin ingresos, el IBC se topa al piso (1 SMMLV)');
  assert.equal(caro.ibc_topado, 'piso');

  setSqlForTests(null);
});

test('reporteAportes: sin ninguna entidad tipo persona → lista vacía, no revienta', async () => {
  const db = fakeAportesDb({ ingresos: [], costos: [], entidades: [{ id: 3, nombre: 'Ahinoa', tipo: 'negocio' }] });
  setSqlForTests(db);
  const r = await reporteAportes({ periodo: '2025-06' });
  assert.deepEqual(r.por_persona, []);
  setSqlForTests(null);
});

// ---------------------------------------------------------------------------
// Consolidación de negocios en la base IBC de su dueño (issue #154, decisión
// de Luis: el neto de un negocio como Ahinoa se suma automáticamente a la
// base IBC de la persona propietaria, vía `propietario_id`).
// ---------------------------------------------------------------------------

test('reporteAportes: consolida el neto de un negocio (propietario_id) en la base IBC de su dueño', async () => {
  const db = fakeAportesDb({
    ingresos: [
      { entidad_id: 2, total: 4_000_000 }, // Carolina (propia)
      { entidad_id: 3, total: 5_000_000 }, // Ahinoa (negocio de Carolina)
    ],
    costos: [
      { entidad_id: 3, total: 1_000_000 }, // costos deducibles de Ahinoa
    ],
    entidades: [
      { id: 1, nombre: 'Luis', tipo: 'persona' },
      { id: 2, nombre: 'Carolina', tipo: 'persona' },
      { id: 3, nombre: 'Ahinoa', tipo: 'negocio', propietario_id: 2 },
    ],
  });
  setSqlForTests(db);

  const r = await reporteAportes({ periodo: '2025-06' });
  const caro = r.por_persona.find((p) => p.entidad === 'Carolina');

  // Base consolidada: (4M propios) + (5M − 1M neto de Ahinoa) = 8M.
  assert.equal(caro.ingresos, 9_000_000, 'ingresos propios + ingresos de Ahinoa');
  assert.equal(caro.costos_deducibles, 1_000_000, 'costos deducibles de Ahinoa (Carolina no tenía propios)');
  assert.equal(caro.ibc, calcularIBC({ ingresos: 9_000_000, costosDeducibles: 1_000_000, anio: 2025 }).ibc);

  assert.equal(caro.consolida_negocios.length, 1);
  assert.equal(caro.consolida_negocios[0].entidad, 'Ahinoa');
  assert.equal(caro.consolida_negocios[0].neto, 4_000_000);

  const luis = r.por_persona.find((p) => p.entidad === 'Luis');
  assert.deepEqual(luis.consolida_negocios, [], 'Luis no es dueño de ningún negocio');

  setSqlForTests(null);
});

test('reporteAportes: un negocio sin propietario_id (o sin dueño persona) no se consolida en nadie', async () => {
  const db = fakeAportesDb({
    ingresos: [{ entidad_id: 3, total: 5_000_000 }], // Ahinoa, sin propietario_id
    costos: [],
    entidades: [
      { id: 1, nombre: 'Luis', tipo: 'persona' },
      { id: 2, nombre: 'Carolina', tipo: 'persona' },
      { id: 3, nombre: 'Ahinoa', tipo: 'negocio' },
    ],
  });
  setSqlForTests(db);

  const r = await reporteAportes({ periodo: '2025-06' });
  r.por_persona.forEach((p) => {
    assert.equal(p.ingresos, 0);
    assert.deepEqual(p.consolida_negocios, []);
  });

  setSqlForTests(null);
});
