-- =============================================================================
-- DCDG Finanzas — Esquema contable (Horizonte 1: personal · IBC/renta).
--
-- Se agrega SOBRE el esquema base (sql/schema.sql) sin romperlo. Estas tablas
-- son la base de la captura de ingresos, terceros y entidades para producir la
-- base de aportes IBC y, luego, la hoja de renta. Ver docs/roadmap-contable.md.
--
-- Ejecuta este archivo en el editor SQL de Neon (idempotente: re-ejecutable).
-- Aún no lo consume el código; es la preparación de la Fase 3.1.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Entidades: contribuyentes / negocios / sociedades. Núcleo del multi-entidad.
-- Ej.: Luis (persona), Carolina (persona), Ahinoa (negocio de Carolina).
-- ----------------------------------------------------------------------------
create table if not exists entidades (
  id             bigint generated always as identity primary key,
  nombre         text not null unique,
  tipo           text not null default 'persona',      -- persona | negocio | sociedad
  nit            text,                                  -- NIT / cédula
  pais           text default 'CO',
  moneda         text default 'COP',
  propietario_id bigint references entidades (id),      -- p.ej. Ahinoa → Carolina
  es_menor       boolean default false,
  activo         boolean default true
);

-- ----------------------------------------------------------------------------
-- Terceros: contrapartes (pagadores/proveedores) con NIT. Base de la exógena.
-- ----------------------------------------------------------------------------
create table if not exists terceros (
  id      bigint generated always as identity primary key,
  nombre  text not null,
  nit     text,
  tipo    text,                                         -- cliente | proveedor | empleador | otro
  unique (nombre, nit)
);

-- ----------------------------------------------------------------------------
-- Cuentas bancarias: dónde entra/sale el dinero. El titular es una entidad
-- (incluye las cuentas de ahorro de los hijos usadas para consignar efectivo).
-- ----------------------------------------------------------------------------
create table if not exists cuentas_bancarias (
  id         bigint generated always as identity primary key,
  nombre     text not null,                             -- "Ahorros Luciano", "Nequi Carolina"
  titular_id bigint references entidades (id),
  banco      text,
  numero     text,
  moneda     text default 'COP',
  activo     boolean default true
);

-- ----------------------------------------------------------------------------
-- Ingresos: EL GRAN FALTANTE. Por entidad, cédula, tercero pagador y con la
-- retención en la fuente practicada (anticipo de renta). `actividad` permite
-- agrupar, p.ej., todo lo de "Ahinoa".
-- ----------------------------------------------------------------------------
create table if not exists ingresos (
  id               bigint generated always as identity primary key,
  entidad_id       bigint not null references entidades (id),
  fecha            date not null,
  cedula           text not null,                       -- trabajo | honorarios | no_laboral | capital | dividendos | pension
  concepto         text,
  tercero_id       bigint references terceros (id),
  cuenta_id        bigint references cuentas_bancarias (id),
  monto            numeric(14,2) not null check (monto > 0),
  moneda           text default 'COP',
  retencion_fuente numeric(14,2) default 0,
  actividad        text,                                -- p.ej. 'Ahinoa'
  notas            text,
  origen           text,
  idempotency_key  text unique,
  creado_en        timestamptz not null default now()
);
create index if not exists ingresos_entidad_fecha_idx on ingresos (entidad_id, fecha);
create index if not exists ingresos_cedula_idx        on ingresos (cedula);

-- ----------------------------------------------------------------------------
-- Costos/gastos de una actividad económica (p.ej. Ahinoa: tejedoras, compra de
-- prendas a proveedores) — depuran el ingreso para la base de IBC/renta.
-- Los gastos familiares siguen en `movimientos`; esto es para costos de negocio.
-- ----------------------------------------------------------------------------
create table if not exists costos_actividad (
  id          bigint generated always as identity primary key,
  entidad_id  bigint not null references entidades (id),
  actividad   text,                                     -- 'Ahinoa'
  fecha       date not null,
  concepto    text,
  tercero_id  bigint references terceros (id),
  monto       numeric(14,2) not null check (monto > 0),
  deducible   boolean default true,
  notas       text,
  creado_en   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Usuarios del equipo y su rol (modelo de acceso de primera clase). Aún no
-- reemplaza a FINANZAS_USERS; es la base para roles/alcance por entidad.
-- ----------------------------------------------------------------------------
create table if not exists usuarios (
  id      bigint generated always as identity primary key,
  email   text not null unique,
  nombre  text,
  rol     text not null,                                -- owner | admin_financiero | tesoreria | contador
  pais    text,                                         -- alcance país (CO/US/MX) para contadores
  activo  boolean default true
);

-- ----------------------------------------------------------------------------
-- Semillas (placeholders — el equipo ajusta nombres/NIT con datos reales).
-- ----------------------------------------------------------------------------
insert into entidades (nombre, tipo, pais, moneda) values
  ('Luis',     'persona', 'CO', 'COP'),
  ('Carolina', 'persona', 'CO', 'COP')
on conflict (nombre) do nothing;

-- Ahinoa: negocio informal de Carolina (venta de prendas).
insert into entidades (nombre, tipo, pais, moneda, propietario_id)
select 'Ahinoa', 'negocio', 'CO', 'COP', e.id from entidades e where e.nombre = 'Carolina'
on conflict (nombre) do nothing;

-- Carolina Díaz Granados SAS: sociedad ya constituida (aún no operada). Se deja
-- modelada para cuando se decida canalizar Ahinoa por ella.
insert into entidades (nombre, tipo, pais, moneda, propietario_id)
select 'Carolina Díaz Granados SAS', 'sociedad', 'CO', 'COP', e.id from entidades e where e.nombre = 'Carolina'
on conflict (nombre) do nothing;

insert into usuarios (email, nombre, rol, pais) values
  ('luis@iwin.im',       'Luis',                 'owner',            'CO'),
  ('carodz2@gmail.com',  'Carolina',             'owner',            'CO'),
  ('angela@iwin.im',     'Angela Guerrero',      'admin_financiero', 'CO'),
  ('ma.isabel@iwin.im',  'María Isabel Bolaños', 'tesoreria',        'CO'),
  ('santiago@iwin.im',   'Santiago Rodríguez',   'contador',         'CO')
on conflict (email) do nothing;
