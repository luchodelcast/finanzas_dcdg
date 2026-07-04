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
| Mercury DELCA2 | — | Luis/Carolina | USD | Cuenta USD | LADCC/CMDG |
| DollarApp | — | Luis | USD | Cuenta USD | LADCC |

## Filtros iWin / Delca2

Ver [`app/src/config/iwin.js`](../app/src/config/iwin.js).

- **Ignorar (18 cuentas iWin)**: `5401, 1039, 9530, 2275, 0322, 4543, 0530, 1491,
  2721, 3811, 3329, 2735, 8632, 5945, 7064, 0490, 9928, 2997`. No son gastos
  familiares.
- **DCDG (registrar)**: `0965, 3355, 4549, 3164, 5688`.
- **Delca2 (ingresos, no gastos)**: `3851, 9164` (Mercury Delca2 LLC).

### Regla de la tarjeta Jeeves (TC iWin)

Si un gasto **personal** se paga con la tarjeta corporativa Jeeves, se registra:
1. El **gasto** en `Registro Gastos`, y
2. Un **adelanto** de honorarios en la hoja `EMPRESAS`.

`evaluarMovimiento()` lo resuelve automáticamente (`adelanto_empresas: true`).
