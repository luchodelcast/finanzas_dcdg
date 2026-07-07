/**
 * _lib/repo.js — Acceso a datos (Postgres). ÚNICA capa que habla con la DB.
 *
 * `finanzas.js` y los handlers dependen de estas funciones, no de SQL suelto.
 * Todas reciben un `sql` inyectable (default: el cliente Neon de db.js) para
 * poder testear sin red pasando un cliente falso con `.query(text, params)`.
 *
 * Se usa la forma parametrizada `sql.query(text, params)` (no template) para
 * poder componer filtros opcionales de forma segura.
 */

import { getSql } from './db.js';
import { normalize } from '../../../app/src/config/rules.js';

/**
 * Inserta un movimiento. Idempotente: si la idempotency_key ya existe, NO crea
 * otra fila (ON CONFLICT DO NOTHING) y devuelve inserted:false con la existente.
 * @returns {Promise<{inserted: boolean, row: object}>}
 */
export async function insertMovimiento(m, sqlArg) {
  const sql = sqlArg || await getSql();
  const cols = ['fecha', 'tipo', 'categoria', 'subcategoria', 'descripcion', 'monto', 'moneda',
    'metodo_pago', 'quien_pago', 'tarjeta', 'cuenta_destino', 'notas', 'origen', 'idempotency_key'];
  const vals = [m.fecha, m.tipo, m.categoria, m.subcategoria, m.descripcion, m.monto, m.moneda || 'COP',
    m.metodo_pago, m.quien_pago, m.tarjeta, m.cuenta_destino || null, m.notas, m.origen, m.idempotency_key];
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const ins = await sql.query(
    `insert into movimientos (${cols.join(', ')}) values (${ph})
     on conflict (idempotency_key) do nothing
     returning *`,
    vals
  );
  if (ins.length) return { inserted: true, row: ins[0] };
  // Colisión: ya existía. Devuelve la fila existente por su llave.
  const prev = await sql.query(
    'select * from movimientos where idempotency_key = $1 limit 1',
    [m.idempotency_key]
  );
  return { inserted: false, row: prev[0] || null };
}

/**
 * Busca un posible duplicado "humano": mismo monto (±1) y comercio (6 chars)
 * dentro de una ventana de ±ventanaDias. Para preguntar antes de escribir cuando
 * el evento no es un reintento exacto (p. ej. re-registrado otro día).
 * @returns {Promise<null | {id, metodo_pago, tarjeta, fecha}>}
 */
export async function findPosibleDuplicado({ fecha, monto, descripcion, ventanaDias = 3 }, sqlArg) {
  const sql = sqlArg || await getSql();
  const m = Number(monto) || 0;
  const desc6 = normalize(descripcion).slice(0, 6);
  if (!fecha || !m || desc6.length < 3) return null;
  const cand = await sql.query(
    `select id, fecha, descripcion, monto, metodo_pago, tarjeta
       from movimientos
      where monto between $1 and $2
        and fecha between ($3::date - ($4 || ' days')::interval) and ($3::date + ($4 || ' days')::interval)
      order by creado_en desc
      limit 40`,
    [m - 1, m + 1, fecha, ventanaDias]
  );
  for (const r of cand) {
    if (normalize(r.descripcion).slice(0, 6) === desc6) {
      return { id: r.id, metodo_pago: (r.metodo_pago || '').trim(), tarjeta: (r.tarjeta || '').trim(), fecha: r.fecha };
    }
  }
  return null;
}

/** Completa cuenta/tarjeta de un movimiento existente (caso "…ah, fue con la 7730"). */
export async function updateMovimientoCuenta(id, { metodo_pago, tarjeta }, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `update movimientos
        set metodo_pago = coalesce(nullif($2,''), metodo_pago),
            tarjeta     = coalesce(nullif($3,''), tarjeta),
            actualizado_en = now()
      where id = $1
      returning *`,
    [id, metodo_pago || '', tarjeta || '']
  );
  return rows[0] || null;
}

/** Inserta un movimiento empresa↔familia (adelanto iWin / retiro Delca2). */
export async function insertEmpresa(e, sqlArg) {
  const sql = sqlArg || await getSql();
  const cols = ['empresa', 'flujo', 'mes', 'anio', 'concepto', 'titular', 'monto',
    'moneda', 'estado', 'origen', 'movimiento_id'];
  const vals = [e.empresa, e.flujo, e.mes, e.anio, e.concepto, e.titular, e.monto,
    e.moneda || 'COP', e.estado, e.origen, e.movimiento_id || null];
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await sql.query(
    `insert into empresas_mov (${cols.join(', ')}) values (${ph}) returning *`, vals
  );
  return rows[0] || null;
}

/** Bitácora append-only. Best-effort: nunca debe tumbar una transacción. */
export async function logEvento(tipo, origen, payload, sqlArg) {
  try {
    const sql = sqlArg || await getSql();
    await sql.query(
      'insert into eventos (tipo, origen, payload) values ($1, $2, $3)',
      [tipo, origen, JSON.stringify(payload || {})]
    );
  } catch (_) { /* la auditoría no bloquea */ }
}

/** Totales y desglose por categoría en un rango. */
export async function queryResumen({ desde, hasta, categoria, quien }, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [desde, hasta];
  // Excluye transferencias (no son gasto) y limita el total a COP (no se mezclan
  // monedas). Los movimientos en USD se ven en la lista, no en el total de gasto.
  let filtro = "fecha >= $1 and fecha <= $2 and coalesce(tipo,'gasto') <> 'transferencia' and coalesce(moneda,'COP') = 'COP'";
  if (categoria) { params.push(`%${categoria.toLowerCase()}%`); filtro += ` and lower(categoria) like $${params.length}`; }
  if (quien) { params.push(`%${quien.toLowerCase()}%`); filtro += ` and lower(coalesce(quien_pago,'')) like $${params.length}`; }
  const agg = await sql.query(
    `select coalesce(sum(monto),0)::float8 as total, count(*)::int as n from movimientos where ${filtro}`,
    params
  );
  const desglose = await sql.query(
    `select coalesce(categoria,'Sin categoría') as categoria, sum(monto)::float8 as monto
       from movimientos where ${filtro}
      group by 1 order by 2 desc`,
    params
  );
  const porDescripcion = await sql.query(
    `select descripcion, sum(monto)::float8 as monto
       from movimientos where ${filtro}
      group by 1 order by 2 desc
      limit 5`,
    params
  );
  return { total: agg[0].total, movimientos: agg[0].n, por_categoria: desglose, por_descripcion: porDescripcion };
}

// ---------------------------------------------------------------------------
// Plan de cuentas (PUC simplificado) — base de la partida doble.
// ---------------------------------------------------------------------------

/** Lista el plan de cuentas activo (opcionalmente filtra por clase 1–6). */
export async function listPlanCuentas({ clase } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [];
  let filtro = 'activo';
  if (clase != null && clase !== '') { params.push(Number(clase)); filtro += ` and clase = $${params.length}`; }
  return sql.query(
    `select codigo, nombre, clase, naturaleza, cuenta_padre
       from plan_cuentas where ${filtro} order by codigo`,
    params
  );
}

/** Devuelve una cuenta del PUC por su código (o null). */
export async function getPlanCuenta(codigo, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    'select codigo, nombre, clase, naturaleza, cuenta_padre from plan_cuentas where codigo = $1 limit 1',
    [String(codigo || '')]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Libro diario de partida doble (asientos) — T2.
// ---------------------------------------------------------------------------

/** Inserta la cabecera de un asiento. Idempotente por idempotency_key. */
export async function insertAsiento(a, sqlArg) {
  const sql = sqlArg || await getSql();
  const cols = ['fecha', 'descripcion', 'entidad_id', 'origen', 'estado', 'estado_conciliacion', 'idempotency_key'];
  const vals = [a.fecha, a.descripcion || null, a.entidad_id || null, a.origen || 'manual',
    a.estado || 'contabilizado', a.estado_conciliacion || 'provisional', a.idempotency_key];
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const ins = await sql.query(
    `insert into asientos (${cols.join(', ')}) values (${ph})
     on conflict (idempotency_key) do nothing returning *`, vals);
  if (ins.length) return { inserted: true, row: ins[0] };
  const prev = await sql.query('select * from asientos where idempotency_key = $1 limit 1', [a.idempotency_key]);
  return { inserted: false, row: prev[0] || null };
}

/** Inserta los renglones de un asiento (una sola sentencia multi-fila). */
export async function insertAsientoLineas(asiento_id, lineas, sqlArg) {
  const sql = sqlArg || await getSql();
  if (!lineas || !lineas.length) return [];
  const cols = ['asiento_id', 'cuenta', 'debito', 'credito', 'tercero_id', 'movimiento_id', 'ingreso_id'];
  const vals = [];
  const groups = lineas.map((l, i) => {
    const base = i * cols.length;
    vals.push(asiento_id, l.cuenta, Number(l.debito) || 0, Number(l.credito) || 0,
      l.tercero_id || null, l.movimiento_id || null, l.ingreso_id || null);
    return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`;
  });
  return sql.query(
    `insert into asiento_lineas (${cols.join(', ')}) values ${groups.join(', ')} returning *`, vals);
}

/** Libro diario: asientos en un rango, cada uno con sus renglones. */
export async function queryAsientos({ desde, hasta, entidad_id, limit = 100 } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [];
  const cond = [];
  if (desde) { params.push(desde); cond.push(`a.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`a.fecha <= $${params.length}`); }
  if (entidad_id) { params.push(entidad_id); cond.push(`a.entidad_id = $${params.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  params.push(Math.min(Number(limit) || 100, 500));
  return sql.query(
    `select a.id, a.fecha, a.descripcion, a.entidad_id, a.origen, a.estado, a.estado_conciliacion,
            coalesce(json_agg(json_build_object('cuenta', l.cuenta, 'debito', l.debito, 'credito', l.credito)
                     order by l.id) filter (where l.id is not null), '[]') as lineas
       from asientos a
       left join asiento_lineas l on l.asiento_id = a.id
       ${where}
      group by a.id
      order by a.fecha desc, a.id desc
      limit $${params.length}`, params);
}

// ---------------------------------------------------------------------------
// Ingresos / entidades / terceros (Horizonte 1 contable).
// ---------------------------------------------------------------------------

/** Entidades activas (Luis, Carolina, Ahinoa, sociedades…). */
export async function listEntidades(sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query('select id, nombre, tipo, pais, moneda from entidades where activo order by tipo, nombre', []);
}

/** Terceros (pagadores/proveedores) para autocompletar. */
export async function listTerceros(sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query('select id, nombre, nit from terceros order by nombre limit 500', []);
}

/** Busca un tercero por nombre (+nit) o lo crea. Devuelve su id (o null). */
export async function findOrCreateTercero({ nombre, nit, tipo }, sqlArg) {
  const sql = sqlArg || await getSql();
  const n = String(nombre || '').trim();
  if (!n) return null;
  const found = await sql.query(
    "select id from terceros where lower(nombre) = lower($1) and coalesce(nit,'') = coalesce($2,'') limit 1",
    [n, nit || null]
  );
  if (found.length) return found[0].id;
  const ins = await sql.query(
    'insert into terceros (nombre, nit, tipo) values ($1, $2, $3) returning id',
    [n, nit || null, tipo || null]
  );
  return ins[0].id;
}

/** Inserta un ingreso (idempotente por idempotency_key). */
export async function insertIngreso(i, sqlArg) {
  const sql = sqlArg || await getSql();
  const cols = ['entidad_id', 'fecha', 'cedula', 'concepto', 'tercero_id', 'cuenta_id', 'monto',
    'moneda', 'retencion_fuente', 'actividad', 'notas', 'origen', 'idempotency_key'];
  const vals = [i.entidad_id, i.fecha, i.cedula, i.concepto || null, i.tercero_id || null, i.cuenta_id || null,
    i.monto, i.moneda || 'COP', i.retencion_fuente || 0, i.actividad || null, i.notas || null,
    i.origen || null, i.idempotency_key];
  const ph = vals.map((_, x) => `$${x + 1}`).join(', ');
  const ins = await sql.query(
    `insert into ingresos (${cols.join(', ')}) values (${ph})
     on conflict (idempotency_key) do nothing returning *`, vals);
  if (ins.length) return { inserted: true, row: ins[0] };
  const prev = await sql.query('select * from ingresos where idempotency_key = $1 limit 1', [i.idempotency_key]);
  return { inserted: false, row: prev[0] || null };
}

/**
 * Totales de ingresos y costos deducibles por entidad, agrupados en un rango
 * de fechas — base del reporte de aportes IBC (Fase 3.2, solo lectura).
 * Devuelve dos listas `{entidad_id, total}` (una por tabla); el llamador las
 * combina con `listEntidades()`.
 */
export async function queryAportesBase({ desde, hasta }, sqlArg) {
  const sql = sqlArg || await getSql();
  const ingresos = await sql.query(
    `select entidad_id, coalesce(sum(monto),0)::float8 as total
       from ingresos
      where fecha >= $1 and fecha <= $2
      group by entidad_id`,
    [desde, hasta]
  );
  const costos = await sql.query(
    `select entidad_id, coalesce(sum(monto),0)::float8 as total
       from costos_actividad
      where deducible = true and fecha >= $1 and fecha <= $2
      group by entidad_id`,
    [desde, hasta]
  );
  return { ingresos, costos };
}

/** Lista ingresos (con nombre de entidad y tercero). */
export async function queryIngresos({ entidad_id, desde, hasta, limit = 50 }, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [];
  const cond = [];
  if (entidad_id) { params.push(entidad_id); cond.push(`i.entidad_id = $${params.length}`); }
  if (desde) { params.push(desde); cond.push(`i.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`i.fecha <= $${params.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  params.push(Math.min(Number(limit) || 50, 500));
  return sql.query(
    `select i.id, i.fecha, i.cedula, i.concepto, i.monto, i.moneda, i.retencion_fuente,
            i.actividad, e.nombre as entidad, t.nombre as tercero
       from ingresos i
       join entidades e on e.id = i.entidad_id
       left join terceros t on t.id = i.tercero_id
       ${where}
      order by i.fecha desc, i.creado_en desc
      limit $${params.length}`, params);
}

// ---------------------------------------------------------------------------
// Extractos bancarios (cargador CSV — fase 1 de conciliación, docs/conciliacion.md).
// ---------------------------------------------------------------------------

/** Inserta un extracto cargado (cabecera). */
export async function insertExtracto(e, sqlArg) {
  const sql = sqlArg || await getSql();
  const cols = ['cuenta', 'entidad_id', 'periodo', 'fecha_desde', 'fecha_hasta',
    'saldo_inicial', 'saldo_final', 'moneda', 'fuente', 'estado'];
  const vals = [e.cuenta, e.entidad_id || null, e.periodo || null, e.fecha_desde || null, e.fecha_hasta || null,
    e.saldo_inicial ?? null, e.saldo_final ?? null, e.moneda || 'COP', e.fuente || 'csv', e.estado || 'cargado'];
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await sql.query(
    `insert into extractos (${cols.join(', ')}) values (${ph}) returning *`, vals
  );
  return rows[0];
}

/** Inserta las líneas de un extracto ya cargado (una sola sentencia multi-fila). */
export async function insertExtractoLineas(extracto_id, lineas, sqlArg) {
  const sql = sqlArg || await getSql();
  if (!lineas || !lineas.length) return [];
  const cols = ['extracto_id', 'fecha', 'descripcion', 'monto', 'tipo', 'referencia'];
  const vals = [];
  const groups = lineas.map((l, i) => {
    const base = i * cols.length;
    vals.push(extracto_id, l.fecha, l.descripcion || null, l.monto, l.tipo || null, l.referencia || null);
    return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`;
  });
  return sql.query(
    `insert into extracto_lineas (${cols.join(', ')}) values ${groups.join(', ')} returning *`, vals
  );
}

/** Lista extractos cargados (con conteo de líneas). */
export async function queryExtractos({ cuenta, limit = 50 } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [];
  const cond = [];
  if (cuenta) { params.push(cuenta); cond.push(`e.cuenta = $${params.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  params.push(Math.min(Number(limit) || 50, 200));
  return sql.query(
    `select e.id, e.cuenta, e.periodo, e.fecha_desde, e.fecha_hasta, e.saldo_inicial, e.saldo_final,
            e.moneda, e.fuente, e.estado, e.creado_en,
            (select count(*) from extracto_lineas l where l.extracto_id = e.id)::int as n_lineas
       from extractos e
       ${where}
      order by e.creado_en desc
      limit $${params.length}`,
    params
  );
}

/** Lista las líneas de un extracto. */
export async function queryExtractoLineas({ extracto_id, limit = 500 } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  if (!extracto_id) return [];
  return sql.query(
    `select id, fecha, descripcion, monto, tipo, referencia, estado
       from extracto_lineas
      where extracto_id = $1
      order by fecha, id
      limit $2`,
    [extracto_id, Math.min(Number(limit) || 500, 2000)]
  );
}

// ---------------------------------------------------------------------------
// Motor de cruce de conciliación (fase 2, docs/conciliacion.md, issue #39).
// Solo lectura salvo `confirmarConciliacion` (la única escritura: siempre a
// pedido explícito del usuario, tras revisar la propuesta).
// ---------------------------------------------------------------------------

/** Un extracto por id (el motor de cruce necesita su rango de fechas). */
export async function getExtracto(id, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select * from extractos where id = $1', [id]);
  return rows[0] || null;
}

/** Movimientos `provisional` dentro de una ventana de fechas (candidatos a conciliar). */
export async function queryMovimientosProvisionales({ desde, hasta }, sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query(
    `select id, fecha, descripcion, monto
       from movimientos
      where coalesce(estado_conciliacion, 'provisional') = 'provisional'
        and fecha between $1 and $2
      order by fecha`,
    [desde, hasta]
  );
}

/** Ingresos `provisional` dentro de una ventana de fechas (candidatos a conciliar). */
export async function queryIngresosProvisionales({ desde, hasta }, sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query(
    `select id, fecha, concepto as descripcion, monto
       from ingresos
      where coalesce(estado_conciliacion, 'provisional') = 'provisional'
        and fecha between $1 and $2
      order by fecha`,
    [desde, hasta]
  );
}

/**
 * Confirma un cruce propuesto (o elegido manualmente ante ambigüedad): marca
 * `conciliado` en la línea del extracto Y en el movimiento/ingreso elegido.
 * Única escritura del motor de conciliación — nunca se llama sola, siempre
 * tras revisión del usuario en la pantalla de conciliación.
 * Guarda-raíles: la línea debe seguir `sin_conciliar` y el capturado debe
 * seguir `provisional` (evita re-conciliar o pisar un cruce ya confirmado).
 */
export async function confirmarConciliacion({ linea_id, tipo, id }, sqlArg) {
  const sql = sqlArg || await getSql();
  const esIngreso = tipo === 'ingreso';

  const lineaRows = await sql.query('select * from extracto_lineas where id = $1', [linea_id]);
  const linea = lineaRows[0];
  if (!linea) throw new Error('Línea de extracto no encontrada');
  if (linea.estado !== 'sin_conciliar') throw new Error('Esa línea ya fue conciliada (o marcada) previamente');

  const capturadoRows = esIngreso
    ? await sql.query('select * from ingresos where id = $1', [id])
    : await sql.query('select * from movimientos where id = $1', [id]);
  const capturado = capturadoRows[0];
  if (!capturado) throw new Error(`${esIngreso ? 'Ingreso' : 'Movimiento'} no encontrado`);
  if ((capturado.estado_conciliacion || 'provisional') !== 'provisional') {
    throw new Error('Ese registro ya no está provisional (¿ya se concilió con otra línea?)');
  }

  if (esIngreso) {
    await sql.query("update extracto_lineas set estado = 'conciliado', ingreso_id = $2 where id = $1", [linea_id, id]);
    await sql.query("update ingresos set estado_conciliacion = 'conciliado', extracto_linea_id = $2 where id = $1", [id, linea_id]);
  } else {
    await sql.query("update extracto_lineas set estado = 'conciliado', movimiento_id = $2 where id = $1", [linea_id, id]);
    await sql.query("update movimientos set estado_conciliacion = 'conciliado', extracto_linea_id = $2 where id = $1", [id, linea_id]);
  }

  return { linea_id, tipo: esIngreso ? 'ingreso' : 'movimiento', id };
}

/** Lista/busca movimientos (para consultas puntuales, SilvIA y dashboard). */
export async function queryMovimientos({ desde, hasta, categoria, quien, texto, limit = 50 }, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [];
  const cond = [];
  if (desde) { params.push(desde); cond.push(`fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`fecha <= $${params.length}`); }
  if (categoria) { params.push(`%${categoria.toLowerCase()}%`); cond.push(`lower(categoria) like $${params.length}`); }
  if (quien) { params.push(`%${quien.toLowerCase()}%`); cond.push(`lower(coalesce(quien_pago,'')) like $${params.length}`); }
  if (texto) { params.push(`%${texto.toLowerCase()}%`); cond.push(`lower(descripcion) like $${params.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  params.push(Math.min(Number(limit) || 50, 500));
  const rows = await sql.query(
    `select id, fecha, tipo, categoria, subcategoria, descripcion, monto, moneda,
            metodo_pago, quien_pago, tarjeta, cuenta_destino, notas, origen, creado_en
       from movimientos ${where}
      order by fecha desc, creado_en desc
      limit $${params.length}`,
    params
  );
  return rows;
}
