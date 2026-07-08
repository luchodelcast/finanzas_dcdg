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
    'metodo_pago', 'quien_pago', 'tarjeta', 'cuenta_destino', 'notas', 'origen', 'idempotency_key',
    'estado_conciliacion', 'extracto_linea_id'];
  const vals = [m.fecha, m.tipo, m.categoria, m.subcategoria, m.descripcion, m.monto, m.moneda || 'COP',
    m.metodo_pago, m.quien_pago, m.tarjeta, m.cuenta_destino || null, m.notas, m.origen, m.idempotency_key,
    m.estado_conciliacion || 'provisional', m.extracto_linea_id || null];
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
  await ensurePlanCuentasSchema(sqlArg);
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
  await ensurePlanCuentasSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    'select codigo, nombre, clase, naturaleza, cuenta_padre from plan_cuentas where codigo = $1 limit 1',
    [String(codigo || '')]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Ampliación del plan de cuentas (issue #74, Nocturno 3/7, `auto-ok`): más
// rubros de pasivo (obligaciones financieras, CxP a empresas) y activo (CxC a
// empresas), y la opción de agregar cuentas propias desde la pantalla 🏦. El
// plan base vive en sql/plan-cuentas.sql (ya corrido a mano en Neon); esto se
// agrega con DDL/inserts idempotentes en runtime, sin `.sql` manual — mismo
// patrón que ensurePagosFijosSchema. Memoizado.
// ---------------------------------------------------------------------------
let _planCuentasExtraPromise = null;

const PLAN_CUENTAS_EXTRA_SEED = [
  { codigo: '2110', nombre: 'Obligaciones financieras (créditos bancarios/leasing)', clase: 2, naturaleza: 'credito', cuenta_padre: '21' },
  { codigo: '1315', nombre: 'Cuentas por cobrar a empresas/socios', clase: 1, naturaleza: 'debito', cuenta_padre: '13' },
  { codigo: '2340', nombre: 'Cuentas por pagar a empresas/socios', clase: 2, naturaleza: 'credito', cuenta_padre: '23' },
];

/** Crea (si no existe) `plan_cuentas` y agrega las cuentas nuevas del catálogo. Memoizado. */
export async function ensurePlanCuentasSchema(sqlArg) {
  if (!_planCuentasExtraPromise) {
    _planCuentasExtraPromise = aplicarPlanCuentasExtra(sqlArg)
      .catch((e) => { _planCuentasExtraPromise = null; throw e; }); // reintentable si falló
  }
  return _planCuentasExtraPromise;
}

async function aplicarPlanCuentasExtra(sqlArg) {
  const sql = sqlArg || await getSql();
  await sql.query(`
    create table if not exists plan_cuentas (
      codigo       text primary key,
      nombre       text not null,
      clase        int  not null,
      naturaleza   text not null default 'debito',
      cuenta_padre text references plan_cuentas (codigo),
      entidad_id   bigint references entidades (id),
      activo       boolean not null default true,
      creado_en    timestamptz not null default now()
    )
  `, []);
  await sql.query('create index if not exists plan_cuentas_clase_idx on plan_cuentas (clase)', []);
  for (const c of PLAN_CUENTAS_EXTRA_SEED) {
    await sql.query(
      `insert into plan_cuentas (codigo, nombre, clase, naturaleza, cuenta_padre)
       values ($1, $2, $3, $4, $5)
       on conflict (codigo) do nothing`,
      [c.codigo, c.nombre, c.clase, c.naturaleza, c.cuenta_padre]
    );
  }
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a intentar el DDL/seed. */
export function resetPlanCuentasSchemaParaTests() {
  _planCuentasExtraPromise = null;
}

/** Naturaleza contable esperada por clase (1 Activo … 6 Costos). Débito: activo/gasto/costo. */
export function naturalezaDeClase(clase) {
  return [1, 5, 6].includes(Number(clase)) ? 'debito' : 'credito';
}

/** Sugiere el próximo código "hoja" (≥4 dígitos) libre dentro de una clase. */
export async function sugerirCodigoCuenta(clase, sqlArg) {
  await ensurePlanCuentasSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const claseNum = Number(clase);
  const rows = await sql.query(
    'select codigo from plan_cuentas where clase = $1 and length(codigo) >= 4 order by codigo desc limit 1',
    [claseNum]
  );
  const ultimo = rows[0] && rows[0].codigo;
  return ultimo ? String(Number(ultimo) + 5) : `${claseNum}105`;
}

/** Agrega una cuenta nueva de Activo (1) o Pasivo (2) al plan de cuentas (gestión, solo owners). */
export async function insertPlanCuenta({ nombre, clase, cuenta_padre, codigo } = {}, sqlArg) {
  const claseNum = Number(clase);
  if (![1, 2].includes(claseNum)) throw new Error('Solo se pueden agregar cuentas de Activo (1) o Pasivo (2).');
  const nombreLimpio = String(nombre || '').trim();
  if (!nombreLimpio) throw new Error('El nombre de la cuenta es obligatorio.');
  await ensurePlanCuentasSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const cod = codigo || await sugerirCodigoCuenta(claseNum, sql);
  const naturaleza = naturalezaDeClase(claseNum);
  const padre = cuenta_padre || String(claseNum);
  const rows = await sql.query(
    `insert into plan_cuentas (codigo, nombre, clase, naturaleza, cuenta_padre)
     values ($1, $2, $3, $4, $5)
     returning codigo, nombre, clase, naturaleza, cuenta_padre`,
    [cod, nombreLimpio, claseNum, naturaleza, padre]
  );
  return rows[0];
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

/** Renglones de una cuenta en un rango, con fecha/descripción del asiento — Libro Mayor (T5). */
export async function queryLineasCuenta({ cuenta, desde, hasta, entidad_id, limit = 500 } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [cuenta];
  const cond = ['l.cuenta = $1'];
  if (desde) { params.push(desde); cond.push(`a.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`a.fecha <= $${params.length}`); }
  if (entidad_id) { params.push(entidad_id); cond.push(`a.entidad_id = $${params.length}`); }
  params.push(Math.min(Number(limit) || 500, 2000));
  return sql.query(
    `select a.id as asiento_id, a.fecha, a.descripcion, l.debito, l.credito
       from asiento_lineas l join asientos a on a.id = l.asiento_id
      where ${cond.join(' and ')}
      order by a.fecha asc, a.id asc
      limit $${params.length}`, params);
}

/** Σdébito/Σcrédito por cuenta en un rango, con su naturaleza — Balance de Comprobación (T5). */
export async function queryComprobacion({ desde, hasta, entidad_id } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [];
  const cond = [];
  if (desde) { params.push(desde); cond.push(`a.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`a.fecha <= $${params.length}`); }
  if (entidad_id) { params.push(entidad_id); cond.push(`a.entidad_id = $${params.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  return sql.query(
    `select p.codigo, p.nombre, p.clase, p.naturaleza,
            coalesce(sum(l.debito), 0) as debito, coalesce(sum(l.credito), 0) as credito
       from asiento_lineas l
       join asientos a on a.id = l.asiento_id
       join plan_cuentas p on p.codigo = l.cuenta
       ${where}
      group by p.codigo, p.nombre, p.clase, p.naturaleza
      order by p.codigo`, params);
}

// ---------------------------------------------------------------------------
// Contabilización automática (T4): reglas de mapeo + búsquedas de apoyo.
// ---------------------------------------------------------------------------

/** Reglas de mapeo captura → PUC (categoría/cédula/medio → cuenta). */
export async function listReglasContables(sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query('select ambito, clave, cuenta from reglas_contables', []);
}

/** Un movimiento por id (para contabilizarlo). */
export async function getMovimiento(id, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select * from movimientos where id = $1 limit 1', [id]);
  return rows[0] || null;
}

/** Un ingreso por id (para contabilizarlo). */
export async function getIngreso(id, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select * from ingresos where id = $1 limit 1', [id]);
  return rows[0] || null;
}

/** id de una entidad por nombre (p. ej. quien_pago 'Luis'), o null. */
export async function entidadIdPorNombre(nombre, sqlArg) {
  const n = String(nombre || '').trim();
  if (!n) return null;
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select id from entidades where lower(nombre) = lower($1) limit 1', [n]);
  return rows[0] ? rows[0].id : null;
}

/** Movimientos que todavía no tienen asiento (para recontabilizar en lote). */
export async function movimientosSinAsiento({ limit = 500 } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query(
    `select id from movimientos m
      where not exists (select 1 from asiento_lineas l where l.movimiento_id = m.id)
      order by m.fecha, m.id
      limit $1`, [Math.min(Number(limit) || 500, 2000)]);
}

/** Ingresos que todavía no tienen asiento. */
export async function ingresosSinAsiento({ limit = 500 } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query(
    `select id from ingresos i
      where not exists (select 1 from asiento_lineas l where l.ingreso_id = i.id)
      order by i.fecha, i.id
      limit $1`, [Math.min(Number(limit) || 500, 2000)]);
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
    'moneda', 'retencion_fuente', 'actividad', 'notas', 'origen', 'idempotency_key',
    'estado_conciliacion', 'extracto_linea_id'];
  const vals = [i.entidad_id, i.fecha, i.cedula, i.concepto || null, i.tercero_id || null, i.cuenta_id || null,
    i.monto, i.moneda || 'COP', i.retencion_fuente || 0, i.actividad || null, i.notas || null,
    i.origen || null, i.idempotency_key,
    i.estado_conciliacion || 'provisional', i.extracto_linea_id || null];
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

/** Una línea de extracto por id (backfill de `solo_extracto`, issue #72). */
export async function getExtractoLinea(id, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select * from extracto_lineas where id = $1 limit 1', [id]);
  return rows[0] || null;
}

/**
 * Marca una línea de extracto como materializada: el movimiento/ingreso ya se
 * creó (ya nace `conciliado`, ver `insertMovimiento`/`insertIngreso`) y solo
 * falta enlazarlo. Guarda-raíl: solo si la línea sigue `sin_conciliar` (evita
 * re-materializar en una llamada repetida).
 * @returns {Promise<boolean>} true si se marcó, false si ya no estaba `sin_conciliar`.
 */
export async function marcarLineaMaterializada({ linea_id, tipo, id }, sqlArg) {
  const sql = sqlArg || await getSql();
  const col = tipo === 'ingreso' ? 'ingreso_id' : 'movimiento_id';
  const rows = await sql.query(
    `update extracto_lineas set estado = 'conciliado', ${col} = $2
      where id = $1 and estado = 'sin_conciliar'
      returning id`,
    [linea_id, id]
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Pagos del mes (issue #73, Nocturno 2/7, `auto-ok`). Esquema nuevo: en vez de
// un `.sql` que alguien deba correr a mano en Neon, `ensurePagosFijosSchema`
// aplica un DDL idempotente en runtime (create table/index if not exists) la
// primera vez que se usa este módulo — memoizado para no repetirlo en cada
// llamada. Ver AUTOBUILD.md § modo auto-ok.
// ---------------------------------------------------------------------------
// Memoiza la PROMESA (no un booleano): varias llamadas concurrentes (p. ej. el
// Promise.all de listPagosFijos/queryPagosEstadoMes en el handler) deben
// esperar la MISMA corrida del DDL/seed en vez de dispararla varias veces.
let _pagosFijosSchemaPromise = null;

const PAGOS_FIJOS_SEED = [
  { concepto: 'Arriendo', dia_vencimiento: 5, familia: 'DCDG', categoria: 'Vivienda' },
  { concepto: 'Administración', dia_vencimiento: 5, familia: 'DCDG', categoria: 'Vivienda' },
  { concepto: 'Internet Apto', dia_vencimiento: 10, familia: 'DCDG', categoria: 'Servicios' },
  { concepto: 'Claro (celular)', dia_vencimiento: 15, familia: 'DCDG', categoria: 'Servicios' },
  { concepto: 'Tigo (celular)', dia_vencimiento: 15, familia: 'DCDG', categoria: 'Servicios' },
  { concepto: 'Agua', dia_vencimiento: 12, familia: 'DCDG', categoria: 'Servicios' },
  { concepto: 'Energía', dia_vencimiento: 18, familia: 'DCDG', categoria: 'Servicios' },
  { concepto: 'Gas natural', dia_vencimiento: 20, familia: 'DCDG', categoria: 'Servicios' },
  { concepto: 'Colegio Alemán', dia_vencimiento: 5, familia: 'DCDG', categoria: 'Educación' },
  { concepto: 'Extracurriculares', dia_vencimiento: 5, familia: 'DCDG', categoria: 'Educación' },
  { concepto: 'Seguro vehículo', dia_vencimiento: 8, familia: 'DCC', categoria: 'Transporte' },
  { concepto: 'Cuota crédito vehículo', dia_vencimiento: 8, familia: 'DCC', categoria: 'Transporte' },
];

/** Crea (si no existen) `pagos_fijos`/`pagos_estado` y siembra el catálogo conocido. Memoizado. */
export async function ensurePagosFijosSchema(sqlArg) {
  if (!_pagosFijosSchemaPromise) {
    _pagosFijosSchemaPromise = aplicarPagosFijosSchema(sqlArg)
      .catch((e) => { _pagosFijosSchemaPromise = null; throw e; }); // reintentable si falló (p.ej. DB caída)
  }
  return _pagosFijosSchemaPromise;
}

async function aplicarPagosFijosSchema(sqlArg) {
  const sql = sqlArg || await getSql();
  await sql.query(`
    create table if not exists pagos_fijos (
      id serial primary key,
      concepto text not null,
      monto numeric not null default 0,
      dia_vencimiento int not null default 1,
      familia text not null default 'DCDG',
      categoria text,
      moneda text not null default 'COP',
      activo boolean not null default true,
      creado_en timestamptz not null default now()
    )
  `, []);
  await sql.query('create unique index if not exists pagos_fijos_concepto_familia_uk on pagos_fijos (concepto, familia)', []);
  await sql.query(`
    create table if not exists pagos_estado (
      id serial primary key,
      pago_fijo_id bigint not null references pagos_fijos (id),
      anio int not null,
      mes int not null,
      estado text not null default 'pendiente',
      fecha_pago date,
      monto_pagado numeric,
      movimiento_id bigint,
      creado_en timestamptz not null default now(),
      unique (pago_fijo_id, anio, mes)
    )
  `, []);
  for (const p of PAGOS_FIJOS_SEED) {
    await sql.query(
      `insert into pagos_fijos (concepto, monto, dia_vencimiento, familia, categoria)
       values ($1, 0, $2, $3, $4)
       on conflict (concepto, familia) do nothing`,
      [p.concepto, p.dia_vencimiento, p.familia, p.categoria]
    );
  }
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a intentar el DDL/seed. */
export function resetPagosFijosSchemaParaTests() {
  _pagosFijosSchemaPromise = null;
}

/** Catálogo de pagos fijos (activos por default). */
export async function listPagosFijos({ activo = true } = {}, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    activo == null
      ? 'select * from pagos_fijos order by familia, dia_vencimiento, concepto'
      : 'select * from pagos_fijos where activo = $1 order by familia, dia_vencimiento, concepto',
    activo == null ? [] : [!!activo]
  );
  return rows;
}

/** Filas de `pagos_estado` de un (anio, mes) dado. */
export async function queryPagosEstadoMes({ anio, mes }, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  return sql.query('select * from pagos_estado where anio = $1 and mes = $2', [Number(anio), Number(mes)]);
}

/** Agrega un pago fijo nuevo al catálogo (gestión, solo owners). */
export async function insertPagoFijo(p, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `insert into pagos_fijos (concepto, monto, dia_vencimiento, familia, categoria, moneda)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [p.concepto, Number(p.monto) || 0, Number(p.dia_vencimiento) || 1, p.familia || 'DCDG', p.categoria || null, p.moneda || 'COP']
  );
  return rows[0];
}

/** Edita campos de un pago fijo existente (gestión, solo owners). */
export async function updatePagoFijo(id, patch, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `update pagos_fijos set
        concepto = coalesce($2, concepto),
        monto = coalesce($3, monto),
        dia_vencimiento = coalesce($4, dia_vencimiento),
        categoria = coalesce($5, categoria),
        activo = coalesce($6, activo)
      where id = $1
      returning *`,
    [id, patch.concepto ?? null, patch.monto != null ? Number(patch.monto) : null,
      patch.dia_vencimiento != null ? Number(patch.dia_vencimiento) : null,
      patch.categoria ?? null, patch.activo != null ? !!patch.activo : null]
  );
  return rows[0] || null;
}

/** Marca (o actualiza) el pago de un pago fijo en un mes: upsert en `pagos_estado`. */
export async function upsertPagoEstado({ pago_fijo_id, anio, mes, fecha_pago, monto_pagado, movimiento_id }, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `insert into pagos_estado (pago_fijo_id, anio, mes, estado, fecha_pago, monto_pagado, movimiento_id)
     values ($1, $2, $3, 'pagado', $4, $5, $6)
     on conflict (pago_fijo_id, anio, mes) do update
       set estado = 'pagado', fecha_pago = excluded.fecha_pago,
           monto_pagado = excluded.monto_pagado, movimiento_id = excluded.movimiento_id
     returning *`,
    [pago_fijo_id, Number(anio), Number(mes), fecha_pago || null, monto_pagado != null ? Number(monto_pagado) : null, movimiento_id || null]
  );
  return rows[0];
}

/** Desmarca un pago (vuelve a pendiente): borra la fila de `pagos_estado` del mes. */
export async function desmarcarPagoEstado({ pago_fijo_id, anio, mes }, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  await sql.query('delete from pagos_estado where pago_fijo_id = $1 and anio = $2 and mes = $3', [pago_fijo_id, Number(anio), Number(mes)]);
  return true;
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
