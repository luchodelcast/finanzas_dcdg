# Cuentas bancarias y filtros — DCDG

Fuente de verdad en producción: hoja `⚙️ CUENTAS` del Sheet. Espejo local en
[`app/src/config/accounts.js`](../app/src/config/accounts.js) para resolver
tarjeta→cuenta sin round-trip y alimentar prompts.

## Cuentas DCDG

| Cuenta | Tarjeta déb. | Titular | Moneda | Tipo | CC |
|---|---|---|---|---|---|
| Bcol 0965 | 2331 | Luis | COP | Débito | LADCC |
| Bcol 3355 | 6940 | Luis | COP | Débito | LADCC |
| Bcol 4549 | 5773 | Carolina | COP | Débito | LADCC |
| Bcol 3164 | 4550 | Carolina | COP | Débito | CMDG-Sebas |
| Bcol 5688 | 1360 | Carolina | COP | Débito | Ahinoa |
| TC iWin (Superlikers) | — | Superlikers | USD | Crédito corporativo | LADCC |
| Nequi Luis | — | Luis | COP | Nequi | LADCC |
| Nequi Carolina | — | Carolina | COP | Nequi | CMDG |
| Mercury Delca2 (7730) | 7730 | Delca2 LLC (Luis/Carolina) | USD | Cuenta USD | Delca2 |
| DollarApp | — | Luis | USD | Cuenta USD | LADCC |

> **Delca2 LLC** es la empresa de Luis y Carolina; factura los servicios que le
> prestan a Superlikers. Cuenta Mercury checking `202508119164` (últimos 4:
> `9164`); tarjeta física terminada en `7730`. Hay otra cuenta Mercury Delca2
> (`3851`).

## Filtros iWin / Delca2

Ver [`app/src/config/iwin.js`](../app/src/config/iwin.js).

- **Ignorar (18 cuentas iWin)**: `5401, 1039, 9530, 2275, 0322, 4543, 0530, 1491,
  2721, 3811, 3329, 2735, 8632, 5945, 7064, 0490, 9928, 2997`. No son gastos
  familiares.
- **DCDG (registrar)**: `0965, 3355, 4549, 3164, 5688`.
- **Delca2 (números de cuenta)**: `3851, 9164` (Mercury Delca2 LLC); tarjeta `7730`.

> **Dos direcciones para Delca2, según el flujo:**
> - **EmailBot** (alertas bancarias entrantes): cuando Superlikers le **paga** a
>   Delca2, es un **ingreso** de honorarios → no se registra como gasto familiar.
> - **Registro manual / SilvIA** (el usuario declara un gasto): si se **paga** un
>   gasto familiar **con** la tarjeta/cuenta Delca2, sí es un gasto → ver la regla
>   de abajo. El filtro "Delca2 = ingreso" aplica solo al flujo automático del
>   EmailBot, no cuando el usuario dice explícitamente "gasté …".

### Regla de la tarjeta Jeeves (TC iWin)

Si un gasto **personal** se paga con la tarjeta corporativa Jeeves, se registra:
1. El **gasto** en `Registro Gastos`, y
2. Un **adelanto** de honorarios en la hoja `EMPRESAS`.

`evaluarMovimiento()` lo resuelve automáticamente (`adelanto_empresas: true`).

### Regla de la tarjeta Delca2 (Mercury 7730)

Delca2 es la empresa de Luis y Carolina, así que pagar un gasto familiar con su
tarjeta = sacar plata de la empresa. Análogo a Jeeves, se registra:
1. El **gasto** en `Registro Gastos` con método `Mercury Delca2 (7730)`, y
2. Un **retiro / distribución de socios Delca2** en la hoja `EMPRESAS`
   (`Empresa = Delca2`, concepto `Retiro/distribución socios Delca2 · …`).

`evaluarMovimiento()` lo detecta con `esPagoDelca2()` (tarjeta `7730`/`3851`/`9164`
o método que mencione "Delca2") y devuelve `retiro_delca2: true`. SilvIA reconoce
"Delca2", "la 7730" y "Mercury Delca2" y los mapea a esta cuenta.
