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
  const cols = ['fecha', 'tipo', 'categoria', 'subcategoria', 'descripcion', 'monto',
    'metodo_pago', 'quien_pago', 'tarjeta', 'notas', 'origen', 'idempotency_key'];
  const vals = [m.fecha, m.tipo, m.categoria, m.subcategoria, m.descripcion, m.monto,
    m.metodo_pago, m.quien_pago, m.tarjeta, m.notas, m.origen, m.idempotency_key];
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
  let filtro = 'fecha >= $1 and fecha <= $2';
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
  return { total: agg[0].total, movimientos: agg[0].n, por_categoria: desglose };
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
    `select id, fecha, tipo, categoria, subcategoria, descripcion, monto,
            metodo_pago, quien_pago, tarjeta, notas, origen, creado_en
       from movimientos ${where}
      order by fecha desc, creado_en desc
      limit $${params.length}`,
    params
  );
  return rows;
}
