-- =============================================================================
-- DCDG Finanzas — Libro diario de partida doble (T2 del sprint contable).
--
-- Segundo pilar tras el plan de cuentas (sql/plan-cuentas.sql). Un asiento tiene
-- N renglones (asiento_lineas) y SIEMPRE debe cuadrar: Σ débito = Σ crédito
-- (lo valida el código en _lib/asientos.js antes de insertar).
--
-- Ejecuta este archivo en el editor SQL de Neon (idempotente: re-ejecutable).
-- Requiere que ya exista `plan_cuentas` (correr antes sql/plan-cuentas.sql).
-- =============================================================================

create table if not exists asientos (
  id                  bigint generated always as identity primary key,
  fecha               date not null,
  descripcion         text,
  entidad_id          bigint references entidades (id),
  origen              text not null default 'manual',        -- apertura | automatico | manual | ajuste
  estado              text not null default 'contabilizado', -- borrador | contabilizado
  estado_conciliacion text default 'provisional',            -- provisional | conciliado
  idempotency_key     text unique,
  creado_en           timestamptz not null default now()
);
create index if not exists asientos_fecha_idx  on asientos (fecha);
create index if not exists asientos_origen_idx on asientos (origen);

create table if not exists asiento_lineas (
  id            bigint generated always as identity primary key,
  asiento_id    bigint not null references asientos (id) on delete cascade,
  cuenta        text   not null references plan_cuentas (codigo),
  debito        numeric(16,2) not null default 0,
  credito       numeric(16,2) not null default 0,
  tercero_id    bigint references terceros (id),
  movimiento_id bigint references movimientos (id),          -- origen, si nace de un movimiento
  ingreso_id    bigint references ingresos (id),             -- origen, si nace de un ingreso
  check (debito >= 0 and credito >= 0)
);
create index if not exists asiento_lineas_asiento_idx on asiento_lineas (asiento_id);
create index if not exists asiento_lineas_cuenta_idx  on asiento_lineas (cuenta);
