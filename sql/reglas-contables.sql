-- =============================================================================
-- DCDG Finanzas — Reglas de contabilización automática (T4 del sprint contable).
--
-- Mapea el mundo de la captura (categoría del gasto, cédula del ingreso, medio
-- de pago) a cuentas del PUC, para que cada movimiento/ingreso genere su asiento
-- balanceado solo. Ver _lib/contabilizar.js.
--
-- Ejecuta este archivo en el editor SQL de Neon (idempotente: re-ejecutable).
-- Requiere sql/plan-cuentas.sql y sql/asientos.sql ya corridos.
-- =============================================================================

create table if not exists reglas_contables (
  id     bigint generated always as identity primary key,
  ambito text not null,                       -- 'categoria' | 'cedula' | 'medio'
  clave  text not null,                       -- clave en minúsculas; 'default' = comodín
  cuenta text not null references plan_cuentas (codigo),
  unique (ambito, clave)
);

-- Categoría del gasto → cuenta de gasto (clase 5).
insert into reglas_contables (ambito, clave, cuenta) values
  ('categoria', 'alimentación',     '5105'),
  ('categoria', 'alimentacion',     '5105'),
  ('categoria', 'mercado',          '5105'),
  ('categoria', 'restaurante',      '5105'),
  ('categoria', 'domicilios',       '5105'),
  ('categoria', 'transporte',       '5110'),
  ('categoria', 'salud',            '5115'),
  ('categoria', 'educación',        '5120'),
  ('categoria', 'educacion',        '5120'),
  ('categoria', 'entretenimiento',  '5125'),
  ('categoria', 'ocio',             '5125'),
  ('categoria', 'hogar',            '5130'),
  ('categoria', 'servicios',        '5130'),
  ('categoria', 'gastos bancarios', '5135'),
  ('categoria', 'default',          '5195')
on conflict (ambito, clave) do nothing;

-- Cédula del ingreso → cuenta de ingreso (clase 4).
insert into reglas_contables (ambito, clave, cuenta) values
  ('cedula', 'trabajo',    '4110'),
  ('cedula', 'honorarios', '4155'),
  ('cedula', 'no_laboral', '4175'),
  ('cedula', 'capital',    '4210'),
  ('cedula', 'dividendos', '4235'),
  ('cedula', 'default',    '4155')
on conflict (ambito, clave) do nothing;

-- Medio de pago → cuenta de balance (activo/pasivo).
insert into reglas_contables (ambito, clave, cuenta) values
  ('medio', 'efectivo',        '1105'),
  ('medio', 'tarjeta credito', '2105'),
  ('medio', 'default',         '1110')
on conflict (ambito, clave) do nothing;
