-- =============================================================================
-- DCDG Finanzas — Libro diario (asientos de partida doble) · T2 del sprint contable.
--
-- Segundo pilar de la partida doble (ver docs/plan-partida-doble-jul2026.md).
-- Depende de `plan_cuentas` (T1, sql/plan-cuentas.sql) — cada línea referencia
-- un código de ese catálogo. La validación Σdébito = Σcrédito la hace el código
-- (`_lib/asientos.js`), no un constraint de DB (un asiento se inserta en dos
-- pasos: cabecera + líneas).
--
-- Ejecuta este archivo en el editor SQL de Neon (idempotente: re-ejecutable).
-- =============================================================================

create table if not exists asientos (
  id                 bigint generated always as identity primary key,
  fecha              date not null,
  descripcion        text not null,
  entidad_id         bigint references entidades (id),
  origen             text not null default 'manual',      -- apertura | automatico | manual | ajuste
  estado             text not null default 'contabilizado', -- borrador | contabilizado
  estado_conciliacion text not null default 'provisional',
  idempotency_key    text unique,
  creado_en          timestamptz not null default now()
);
create index if not exists asientos_fecha_idx on asientos (fecha);
create index if not exists asientos_entidad_idx on asientos (entidad_id);

create table if not exists asiento_lineas (
  id            bigint generated always as identity primary key,
  asiento_id    bigint not null references asientos (id),
  cuenta        text not null references plan_cuentas (codigo),
  debito        numeric not null default 0,
  credito       numeric not null default 0,
  tercero_id    bigint references terceros (id),
  movimiento_id bigint,
  ingreso_id    bigint
);
create index if not exists asiento_lineas_asiento_idx on asiento_lineas (asiento_id);
create index if not exists asiento_lineas_cuenta_idx on asiento_lineas (cuenta);
