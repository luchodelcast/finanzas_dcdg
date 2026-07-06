# Conciliación con extractos — el modelo de "fuente de verdad final"

> Principio rector de la arquitectura de datos de DCDG Finanzas.

## La idea en una frase

> **La captura en tiempo real es provisional. El extracto bancario es la fuente
> de verdad final.** Todo movimiento queda "en firme" solo cuando se **concilia**
> contra el extracto.

## Por qué

Alimentamos el sistema desde **múltiples fuentes** y en el momento en que ocurre
el gasto/ingreso (para no perder detalle ni memoria):

- **SilvIA** (WhatsApp, voz/texto)
- **PWA** (formulario, foto de recibo)
- **EmailBot** (correos de notificación bancaria)
- **(futuro)** acceso a los movimientos en los **portales de los bancos**

Ninguna de esas fuentes es infalible: se puede olvidar un gasto, duplicar, poner
mal el monto o la fecha, o registrar algo que al final no se cobró. Por eso, al
cierre de mes, se **analiza el extracto** de cada cuenta/tarjeta y se **contrasta**
con lo capturado. El extracto manda: es lo que el banco efectivamente movió.

## Ciclo de vida de un movimiento

```
  captura (SilvIA/PWA/EmailBot/portal)          conciliación mensual con extracto
  ─────────────────────────────────────►  ┌──────────────────────────────────────┐
   estado_conciliacion = 'provisional'     │  match por cuenta+fecha(±)+monto(±)   │
                                           │   → 'conciliado' (en firme)          │
                                           │   sin match capturado → 'solo_extracto'
                                           │   capturado sin match → queda        │
                                           │     'provisional' y se revisa        │
                                           └──────────────────────────────────────┘
```

**Estados** (`estado_conciliacion`):
- `provisional` — capturado en tiempo real, aún no contrastado con extracto.
- `conciliado` — coincide con una línea del extracto → **en firme**.
- `descartado` — se capturó pero el extracto muestra que no ocurrió (o fue error).

**Estado de una línea de extracto** (`extracto_lineas.estado`):
- `sin_conciliar` — línea del banco que aún no se cruzó.
- `conciliado` — cruzada con un movimiento/ingreso capturado.
- `solo_extracto` — el banco la tiene pero **nadie la capturó** → hay que crear el
  movimiento (gasto/ingreso) que faltó.

## Modelo de datos

- **`extractos`** — un extracto cargado (cuenta, periodo, saldos inicial/final,
  fuente: pdf/csv/portal/manual).
- **`extracto_lineas`** — cada línea del extracto (fecha, monto, descripción), con
  el vínculo a qué `movimiento`/`ingreso` capturado corresponde (si alguno).
- **`movimientos` / `ingresos`** — ganan `estado_conciliacion` y `extracto_linea_id`.

DDL en [`sql/conciliacion.sql`](../sql/conciliacion.sql) (idempotente).

## El proceso de conciliación (motor — fase futura)

1. **Cargar** el extracto (PDF/CSV → filas normalizadas, o traído del portal).
2. **Cruzar** cada línea contra lo capturado de esa cuenta: mismo signo, `monto`
   (±1), `fecha` dentro de una ventana (±3–5 días para compras que postean
   después), y comercio/descripción como desempate. Reutiliza la lógica de dedup
   que ya existe (`repo.findPosibleDuplicado`).
3. **Resolver los tres casos:**
   - línea ↔ capturado → `conciliado` (en firme).
   - línea sin capturado → `solo_extracto` → proponer crear el movimiento faltante
     (vía SilvIA: "el banco muestra $X en Y el día Z que no tienes registrado, ¿lo
     anoto?").
   - capturado sin línea → sigue `provisional`; puede ser timing (posteará el otro
     mes) o un error → se revisa.
4. **Cuadrar saldos:** saldo_inicial + Σ líneas = saldo_final del extracto (control
   de que no falta ni sobra nada).

## Cómo encaja con lo demás

- **Contabilidad (partida doble):** la conciliación bancaria es un pilar contable
  estándar; `conciliado` es la evidencia que respalda cada asiento.
- **Fiscal (renta/IBC/UGPP):** ante un requerimiento, "está conciliado con el
  extracto" es la defensa más fuerte de un movimiento.
- **Dedup / idempotencia:** siguen operando en la captura; la conciliación es la
  capa de verdad *por encima*.

## Fases

- **Ahora:** dejar el esquema listo (`extractos`, `extracto_lineas`,
  `estado_conciliacion`) para no re-arquitecturar después. *(Este PR.)*
- **Siguiente:** cargador de extractos (CSV/PDF) + motor de cruce + reporte de
  discrepancias.
- **Futuro:** ingesta directa desde los portales de los bancos.
