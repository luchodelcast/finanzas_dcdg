-- =============================================================================
-- DCDG Finanzas — Reglas de contabilización automática (T4 del sprint contable).
--
-- Mapea categoría (gastos) y cédula (ingresos) a su cuenta del PUC simplificado
-- (sql/plan-cuentas.sql), para que `_lib/contabilizar.js` arme el asiento sin
-- que el código tenga las cuentas hardcodeadas. El lado de "liquidez" (banco /
-- efectivo / tarjeta de crédito) NO vive aquí: se resuelve con una heurística
-- pura sobre el método de pago (ver `cuentaLiquidezPorMedioPago` en
-- `_lib/contabilizar.js`), porque depende del medio de pago, no de la categoría.
--
-- Ejecuta este archivo en el editor SQL de Neon (idempotente: re-ejecutable).
-- Requiere que ya exista `plan_cuentas` (sql/plan-cuentas.sql).
-- =============================================================================

create table if not exists reglas_contables (
  id        bigint generated always as identity primary key,
  tipo      text not null,               -- 'categoria' (gastos) | 'cedula' (ingresos)
  criterio  text not null,               -- nombre de categoría o valor de cédula
  cuenta    text not null references plan_cuentas (codigo),
  creado_en timestamptz not null default now(),
  unique (tipo, criterio)
);

-- El PUC de T1 no tenía una cuenta de renta por pensiones; se agrega aquí (fila
-- nueva, no altera ninguna existente) para poder mapear la cédula 'pension'.
insert into plan_cuentas (codigo, nombre, clase, naturaleza, cuenta_padre) values
  ('4115', 'Pensiones', 4, 'credito', '4')
on conflict (codigo) do nothing;

-- Gastos: categoría (app/src/config/categories.js) → cuenta de gasto (débito).
-- Categorías sin regla explícita caen a 5195 "Otros gastos" (fallback en código).
insert into reglas_contables (tipo, criterio, cuenta) values
  ('categoria', 'Alimentación',              '5105'),
  ('categoria', 'Transporte',                 '5110'),
  ('categoria', 'Personal LADCC',             '5195'),
  ('categoria', 'Personal CMDG',               '5195'),
  ('categoria', 'Salud',                       '5115'),
  ('categoria', 'Entretenimiento',             '5125'),
  ('categoria', 'Regalos y celebraciones',     '5195'),
  ('categoria', 'Educación',                   '5120'),
  ('categoria', 'Gastos Luhijo - Luciano',     '5195'),
  ('categoria', 'Hogar/Aseo',                  '5130'),
  ('categoria', 'Ropa',                        '5195'),
  ('categoria', 'Viajes',                      '5195'),
  ('categoria', 'Gastos Bancarios',            '5135'),
  ('categoria', 'Imprevistos',                 '5195')
on conflict (tipo, criterio) do nothing;

-- Ingresos: cédula (CEDULAS en _lib/handlers.js) → cuenta de ingreso (crédito).
-- NOTA para Luis: 'capital' agrupa arriendos Y rendimientos financieros en el
-- formulario, pero el PUC los separa (4210 vs 4218); por defecto queda en 4210
-- (Arrendamientos) — avísame si prefieres separarlos con un campo adicional.
insert into reglas_contables (tipo, criterio, cuenta) values
  ('cedula', 'trabajo',     '4110'),
  ('cedula', 'honorarios',  '4155'),
  ('cedula', 'no_laboral',  '4175'),
  ('cedula', 'capital',     '4210'),
  ('cedula', 'dividendos',  '4235'),
  ('cedula', 'pension',     '4115')
on conflict (tipo, criterio) do nothing;
