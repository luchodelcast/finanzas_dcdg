import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reporteRentaAnual } from '../netlify/functions/_lib/renta-anual.js';
import { csvRentaAnual } from '../netlify/functions/_lib/exports.js';

/**
 * Fake mínimo de Postgres combinando entidades + plan de cuentas (para
 * `patrimonioPorPersona`, ver tests/patrimonio.test.js) con ingresos por
 * cédula y costos deducibles (ver tests/aportes.test.js).
 */
function fakeDb({ ingresosCedula, costos, entidades, lineas }) {
  const plan = [
    { codigo: '1110', nombre: 'Bancos y billeteras', clase: 1, naturaleza: 'debito' },
    { codigo: '3105', nombre: 'Capital / saldo inicial', clase: 3, naturaleza: 'credito' },
  ];
  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.includes('group by entidad_id, cedula')) return ingresosCedula;
    if (t.includes('from costos_actividad')) return costos;
    if (t.includes('from ingresos') && t.includes('group by entidad_id')) return []; // total (no lo usa reporteRentaAnual)
    if (t.startsWith('select id, nombre, tipo, pais, moneda from entidades')) return entidades;
    if (t.includes('group by p.codigo, p.nombre, p.clase, p.naturaleza')) {
      let filas = lineas;
      let pi = 0;
      if (t.includes('a.fecha >= $')) { const desde = params[pi++]; filas = filas.filter((l) => l.fecha >= desde); }
      if (t.includes('a.fecha <= $')) { const hasta = params[pi++]; filas = filas.filter((l) => l.fecha <= hasta); }
      if (t.includes('a.entidad_id is null')) { filas = filas.filter((l) => l.entidad_id == null); }
      else if (t.includes('a.entidad_id = $')) { const eid = params[pi++]; filas = filas.filter((l) => l.entidad_id === eid); }
      const totales = new Map();
      for (const l of filas) {
        const cur = totales.get(l.cuenta) || { debito: 0, credito: 0 };
        cur.debito += l.debito; cur.credito += l.credito;
        totales.set(l.cuenta, cur);
      }
      return plan.map((p) => ({ ...p, ...(totales.get(p.codigo) || { debito: 0, credito: 0 }) }));
    }
    return [];
  }
  return { query };
}

const ENTIDADES = [
  { id: 1, nombre: 'Luis', tipo: 'persona', pais: 'CO', moneda: 'COP' },
  { id: 2, nombre: 'Carolina', tipo: 'persona', pais: 'CO', moneda: 'COP' },
  { id: 3, nombre: 'Ahinoa', tipo: 'negocio', pais: 'CO', moneda: 'COP' },
];

const INGRESOS_CEDULA = [
  { entidad_id: 1, cedula: 'trabajo', total: 6_000_000 },
  { entidad_id: 1, cedula: 'honorarios', total: 4_000_000 },
  { entidad_id: 2, cedula: 'dividendos', total: 1_000_000 },
  { entidad_id: 3, cedula: 'no_laboral', total: 9_000_000 }, // Ahinoa (negocio) — queda fuera del reporte
];

const COSTOS = [
  { entidad_id: 1, total: 2_000_000 }, // Luis
];

// Apertura Luis (entidad_id 1): 1.000.000 al 1-ene-2026. Apertura Carolina
// (entidad_id 2): 500.000. Un movimiento posterior al 31-dic-2026 para
// verificar que `hasta` corta correctamente el patrimonio al año pedido.
const LINEAS = [
  { fecha: '2026-01-01', entidad_id: 1, cuenta: '1110', debito: 1000000, credito: 0 },
  { fecha: '2026-01-01', entidad_id: 1, cuenta: '3105', debito: 0, credito: 1000000 },
  { fecha: '2026-01-01', entidad_id: 2, cuenta: '1110', debito: 500000, credito: 0 },
  { fecha: '2026-01-01', entidad_id: 2, cuenta: '3105', debito: 0, credito: 500000 },
  { fecha: '2027-06-01', entidad_id: 1, cuenta: '1110', debito: 500000, credito: 0 },
];

test('reporteRentaAnual: agrupa ingresos por cédula y persona, costos deducibles y patrimonio a 31-dic', async () => {
  const db = fakeDb({ ingresosCedula: INGRESOS_CEDULA, costos: COSTOS, entidades: ENTIDADES, lineas: LINEAS });
  const r = await reporteRentaAnual({ anio: 2026 }, db);

  assert.equal(r.ok, true);
  assert.equal(r.anio, 2026);
  assert.equal(r.por_persona.length, 2, 'solo entidades tipo persona (Ahinoa queda fuera)');

  const luis = r.por_persona.find((p) => p.entidad === 'Luis');
  assert.equal(luis.cedulas.length, 2);
  const trabajo = luis.cedulas.find((c) => c.cedula === 'trabajo');
  assert.equal(trabajo.total, 6_000_000);
  assert.equal(trabajo.label, 'Salario (rentas de trabajo)');
  assert.equal(luis.total_ingresos, 10_000_000);
  assert.equal(luis.costos_deducibles, 2_000_000);
  assert.equal(luis.patrimonio.activo, 1_000_000, 'el movimiento de 2027 no debe contarse (hasta = 2026-12-31)');
  assert.equal(luis.patrimonio.neto, 1_000_000);

  const caro = r.por_persona.find((p) => p.entidad === 'Carolina');
  assert.equal(caro.cedulas.length, 1);
  assert.equal(caro.cedulas[0].cedula, 'dividendos');
  assert.equal(caro.total_ingresos, 1_000_000);
  assert.equal(caro.costos_deducibles, 0);
  assert.equal(caro.patrimonio.neto, 500_000);
});

test('reporteRentaAnual: entidad_id filtra a una sola persona', async () => {
  const db = fakeDb({ ingresosCedula: INGRESOS_CEDULA, costos: COSTOS, entidades: ENTIDADES, lineas: LINEAS });
  const r = await reporteRentaAnual({ anio: 2026, entidad_id: 1 }, db);
  assert.equal(r.por_persona.length, 1);
  assert.equal(r.por_persona[0].entidad, 'Luis');
});

test('reporteRentaAnual: sin año explícito, usa el año de `hoy` (inyectable)', async () => {
  const db = fakeDb({ ingresosCedula: [], costos: [], entidades: ENTIDADES, lineas: [] });
  const r = await reporteRentaAnual({ hoy: new Date(2027, 4, 1) }, db);
  assert.equal(r.anio, 2027);
});

// ---------------------------------------------------------------------------
// csvRentaAnual — función pura (sin fake DB).
// ---------------------------------------------------------------------------

test('csvRentaAnual: una fila por cédula + costos deducibles + patrimonio, por persona', () => {
  const porPersona = [
    {
      anio: 2026,
      entidad: 'Luis',
      cedulas: [
        { cedula: 'trabajo', label: 'Salario (rentas de trabajo)', total: 6_000_000, total_fmt: '$6.000.000' },
        { cedula: 'honorarios', label: 'Honorarios', total: 4_000_000, total_fmt: '$4.000.000' },
      ],
      total_ingresos: 10_000_000, total_ingresos_fmt: '$10.000.000',
      costos_deducibles: 2_000_000, costos_deducibles_fmt: '$2.000.000',
      patrimonio: {
        activo: 1_000_000, pasivo: 0, neto: 1_000_000,
        activo_fmt: '$1.000.000', pasivo_fmt: '$0', neto_fmt: '$1.000.000',
      },
    },
  ];
  const filas = csvRentaAnual(porPersona).split('\r\n');
  assert.equal(filas[0], 'anio,entidad,concepto,monto');
  assert.equal(filas[1], '2026,Luis,trabajo,6000000');
  assert.equal(filas[2], '2026,Luis,honorarios,4000000');
  assert.equal(filas[3], '2026,Luis,costos_deducibles,2000000');
  assert.equal(filas[4], '2026,Luis,patrimonio_activo,1000000');
  assert.equal(filas[5], '2026,Luis,patrimonio_pasivo,0');
  assert.equal(filas[6], '2026,Luis,patrimonio_neto,1000000');
});

test('csvRentaAnual: sin personas → solo encabezado', () => {
  assert.equal(csvRentaAnual([]), 'anio,entidad,concepto,monto');
});
