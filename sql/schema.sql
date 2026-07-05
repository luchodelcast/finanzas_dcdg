-- =============================================================================
-- DCDG Finanzas — Esquema Postgres (Neon). Fuente de verdad del sistema.
--
-- El Google Sheet deja de ser la base de datos y pasa a ser un espejo de
-- exportación. Todo lo transaccional vive aquí y se escribe SOLO por el backend.
--
-- Ejecuta este archivo una vez en el editor SQL de Neon (o `psql < schema.sql`).
-- Es idempotente: se puede volver a correr sin romper nada.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Ledger: todos los movimientos (gasto | pago | factura).
-- ----------------------------------------------------------------------------
create table if not exists movimientos (
  id               bigint generated always as identity primary key,
  fecha            date        not null,
  tipo             text        not null default 'gasto',   -- gasto | pago | factura
  categoria        text,
  subcategoria     text,
  descripcion      text        not null,
  monto            numeric(14,2) not null check (monto > 0),
  metodo_pago      text,
  quien_pago       text,
  tarjeta          text,                                    -- últimos 4
  notas            text,
  origen           text,                                    -- App | SilvIA | EmailBot | ...
  -- Llave de idempotencia: identifica el MISMO evento. UNIQUE + ON CONFLICT
  -- DO NOTHING evita duplicados de forma atómica (inmune a reintentos/carreras).
  idempotency_key  text        unique,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz
);

create index if not exists movimientos_fecha_idx      on movimientos (fecha);
create index if not exists movimientos_categoria_idx  on movimientos (categoria);
create index if not exists movimientos_creado_en_idx  on movimientos (creado_en);

-- ----------------------------------------------------------------------------
-- Movimientos entre empresas y familia (Superlikers/iWin adelanto, Delca2 retiro).
-- Formato equivalente al de la hoja EMPRESAS del monolito.
-- ----------------------------------------------------------------------------
create table if not exists empresas_mov (
  id          bigint generated always as identity primary key,
  empresa     text,                                         -- Superlikers | Delca2
  flujo       text,                                         -- 'Empresa → Familia'
  mes         text,
  anio        int,
  concepto    text,
  titular     text,
  monto       numeric(14,2),
  moneda      text default 'COP',
  estado      text,
  origen      text,
  movimiento_id bigint references movimientos (id) on delete set null,
  creado_en   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Bitácora append-only (auditoría inmutable): quién/qué/cuándo/desde dónde.
-- Nunca se actualiza ni se borra; es la historia del sistema.
-- ----------------------------------------------------------------------------
create table if not exists eventos (
  id        bigint generated always as identity primary key,
  ts        timestamptz not null default now(),
  tipo      text,                                           -- alta | actualizacion | export | duplicado
  origen    text,
  payload   jsonb
);

-- ----------------------------------------------------------------------------
-- Config-como-datos (Fase 1.5): cuentas, reglas y categorías editables sin deploy.
-- Se crean ya para no migrar el esquema después; el código las poblará/leerá luego.
-- ----------------------------------------------------------------------------
create table if not exists cuentas (
  id       bigint generated always as identity primary key,
  nombre   text not null unique,
  tarjeta  text,                                            -- últimos 4
  titular  text,
  tipo     text,                                            -- banco | tarjeta | efectivo
  es_iwin  boolean default false,
  es_delca2 boolean default false,
  activo   boolean default true
);

create table if not exists categorias (
  id           bigint generated always as identity primary key,
  categoria    text not null,
  subcategoria text,
  unique (categoria, subcategoria)
);

create table if not exists reglas (
  id           bigint generated always as identity primary key,
  patron       text not null,                               -- se compara contra la descripción normalizada
  categoria    text not null,
  subcategoria text,
  metodo_pago  text,
  iwin_prestamo boolean default false,
  prioridad    int default 100,
  activo       boolean default true
);
