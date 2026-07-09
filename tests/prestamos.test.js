import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularSaldoPrestamos, buildLineasPrestamo, contabilizarPrestamo, contabilizarSaldoPrestamo,
  registrarPrestamoConAsiento, marcarSaldadoConAsiento, registrarPagoDeOtro,
  CUENTA_CXC_SOCIOS, CUENTA_CXP_SOCIOS,
} from '../netlify/functions/_lib/prestamos.js';
import { validarAsiento } from '../netlify/functions/_lib/asientos.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import {
  ensurePrestamosSchema, resetPrestamosSchemaParaTests, listPrestamos, insertPrestamo, marcarPrestamoSaldado,
  getPrestamo,
} from '../netlify/functions/_lib/repo.js';

// ---------------------------------------------------------------------------
// calcularSaldoPrestamos — pura.
// ---------------------------------------------------------------------------
test('calcularSaldoPrestamos: Luis→Carolina neto positivo → Carolina debe', () => {
  const r = calcularSaldoPrestamos([{ de: 'Luis', para: 'Carolina', monto: 100, moneda: 'COP', saldado: false }]);
  assert.deepEqual(r, [{ moneda: 'COP', neto: 100, deudor: 'Carolina' }]);
});

test('calcularSaldoPrestamos: Carolina→Luis neto negativo → Luis debe', () => {
  const r = calcularSaldoPrestamos([{ de: 'Carolina', para: 'Luis', monto: 40, moneda: 'COP', saldado: false }]);
  assert.deepEqual(r, [{ moneda: 'COP', neto: 40, deudor: 'Luis' }]);
});

test('calcularSaldoPrestamos: un abono (sentido inverso) reduce el neto', () => {
  const r = calcularSaldoPrestamos([
    { de: 'Luis', para: 'Carolina', monto: 100, moneda: 'COP', saldado: false },
    { de: 'Carolina', para: 'Luis', monto: 30, moneda: 'COP', saldado: false }, // abono
  ]);
  assert.deepEqual(r, [{ moneda: 'COP', neto: 70, deudor: 'Carolina' }]);
});

test('calcularSaldoPrestamos: préstamo saldado no cuenta para el neto', () => {
  const r = calcularSaldoPrestamos([
    { de: 'Luis', para: 'Carolina', monto: 100, moneda: 'COP', saldado: true },
    { de: 'Luis', para: 'Carolina', monto: 20, moneda: 'COP', saldado: false },
  ]);
  assert.deepEqual(r, [{ moneda: 'COP', neto: 20, deudor: 'Carolina' }]);
});

test('calcularSaldoPrestamos: neto en 0 → deudor null (a paz y salvo)', () => {
  const r = calcularSaldoPrestamos([
    { de: 'Luis', para: 'Carolina', monto: 50, moneda: 'COP', saldado: false },
    { de: 'Carolina', para: 'Luis', monto: 50, moneda: 'COP', saldado: false },
  ]);
  assert.deepEqual(r, [{ moneda: 'COP', neto: 0, deudor: null }]);
});

test('calcularSaldoPrestamos: agrupa por moneda por separado', () => {
  const r = calcularSaldoPrestamos([
    { de: 'Luis', para: 'Carolina', monto: 100, moneda: 'COP', saldado: false },
    { de: 'Carolina', para: 'Luis', monto: 10, moneda: 'USD', saldado: false },
  ]);
  assert.deepEqual(r.find((s) => s.moneda === 'COP'), { moneda: 'COP', neto: 100, deudor: 'Carolina' });
  assert.deepEqual(r.find((s) => s.moneda === 'USD'), { moneda: 'USD', neto: 10, deudor: 'Luis' });
});

test('calcularSaldoPrestamos: sin préstamos → []', () => {
  assert.deepEqual(calcularSaldoPrestamos([]), []);
});

// ---------------------------------------------------------------------------
// buildLineasPrestamo — pura (issue #116). Débito/crédito 1315/2340 según
// dirección, siempre cuadrado.
// ---------------------------------------------------------------------------
const CUENTAS_PUC = new Set([CUENTA_CXC_SOCIOS, CUENTA_CXP_SOCIOS, '1105', '1110', '5195']);

test('buildLineasPrestamo: de=Luis → débito 1315 (CxC) / crédito 2340 (CxP), y cuadra', () => {
  const l = buildLineasPrestamo({ de: 'Luis', para: 'Carolina', monto: 100000 });
  assert.deepEqual(l, [
    { cuenta: CUENTA_CXC_SOCIOS, debito: 100000, credito: 0 },
    { cuenta: CUENTA_CXP_SOCIOS, debito: 0, credito: 100000 },
  ]);
  assert.equal(validarAsiento(l, CUENTAS_PUC).ok, true);
});

test('buildLineasPrestamo: de=Carolina → sentido inverso (mismo par de cuentas)', () => {
  const l = buildLineasPrestamo({ de: 'Carolina', para: 'Luis', monto: 40000 });
  assert.deepEqual(l, [
    { cuenta: CUENTA_CXP_SOCIOS, debito: 40000, credito: 0 },
    { cuenta: CUENTA_CXC_SOCIOS, debito: 0, credito: 40000 },
  ]);
  assert.equal(validarAsiento(l, CUENTAS_PUC).ok, true);
});

test('buildLineasPrestamo: monto inválido → lanza', () => {
  assert.throws(() => buildLineasPrestamo({ de: 'Luis', monto: 0 }), /monto inválido/);
});

test('buildLineasPrestamo: un préstamo y su abono inverso nettean a cero por cuenta (consistente con calcularSaldoPrestamos)', () => {
  const prestamo = buildLineasPrestamo({ de: 'Luis', para: 'Carolina', monto: 100 });
  const abono = buildLineasPrestamo({ de: 'Carolina', para: 'Luis', monto: 30 });
  const neto = {};
  for (const l of [...prestamo, ...abono]) {
    neto[l.cuenta] = (neto[l.cuenta] || 0) + (l.debito - l.credito);
  }
  // Igual que calcularSaldoPrestamos([{Luis→Carolina,100},{Carolina→Luis,30}]) → neto 70, Carolina debe.
  assert.equal(neto[CUENTA_CXC_SOCIOS], 70);
  assert.equal(neto[CUENTA_CXP_SOCIOS], -70);
});

// ---------------------------------------------------------------------------
// Capa de datos — Postgres falseado. Verifica el DDL idempotente en runtime
// (modo auto-ok), las operaciones de escritura y la integración con el libro
// de partida doble (crearAsiento/asiento_lineas/plan de cuentas).
// ---------------------------------------------------------------------------
const REGLAS_BASE = [
  { ambito: 'categoria', clave: 'default', cuenta: '5195' },
  { ambito: 'medio', clave: 'efectivo', cuenta: '1105' },
  { ambito: 'medio', clave: 'default', cuenta: '1110' },
];
const PLAN_BASE = [
  { codigo: CUENTA_CXC_SOCIOS, nombre: 'CxC socios', clase: 1, naturaleza: 'debito', cuenta_padre: '13' },
  { codigo: CUENTA_CXP_SOCIOS, nombre: 'CxP socios', clase: 2, naturaleza: 'credito', cuenta_padre: '23' },
  { codigo: '1105', nombre: 'Caja', clase: 1, naturaleza: 'debito', cuenta_padre: '11' },
  { codigo: '1110', nombre: 'Bancos', clase: 1, naturaleza: 'debito', cuenta_padre: '11' },
  { codigo: '5195', nombre: 'Otros gastos', clase: 5, naturaleza: 'debito', cuenta_padre: '51' },
];

/** Fake DB completo: prestamos + movimientos + plan de cuentas + asientos/asiento_lineas. */
function fakeDbCompleta({ reglas = REGLAS_BASE, plan = PLAN_BASE } = {}) {
  const prestamos = [];
  const movimientos = [];
  const asientos = [];
  const asientoLineas = [];
  let nextPrestamoId = 1;
  let nextMovId = 1;
  let seqAsiento = 0;
  const ddlCalls = [];

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (t.startsWith('create table') || t.startsWith('create index') || t.startsWith('alter table')) {
      ddlCalls.push(t);
      return [];
    }

    // --- prestamos ---------------------------------------------------------
    if (t.startsWith('insert into prestamos') && params.length === 8) {
      const [fecha, de, para, monto, concepto, moneda, notas, idempotency_key] = params;
      if (prestamos.some((p) => p.idempotency_key === idempotency_key)) return [];
      const row = { id: nextPrestamoId++, fecha, de, para, monto, concepto, moneda, saldado: false, notas, idempotency_key, contab_version: 1 };
      prestamos.push(row);
      return [row];
    }
    if (t.startsWith('insert into prestamos')) {
      const [fecha, de, para, monto, concepto, moneda, notas] = params;
      const row = { id: nextPrestamoId++, fecha, de, para, monto, concepto, moneda, saldado: false, notas, idempotency_key: null, contab_version: 1 };
      prestamos.push(row);
      return [row];
    }
    if (t.startsWith('select * from prestamos where idempotency_key')) {
      return prestamos.filter((p) => p.idempotency_key === params[0]).slice(0, 1);
    }
    if (t.startsWith('select * from prestamos where id')) {
      return prestamos.filter((p) => p.id === Number(params[0])).slice(0, 1);
    }
    if (t.startsWith('select * from prestamos where saldado')) {
      return prestamos.filter((p) => p.saldado === params[0]);
    }
    if (t.startsWith('select * from prestamos order')) {
      return prestamos.slice();
    }
    if (t.startsWith('update prestamos set saldado')) {
      const [id, saldado] = params;
      const row = prestamos.find((p) => p.id === Number(id));
      if (!row) return [];
      row.saldado = saldado;
      row.contab_version = (row.contab_version || 1) + 1;
      return [row];
    }

    // --- movimientos (solo lo que toca contabilizarMovimiento) --------------
    if (t.startsWith('insert into movimientos')) {
      const [fecha, tipo, categoria, subcategoria, descripcion, monto, moneda, metodo_pago, quien_pago,
        tarjeta, cuenta_destino, notas, origen, idempotency_key] = params;
      if (movimientos.some((m) => m.idempotency_key === idempotency_key)) return [];
      const row = {
        id: nextMovId++, fecha, tipo, categoria, subcategoria, descripcion, monto, moneda, metodo_pago,
        quien_pago, tarjeta, cuenta_destino, notas, origen, idempotency_key,
      };
      movimientos.push(row);
      return [row];
    }
    if (t.startsWith('select * from movimientos where idempotency_key')) {
      return movimientos.filter((m) => m.idempotency_key === params[0]).slice(0, 1);
    }
    if (t.startsWith('select * from movimientos where id')) {
      return movimientos.filter((m) => m.id === Number(params[0])).slice(0, 1);
    }

    // --- reglas / cuentas_meta / entidades (best-effort, vacías por defecto) --
    if (t.startsWith('select ambito, clave, cuenta from reglas_contables')) return reglas;
    if (t.includes('from cuentas_meta')) return [];
    if (t.startsWith('select id from entidades where lower(nombre)')) return [];

    // --- plan de cuentas -----------------------------------------------------
    if (t.startsWith('select codigo, nombre, clase')) return plan;

    // --- asientos / asiento_lineas ---------------------------------------
    if (t.startsWith('insert into asientos')) {
      const key = params[6];
      if (asientos.some((a) => a.idempotency_key === key)) return [];
      const row = { id: ++seqAsiento, fecha: params[0], descripcion: params[1], entidad_id: params[2], origen: params[3], idempotency_key: key };
      asientos.push(row);
      return [row];
    }
    if (t.startsWith('select * from asientos where idempotency_key')) {
      return asientos.filter((a) => a.idempotency_key === params[0]).slice(0, 1);
    }
    if (t.startsWith('select a.id, a.fecha, a.descripcion, a.entidad_id')) {
      const a = asientos.find((x) => x.idempotency_key === params[0]);
      if (!a) return [];
      const ls = asientoLineas.filter((l) => l.asiento_id === a.id).map((l) => ({ cuenta: l.cuenta, debito: l.debito, credito: l.credito }));
      return [{ id: a.id, fecha: a.fecha, descripcion: a.descripcion, entidad_id: a.entidad_id, lineas: ls }];
    }
    if (t.startsWith('insert into asiento_lineas')) {
      const cols = 7;
      for (let i = 0; i < params.length; i += cols) {
        asientoLineas.push({ asiento_id: params[i], cuenta: params[i + 1], debito: params[i + 2], credito: params[i + 3] });
      }
      return [];
    }
    return [];
  }

  return {
    query, _prestamos: prestamos, _movimientos: movimientos, _asientos: asientos, _asientoLineas: asientoLineas, _ddlCalls: ddlCalls,
  };
}

test('ensurePrestamosSchema: crea la tabla, memoizado (no repite el DDL)', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  setSqlForTests(db);

  await ensurePrestamosSchema();
  const ddlTrasPrimera = db._ddlCalls.length;
  assert.ok(ddlTrasPrimera > 0);

  await ensurePrestamosSchema(); // segunda llamada: no debe repetir el DDL
  assert.equal(db._ddlCalls.length, ddlTrasPrimera);

  setSqlForTests(null);
  resetPrestamosSchemaParaTests();
});

test('ensurePrestamosSchema: llamadas concurrentes (Promise.all) corren el DDL una sola vez', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  setSqlForTests(db);

  await Promise.all([ensurePrestamosSchema(), ensurePrestamosSchema(), ensurePrestamosSchema()]);
  const trasConcurrentes = db._ddlCalls.length;
  assert.ok(trasConcurrentes > 0);

  await ensurePrestamosSchema(); // ya resuelto: no debe agregar más sentencias DDL
  assert.equal(db._ddlCalls.length, trasConcurrentes);

  setSqlForTests(null);
  resetPrestamosSchemaParaTests();
});

test('insertPrestamo: registra un préstamo válido', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  setSqlForTests(db);

  const p = await insertPrestamo({ fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 100, concepto: 'Mercado' });
  assert.equal(p.de, 'Luis');
  assert.equal(p.para, 'Carolina');
  assert.equal(p.monto, 100);

  setSqlForTests(null);
  resetPrestamosSchemaParaTests();
});

test('insertPrestamo: rechaza personas inválidas, misma persona, y monto <= 0', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  setSqlForTests(db);

  await assert.rejects(() => insertPrestamo({ fecha: '2026-07-08', de: 'Luis', para: 'Santiago', monto: 100 }), /Luis.*Carolina/);
  await assert.rejects(() => insertPrestamo({ fecha: '2026-07-08', de: 'Luis', para: 'Luis', monto: 100 }), /misma persona/);
  await assert.rejects(() => insertPrestamo({ fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 0 }), /mayor a 0/);

  setSqlForTests(null);
  resetPrestamosSchemaParaTests();
});

test('insertPrestamo: con idempotency_key, un reintento no duplica y devuelve la fila existente', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  setSqlForTests(db);

  const datos = { fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 100, idempotency_key: 'k1' };
  const p1 = await insertPrestamo(datos);
  const p2 = await insertPrestamo(datos);
  assert.equal(p1.id, p2.id);
  assert.equal(db._prestamos.length, 1);

  setSqlForTests(null);
  resetPrestamosSchemaParaTests();
});

test('listPrestamos / marcarPrestamoSaldado: filtra por saldado, actualiza y versiona (contab_version)', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  setSqlForTests(db);

  const p = await insertPrestamo({ fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 100 });
  assert.equal((await listPrestamos({ saldado: false })).length, 1);
  assert.equal((await listPrestamos({ saldado: true })).length, 0);

  const actualizado = await marcarPrestamoSaldado(p.id, true);
  assert.equal(actualizado.saldado, true);
  assert.equal(actualizado.contab_version, 2); // transición real → versiona
  assert.equal((await listPrestamos({ saldado: true })).length, 1);
  assert.equal((await listPrestamos({ saldado: false })).length, 0);

  // Marcar de nuevo el mismo estado no es una transición: no versiona.
  const sinCambio = await marcarPrestamoSaldado(p.id, true);
  assert.equal(sinCambio.contab_version, 2);

  setSqlForTests(null);
  resetPrestamosSchemaParaTests();
});

// ---------------------------------------------------------------------------
// Integración con el libro de partida doble (issue #116).
// ---------------------------------------------------------------------------
test('contabilizarPrestamo: crea el asiento 1315/2340, cuadrado y con la cuenta correcta según dirección', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();

  const p = await insertPrestamo({ fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 100000 }, db);
  const r = await contabilizarPrestamo(p.id, db);
  assert.equal(r.registrado, true);
  assert.equal(db._asientos.length, 1);
  assert.equal(db._asientos[0].entidad_id, null);
  const lineas = db._asientoLineas.filter((l) => l.asiento_id === db._asientos[0].id);
  assert.deepEqual(lineas.map((l) => [l.cuenta, l.debito, l.credito]).sort(), [
    [CUENTA_CXC_SOCIOS, 100000, 0],
    [CUENTA_CXP_SOCIOS, 0, 100000],
  ].sort());

  resetPrestamosSchemaParaTests();
});

test('contabilizarPrestamo: idempotente (dos veces el mismo préstamo no duplica el asiento)', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  const p = await insertPrestamo({ fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 50000 }, db);
  await contabilizarPrestamo(p.id, db);
  await contabilizarPrestamo(p.id, db);
  assert.equal(db._asientos.length, 1);
  resetPrestamosSchemaParaTests();
});

test('registrarPrestamoConAsiento: registra el préstamo y lo contabiliza en un solo paso', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  const p = await registrarPrestamoConAsiento({ fecha: '2026-07-08', de: 'Carolina', para: 'Luis', monto: 40000 }, db);
  assert.ok(p.id);
  assert.equal(db._asientos.length, 1);
  const lineas = db._asientoLineas.filter((l) => l.asiento_id === db._asientos[0].id);
  // de=Carolina → débito 2340 / crédito 1315.
  assert.deepEqual(lineas.map((l) => [l.cuenta, l.debito, l.credito]).sort(), [
    [CUENTA_CXC_SOCIOS, 0, 40000],
    [CUENTA_CXP_SOCIOS, 40000, 0],
  ].sort());
  resetPrestamosSchemaParaTests();
});

test('marcarSaldadoConAsiento: al saldar, reversa el asiento — el mayor de 1315/2340 vuelve a 0 (coincide con el neto)', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  const p = await registrarPrestamoConAsiento({ fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 100000 }, db);

  await marcarSaldadoConAsiento(p.id, true, db);
  assert.equal(db._asientos.length, 2); // original + reverso

  const netoPorCuenta = {};
  for (const l of db._asientoLineas) netoPorCuenta[l.cuenta] = (netoPorCuenta[l.cuenta] || 0) + (l.debito - l.credito);
  assert.equal(netoPorCuenta[CUENTA_CXC_SOCIOS], 0);
  assert.equal(netoPorCuenta[CUENTA_CXP_SOCIOS], 0);

  const actualizado = await getPrestamo(p.id, db);
  assert.equal(actualizado.saldado, true);

  resetPrestamosSchemaParaTests();
});

test('marcarSaldadoConAsiento: reabrir (saldado→false) vuelve a dejar el neto igual al monto original', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  const p = await registrarPrestamoConAsiento({ fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 100000 }, db);

  await marcarSaldadoConAsiento(p.id, true, db);
  await marcarSaldadoConAsiento(p.id, false, db);
  assert.equal(db._asientos.length, 3); // original + reverso + reapertura

  const netoPorCuenta = {};
  for (const l of db._asientoLineas) netoPorCuenta[l.cuenta] = (netoPorCuenta[l.cuenta] || 0) + (l.debito - l.credito);
  assert.equal(netoPorCuenta[CUENTA_CXC_SOCIOS], 100000);
  assert.equal(netoPorCuenta[CUENTA_CXP_SOCIOS], -100000);

  resetPrestamosSchemaParaTests();
});

test('marcarSaldadoConAsiento: marcar el mismo estado dos veces no crea un segundo asiento de ajuste', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  const p = await registrarPrestamoConAsiento({ fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 100000 }, db);

  await marcarSaldadoConAsiento(p.id, true, db);
  await marcarSaldadoConAsiento(p.id, true, db); // sin transición
  assert.equal(db._asientos.length, 2); // original + un solo reverso

  resetPrestamosSchemaParaTests();
});

test('marcarSaldadoConAsiento: préstamo inexistente → null', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  const r = await marcarSaldadoConAsiento(9999, true, db);
  assert.equal(r, null);
  resetPrestamosSchemaParaTests();
});

test('contabilizarSaldoPrestamo: usa contab_version en la llave de idempotencia del ajuste', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  const prestamo = { id: 7, fecha: '2026-07-08', de: 'Luis', para: 'Carolina', monto: 100, saldado: true, contab_version: 3 };
  await contabilizarSaldoPrestamo(prestamo, db);
  assert.equal(db._asientos[0].idempotency_key, 'prestamo:7:saldo:v3');
  resetPrestamosSchemaParaTests();
});

// ---------------------------------------------------------------------------
// registrarPagoDeOtro — "pagar con mi plata algo del otro" (issue #116).
// ---------------------------------------------------------------------------
test('registrarPagoDeOtro: registra el pago (atribuido al deudor) y el préstamo, ambos contabilizados', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();

  const r = await registrarPagoDeOtro({
    fecha: '2026-07-08', pagador: 'Luis', deudor: 'Carolina', monto: 80000,
    metodo_pago: 'Efectivo', concepto: 'Tarjeta de Carolina',
  }, db);

  assert.equal(r.ok, true);
  assert.ok(r.movimiento.id);
  assert.ok(r.prestamo.id);
  assert.equal(r.prestamo.de, 'Luis');
  assert.equal(r.prestamo.para, 'Carolina');
  assert.equal(db._movimientos.length, 1);
  assert.equal(db._prestamos.length, 1);
  // 2 asientos: el del movimiento (gasto/medio) + el del préstamo (1315/2340).
  assert.equal(db._asientos.length, 2);

  const lineasPrestamo = db._asientoLineas.filter((l) => l.asiento_id === db._asientos[1].id);
  assert.deepEqual(lineasPrestamo.map((l) => [l.cuenta, l.debito, l.credito]).sort(), [
    [CUENTA_CXC_SOCIOS, 80000, 0],
    [CUENTA_CXP_SOCIOS, 0, 80000],
  ].sort());

  resetPrestamosSchemaParaTests();
});

test('registrarPagoDeOtro: reintentar con los mismos datos no duplica ni el pago ni el préstamo', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();

  const datos = {
    fecha: '2026-07-08', pagador: 'Luis', deudor: 'Carolina', monto: 80000,
    metodo_pago: 'Efectivo', concepto: 'Tarjeta de Carolina',
  };
  await registrarPagoDeOtro(datos, db);
  const r2 = await registrarPagoDeOtro(datos, db);

  assert.equal(r2.ya_existia, true);
  assert.equal(db._movimientos.length, 1);
  assert.equal(db._prestamos.length, 1);
  assert.equal(db._asientos.length, 2);

  resetPrestamosSchemaParaTests();
});

test('registrarPagoDeOtro: rechaza personas inválidas, misma persona, monto <= 0 y metodo_pago faltante', async () => {
  resetPrestamosSchemaParaTests();
  const db = fakeDbCompleta();
  const base = { fecha: '2026-07-08', pagador: 'Luis', deudor: 'Carolina', monto: 1000, metodo_pago: 'Efectivo' };

  await assert.rejects(() => registrarPagoDeOtro({ ...base, deudor: 'Santiago' }, db), /Luis.*Carolina/);
  await assert.rejects(() => registrarPagoDeOtro({ ...base, deudor: 'Luis' }, db), /misma persona/);
  await assert.rejects(() => registrarPagoDeOtro({ ...base, monto: 0 }, db), /mayor a 0/);
  await assert.rejects(() => registrarPagoDeOtro({ ...base, metodo_pago: '' }, db), /metodo_pago/);

  resetPrestamosSchemaParaTests();
});
