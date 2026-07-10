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

- **Listo:** esquema (`extractos`, `extracto_lineas`, `estado_conciliacion`).
- **Listo:** cargador de extractos en CSV **y PDF** (`_lib/extracto-pdf.js`,
  botón 🧾 de la PWA · endpoint `/api/pwa-extracto`) — sube fecha/descripción/
  monto de una cuenta y un periodo, y los guarda en `extracto_lineas` con
  `estado='sin_conciliar'`.
- **Listo (primera versión, issue #39):** motor de cruce automático — botón 🔗
  de la PWA · endpoint `/api/pwa-conciliacion`. Para **un extracto a la vez**,
  PROPONE cruces (monto ±1, fecha ±4 días, descripción como desempate,
  reusando el criterio de `repo.findPosibleDuplicado`) entre sus líneas
  `sin_conciliar` y los `movimientos`/`ingresos` `provisional`. Nunca escribe
  solo: el usuario revisa y confirma cada cruce (`POST` explícito) antes de
  marcar `conciliado`. Si una línea matchea con más de un capturado
  (ambigüedad), no se auto-resuelve ni se descarta — se muestran todos los
  candidatos para que el usuario elija manualmente cuál es el correcto.
  `solo_extracto` (línea sin nada capturado que coincida) es solo informativo
  en esta versión: el motor no crea el movimiento/ingreso faltante por sí
  solo, el usuario lo registra por las pantallas normales.
  Sin soporte multi-extracto simultáneo todavía.
- **Listo:** creación guiada del movimiento faltante para `solo_extracto`
  (issue #72/#79, "Contabilizar estas N líneas").
- **Listo (issue #100):** cuadre de saldos — paso 4 de "El proceso de
  conciliación" arriba. `cuadreExtracto()` en `_lib/conciliacion.js` valida
  que `saldo_inicial + Σ monto(extracto_lineas) ≈ saldo_final` (tolerancia
  ±1 por redondeo, mismo margen que el resto del motor de cruce) usando
  **todas** las líneas del extracto, no solo las `sin_conciliar`. Se expone
  en `resumen.cuadre` de `GET /api/pwa-conciliacion` y se muestra en la
  pantalla 🔗 Conciliación junto al resto del resumen. Si el extracto nunca
  tuvo `saldo_inicial`/`saldo_final` cargado, `cuadre` es `null` (no es un
  error, solo "sin datos para validar") y no se muestra nada.
- **Siguiente:** reporte de discrepancias (capturado que el extracto no
  corrobora) + soporte de PDF.
- **Futuro:** ingesta directa desde los portales de los bancos.
