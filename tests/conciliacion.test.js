import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proponerCruces, cuadreExtracto, VENTANA_DIAS_DEFAULT, toISODate } from '../netlify/functions/_lib/conciliacion.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import { confirmarConciliacion } from '../netlify/functions/_lib/repo.js';

// Regresión del bug "Invalid time value": Postgres devuelve `date` como objetos
// Date; hay que normalizarlos a 'YYYY-MM-DD' antes de la ventana de fechas.
test('toISODate: Date, ISO string, YYYY-MM-DD y nulos', () => {
  assert.equal(toISODate(new Date('2026-03-05T00:00:00Z')), '2026-03-05');
  assert.equal(toISODate('2026-03-05T12:34:56.000Z'), '2026-03-05');
  assert.equal(toISODate('2026-03-05'), '2026-03-05');
  assert.equal(toISODate(null), null);
  assert.equal(toISODate(''), null);
  assert.equal(toISODate(new Date('nope')), null);
});

// ---------------------------------------------------------------------------
// proponerCruces — motor puro (issue #39): match / solo_extracto / ambiguo.
// ---------------------------------------------------------------------------

test('proponerCruces: línea débito con un único movimiento provisional compatible → match', () => {
  const lineas = [{ id: 1, fecha: '2026-07-05', descripcion: 'Pago Exito Envigado', monto: -45000 }];
  const movimientos = [{ id: 101, fecha: '2026-07-05', descripcion: 'Éxito Envigado', monto: 45000 }];
  const [p] = proponerCruces(lineas, movimientos, []);
  assert.equal(p.caso, 'match');
  assert.equal(p.tipo_linea, 'debito');
  assert.equal(p.candidatos.length, 1);
  assert.equal(p.candidatos[0].tipo, 'movimiento');
  assert.equal(p.candidatos[0].id, 101);
});

test('proponerCruces: línea crédito con un único ingreso provisional compatible → match', () => {
  const lineas = [{ id: 2, fecha: '2026-07-10', descripcion: 'Consignacion Nomina', monto: 3200000 }];
  const ingresos = [{ id: 201, fecha: '2026-07-11', descripcion: 'Nómina julio', monto: 3200000 }];
  const [p] = proponerCruces(lineas, [], ingresos);
  assert.equal(p.caso, 'match');
  assert.equal(p.tipo_linea, 'credito');
  assert.equal(p.candidatos[0].tipo, 'ingreso');
  assert.equal(p.candidatos[0].id, 201);
});

test('proponerCruces: sin nada capturado que coincida → solo_extracto', () => {
  const lineas = [{ id: 3, fecha: '2026-07-05', descripcion: 'Comision manejo', monto: -12000 }];
  const movimientos = [{ id: 102, fecha: '2026-07-05', descripcion: 'Uber', monto: 18500 }]; // monto no matchea
  const [p] = proponerCruces(lineas, movimientos, []);
  assert.equal(p.caso, 'solo_extracto');
  assert.equal(p.candidatos.length, 0);
});

test('proponerCruces: dos movimientos compatibles → ambiguo (no se auto-resuelve)', () => {
  const lineas = [{ id: 4, fecha: '2026-07-05', descripcion: 'Transferencia', monto: -50000 }];
  const movimientos = [
    { id: 103, fecha: '2026-07-04', descripcion: 'Transferencia a Juan', monto: 50000 },
    { id: 104, fecha: '2026-07-06', descripcion: 'Transferencia a Pedro', monto: 50000 },
  ];
  const [p] = proponerCruces(lineas, movimientos, []);
  assert.equal(p.caso, 'ambiguo');
  assert.equal(p.candidatos.length, 2);
  // Ninguno se descarta ni se elige automáticamente: quedan los dos para que el usuario elija.
  const ids = p.candidatos.map((c) => c.id).sort();
  assert.deepEqual(ids, [103, 104]);
});

test('proponerCruces: monto fuera de tolerancia (±1) no matchea', () => {
  const lineas = [{ id: 5, fecha: '2026-07-05', descripcion: 'Pago', monto: -45000 }];
  const movimientos = [{ id: 105, fecha: '2026-07-05', descripcion: 'Pago', monto: 45005 }];
  const [p] = proponerCruces(lineas, movimientos, []);
  assert.equal(p.caso, 'solo_extracto');
});

test('proponerCruces: monto dentro de tolerancia (±1) sí matchea', () => {
  const lineas = [{ id: 6, fecha: '2026-07-05', descripcion: 'Pago', monto: -45000 }];
  const movimientos = [{ id: 106, fecha: '2026-07-05', descripcion: 'Pago', monto: 45001 }];
  const [p] = proponerCruces(lineas, movimientos, []);
  assert.equal(p.caso, 'match');
});

test('proponerCruces: fecha fuera de la ventana no matchea; dentro de la ventana sí', () => {
  const lineas = [{ id: 7, fecha: '2026-07-05', descripcion: 'Compra', monto: -20000 }];
  const lejos = [{ id: 107, fecha: '2026-07-15', descripcion: 'Compra', monto: 20000 }];
  assert.equal(proponerCruces(lineas, lejos, [])[0].caso, 'solo_extracto');

  const cerca = [{ id: 108, fecha: '2026-07-08', descripcion: 'Compra', monto: 20000 }]; // 3 días
  assert.equal(proponerCruces(lineas, cerca, [])[0].caso, 'match');
  assert.equal(VENTANA_DIAS_DEFAULT, 4);
});

test('proponerCruces: la descripción desempata el orden de candidatos ambiguos (no filtra)', () => {
  // El desempate compara los primeros 6 caracteres normalizados (mismo criterio
  // que repo.findPosibleDuplicado / _lib/dedup.js), no un match difuso de palabras.
  const lineas = [{ id: 8, fecha: '2026-07-05', descripcion: 'UBER Trip centro', monto: -18500 }];
  const movimientos = [
    { id: 109, fecha: '2026-07-05', descripcion: 'Otra cosa', monto: 18500 },
    { id: 110, fecha: '2026-07-05', descripcion: 'Uber trip pago', monto: 18500 },
  ];
  const [p] = proponerCruces(lineas, movimientos, []);
  assert.equal(p.caso, 'ambiguo');
  // El que matchea por descripción (mismos primeros 6 chars) va primero, pero ambos quedan listados.
  assert.equal(p.candidatos[0].id, 110);
  assert.equal(p.candidatos.length, 2);
});

// ---------------------------------------------------------------------------
// cuadreExtracto — cuadre de saldos (issue #100): saldo_inicial + Σ líneas = saldo_final.
// ---------------------------------------------------------------------------

test('cuadreExtracto: cuadra exacto', () => {
  const extracto = { saldo_inicial: 100000, saldo_final: 130000 };
  const lineas = [{ monto: -20000 }, { monto: 50000 }]; // 100000 - 20000 + 50000 = 130000
  const c = cuadreExtracto(extracto, lineas);
  assert.equal(c.saldo_calculado, 130000);
  assert.equal(c.diferencia, 0);
  assert.equal(c.cuadra, true);
});

test('cuadreExtracto: dentro de tolerancia (±1) sigue cuadrando', () => {
  const extracto = { saldo_inicial: 100000, saldo_final: 130001 };
  const lineas = [{ monto: -20000 }, { monto: 50000 }]; // calculado 130000, diferencia -1
  const c = cuadreExtracto(extracto, lineas);
  assert.equal(c.diferencia, -1);
  assert.equal(c.cuadra, true);
});

test('cuadreExtracto: fuera de tolerancia → no cuadra', () => {
  const extracto = { saldo_inicial: 100000, saldo_final: 135000 };
  const lineas = [{ monto: -20000 }, { monto: 50000 }]; // calculado 130000, diferencia -5000
  const c = cuadreExtracto(extracto, lineas);
  assert.equal(c.saldo_calculado, 130000);
  assert.equal(c.diferencia, -5000);
  assert.equal(c.cuadra, false);
});

test('cuadreExtracto: sin saldo_inicial o saldo_final cargado → null (no es error)', () => {
  assert.equal(cuadreExtracto({ saldo_inicial: null, saldo_final: 100000 }, []), null);
  assert.equal(cuadreExtracto({ saldo_inicial: 100000, saldo_final: null }, []), null);
  assert.equal(cuadreExtracto({ saldo_inicial: null, saldo_final: null }, []), null);
  assert.equal(cuadreExtracto(null, []), null);
});

test('cuadreExtracto: incluye TODAS las líneas (conciliadas y no), no solo sin_conciliar', () => {
  const extracto = { saldo_inicial: 0, saldo_final: 15000 };
  const lineas = [
    { monto: 10000 }, // conciliada
    { monto: 5000 },  // sin_conciliar
  ];
  const c = cuadreExtracto(extracto, lineas);
  assert.equal(c.saldo_calculado, 15000);
  assert.equal(c.cuadra, true);
});

// ---------------------------------------------------------------------------
// repo.confirmarConciliacion — única escritura del motor, con Postgres falseado.
// ---------------------------------------------------------------------------

function fakeDb() {
  const extracto_lineas = [
    { id: 1, extracto_id: 9, fecha: '2026-07-05', descripcion: 'Pago Exito', monto: -45000, estado: 'sin_conciliar', movimiento_id: null, ingreso_id: null },
    { id: 2, extracto_id: 9, fecha: '2026-07-10', descripcion: 'Nómina', monto: 3200000, estado: 'sin_conciliar', movimiento_id: null, ingreso_id: null },
    { id: 3, extracto_id: 9, fecha: '2026-07-06', descripcion: 'Ya conciliada', monto: -9000, estado: 'conciliado', movimiento_id: 999, ingreso_id: null },
  ];
  const movimientos = [
    { id: 101, fecha: '2026-07-05', descripcion: 'Éxito', monto: 45000, estado_conciliacion: 'provisional', extracto_linea_id: null },
    { id: 102, fecha: '2026-07-05', descripcion: 'Otro ya conciliado', monto: 9000, estado_conciliacion: 'conciliado', extracto_linea_id: 3 },
  ];
  const ingresos = [
    { id: 201, fecha: '2026-07-11', descripcion: 'Nómina julio', monto: 3200000, estado_conciliacion: 'provisional', extracto_linea_id: null },
  ];

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim();

    if (t.startsWith('select * from extracto_lineas where id')) {
      return extracto_lineas.filter((l) => l.id === params[0]);
    }
    if (t.startsWith('select * from movimientos where id')) {
      return movimientos.filter((m) => m.id === params[0]);
    }
    if (t.startsWith('select * from ingresos where id')) {
      return ingresos.filter((i) => i.id === params[0]);
    }
    if (t.startsWith("update extracto_lineas set estado = 'conciliado', movimiento_id")) {
      const l = extracto_lineas.find((x) => x.id === params[0]);
      if (l) { l.estado = 'conciliado'; l.movimiento_id = params[1]; }
      return [];
    }
    if (t.startsWith("update extracto_lineas set estado = 'conciliado', ingreso_id")) {
      const l = extracto_lineas.find((x) => x.id === params[0]);
      if (l) { l.estado = 'conciliado'; l.ingreso_id = params[1]; }
      return [];
    }
    if (t.startsWith("update movimientos set estado_conciliacion = 'conciliado'")) {
      const m = movimientos.find((x) => x.id === params[0]);
      if (m) { m.estado_conciliacion = 'conciliado'; m.extracto_linea_id = params[1]; }
      return [];
    }
    if (t.startsWith("update ingresos set estado_conciliacion = 'conciliado'")) {
      const i = ingresos.find((x) => x.id === params[0]);
      if (i) { i.estado_conciliacion = 'conciliado'; i.extracto_linea_id = params[1]; }
      return [];
    }
    return [];
  }

  return { query, _extracto_lineas: extracto_lineas, _movimientos: movimientos, _ingresos: ingresos };
}

test('confirmarConciliacion: confirma un cruce con movimiento → marca conciliado en ambos lados', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const r = await confirmarConciliacion({ linea_id: 1, tipo: 'movimiento', id: 101 });
  assert.deepEqual(r, { linea_id: 1, tipo: 'movimiento', id: 101 });
  assert.equal(db._extracto_lineas[0].estado, 'conciliado');
  assert.equal(db._extracto_lineas[0].movimiento_id, 101);
  assert.equal(db._movimientos[0].estado_conciliacion, 'conciliado');
  assert.equal(db._movimientos[0].extracto_linea_id, 1);

  setSqlForTests(null);
});

test('confirmarConciliacion: confirma un cruce con ingreso → marca conciliado en ambos lados', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const r = await confirmarConciliacion({ linea_id: 2, tipo: 'ingreso', id: 201 });
  assert.deepEqual(r, { linea_id: 2, tipo: 'ingreso', id: 201 });
  assert.equal(db._extracto_lineas[1].estado, 'conciliado');
  assert.equal(db._extracto_lineas[1].ingreso_id, 201);
  assert.equal(db._ingresos[0].estado_conciliacion, 'conciliado');
  assert.equal(db._ingresos[0].extracto_linea_id, 2);

  setSqlForTests(null);
});

test('confirmarConciliacion: rechaza si la línea ya estaba conciliada (no re-escribe)', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  await assert.rejects(
    () => confirmarConciliacion({ linea_id: 3, tipo: 'movimiento', id: 101 }),
    /ya fue conciliada/,
  );
  // No debe haber tocado nada.
  assert.equal(db._movimientos[0].estado_conciliacion, 'provisional');

  setSqlForTests(null);
});

test('confirmarConciliacion: rechaza si el movimiento elegido ya no está provisional', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  await assert.rejects(
    () => confirmarConciliacion({ linea_id: 1, tipo: 'movimiento', id: 102 }),
    /ya no está provisional/,
  );
  assert.equal(db._extracto_lineas[0].estado, 'sin_conciliar', 'no debe haber marcado la línea');

  setSqlForTests(null);
});

test('confirmarConciliacion: rechaza si la línea o el capturado no existen', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  await assert.rejects(() => confirmarConciliacion({ linea_id: 999, tipo: 'movimiento', id: 101 }), /no encontrada/);
  await assert.rejects(() => confirmarConciliacion({ linea_id: 1, tipo: 'movimiento', id: 999 }), /no encontrado/);

  setSqlForTests(null);
});
