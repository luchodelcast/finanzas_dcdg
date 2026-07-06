-- =============================================================================
-- DCDG Finanzas — Esquema de conciliación con extractos bancarios.
--
-- El extracto es la FUENTE DE VERDAD FINAL: la captura en tiempo real
-- (SilvIA/PWA/EmailBot/portales) es provisional hasta conciliarse. Ver
-- docs/conciliacion.md. Se agrega SOBRE schema.sql + contable.sql, sin romper.
--
-- Ejecuta en el editor SQL de Neon (idempotente: re-ejecutable). Aún no lo
-- consume el código; es la preparación del motor de conciliación.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Extractos: un extracto cargado de una cuenta/tarjeta para un periodo.
-- ----------------------------------------------------------------------------
create table if not exists extractos (
  id            bigint generated always as identity primary key,
  cuenta        text not null,                          -- nombre de la cuenta/tarjeta
  entidad_id    bigint references entidades (id),
  periodo       text,                                   -- 'YYYY-MM'
  fecha_desde   date,
  fecha_hasta   date,
  saldo_inicial numeric(14,2),
  saldo_final   numeric(14,2),
  moneda        text default 'COP',
  fuente        text,                                   -- pdf | csv | portal | manual
  estado        text default 'cargado',                 -- cargado | conciliado
  creado_en     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Líneas del extracto: cada movimiento que el banco efectivamente registró.
-- Se vincula (si aplica) al movimiento/ingreso capturado que le corresponde.
-- ----------------------------------------------------------------------------
create table if not exists extracto_lineas (
  id            bigint generated always as identity primary key,
  extracto_id   bigint not null references extractos (id) on delete cascade,
  fecha         date not null,
  descripcion   text,
  monto         numeric(14,2) not null,                 -- + crédito / - débito
  tipo          text,                                   -- debito | credito
  referencia    text,
  movimiento_id bigint references movimientos (id),
  ingreso_id    bigint references ingresos (id),
  estado        text default 'sin_conciliar',           -- sin_conciliar | conciliado | solo_extracto
  creado_en     timestamptz not null default now()
);
create index if not exists extracto_lineas_extracto_idx    on extracto_lineas (extracto_id);
create index if not exists extracto_lineas_fecha_monto_idx on extracto_lineas (fecha, monto);

-- ----------------------------------------------------------------------------
-- Estado de conciliación en los registros capturados (provisional por defecto).
-- ----------------------------------------------------------------------------
alter table movimientos add column if not exists estado_conciliacion text default 'provisional';
alter table movimientos add column if not exists extracto_linea_id   bigint references extracto_lineas (id);

alter table ingresos    add column if not exists estado_conciliacion text default 'provisional';
alter table ingresos    add column if not exists extracto_linea_id   bigint references extracto_lineas (id);
