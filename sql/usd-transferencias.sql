-- =============================================================================
-- DCDG Finanzas — Multimoneda (USD) y transferencias entre cuentas.
--
-- Un movimiento puede ser en COP o USD. Y se agrega el tipo "transferencia":
-- mover dinero entre cuentas propias NO es un gasto (no cuenta en los totales de
-- gasto). Ver issue #26.
--
-- Ejecuta en el editor SQL de Neon (idempotente: re-ejecutable).
-- =============================================================================

alter table movimientos add column if not exists moneda         text default 'COP';
alter table movimientos add column if not exists cuenta_destino  text;

-- Nota: el tipo "transferencia" no requiere cambio de esquema (movimientos.tipo
-- ya es text libre). El backend lo excluye de los totales de gasto.
