-- =============================================================================
-- DCDG Finanzas — Plan de cuentas (PUC simplificado) · T1 del sprint contable.
--
-- Primer pilar de la contabilidad de partida doble (ver
-- docs/plan-partida-doble-jul2026.md). Catálogo de cuentas contra el que se
-- arman los asientos (T2). Es un PUC SIMPLIFICADO para persona natural/familia
-- —no el PUC completo de comercio—; el contador (Santiago) lo afina después.
--
-- Ejecuta este archivo en el editor SQL de Neon (idempotente: re-ejecutable).
-- =============================================================================

create table if not exists plan_cuentas (
  codigo       text primary key,                 -- '1110', '4155', …
  nombre       text not null,
  clase        int  not null,                     -- 1 Activo · 2 Pasivo · 3 Patrimonio · 4 Ingresos · 5 Gastos · 6 Costos
  naturaleza   text not null default 'debito',    -- debito | credito
  cuenta_padre text references plan_cuentas (codigo),
  entidad_id   bigint references entidades (id),  -- null = compartida por todas las entidades
  activo       boolean not null default true,
  creado_en    timestamptz not null default now()
);
create index if not exists plan_cuentas_clase_idx on plan_cuentas (clase);

-- ----------------------------------------------------------------------------
-- Semilla del PUC simplificado. Naturaleza: Activo/Gasto/Costo = debito;
-- Pasivo/Patrimonio/Ingreso = credito. Los códigos siguen la lógica del PUC
-- colombiano para que a Santiago le resulten familiares.
-- ----------------------------------------------------------------------------
insert into plan_cuentas (codigo, nombre, clase, naturaleza, cuenta_padre) values
  -- Clase 1 · ACTIVO
  ('1',    'ACTIVO',                              1, 'debito',  null),
  ('11',   'Disponible',                          1, 'debito',  '1'),
  ('1105', 'Caja (efectivo)',                     1, 'debito',  '11'),
  ('1110', 'Bancos y billeteras',                 1, 'debito',  '11'),
  ('13',   'Deudores',                            1, 'debito',  '1'),
  ('1305', 'Cuentas por cobrar',                  1, 'debito',  '13'),
  ('1310', 'Cuentas por cobrar a sociedades',     1, 'debito',  '13'),  -- p.ej. Delca2
  -- Clase 2 · PASIVO
  ('2',    'PASIVO',                              2, 'credito', null),
  ('21',   'Obligaciones financieras',            2, 'credito', '2'),
  ('2105', 'Tarjetas de crédito por pagar',       2, 'credito', '21'),
  ('23',   'Cuentas por pagar',                   2, 'credito', '2'),
  ('2335', 'Cuentas por pagar',                   2, 'credito', '23'),
  -- Clase 3 · PATRIMONIO
  ('3',    'PATRIMONIO',                          3, 'credito', null),
  ('3105', 'Capital / saldo inicial',             3, 'credito', '3'),
  ('3605', 'Resultado del ejercicio',             3, 'credito', '3'),
  ('3705', 'Resultados acumulados',               3, 'credito', '3'),
  -- Clase 4 · INGRESOS (por cédula de renta)
  ('4',    'INGRESOS',                            4, 'credito', null),
  ('4110', 'Salario (rentas de trabajo)',         4, 'credito', '4'),
  ('4155', 'Honorarios',                          4, 'credito', '4'),
  ('4175', 'Ventas Ahinoa (no laboral)',          4, 'credito', '4'),
  ('4210', 'Arrendamientos (rentas de capital)',  4, 'credito', '4'),
  ('4218', 'Rendimientos financieros',            4, 'credito', '4'),
  ('4235', 'Dividendos',                          4, 'credito', '4'),
  -- Clase 5 · GASTOS (familiares, por categoría)
  ('5',    'GASTOS',                              5, 'debito',  null),
  ('5105', 'Alimentación',                        5, 'debito',  '5'),
  ('5110', 'Transporte',                          5, 'debito',  '5'),
  ('5115', 'Salud',                               5, 'debito',  '5'),
  ('5120', 'Educación',                           5, 'debito',  '5'),
  ('5125', 'Entretenimiento y ocio',              5, 'debito',  '5'),
  ('5130', 'Hogar y servicios',                   5, 'debito',  '5'),
  ('5135', 'Gastos bancarios',                    5, 'debito',  '5'),
  ('5195', 'Otros gastos',                        5, 'debito',  '5'),
  -- Clase 6 · COSTOS (de actividad económica)
  ('6',    'COSTOS',                              6, 'debito',  null),
  ('6205', 'Costo de ventas Ahinoa',              6, 'debito',  '6')
on conflict (codigo) do nothing;
