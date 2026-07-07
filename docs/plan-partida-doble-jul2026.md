# Plan de arranque contable DCDG — partida doble (jul-2026)

> Sprint de 2 semanas para pasar de "captura de gastos" a **contabilidad familiar
> de partida doble**, consultable por el equipo contable. Punto de partida:
> **saldos iniciales al 1-jul-2026**. Documento de trabajo para Luis, Carolina y
> el contador (Santiago).

## Decisiones (jul-2026)

| Tema | Decisión |
|---|---|
| **Modelo contable** | **Partida doble formal** sobre un Plan Único de Cuentas (PUC) simplificado para persona natural/familia. No es un ledger de saldos: son asientos débito = crédito. |
| **Portal del equipo** | **Solo lectura** para el contador (Santiago), tesorería (María Isabel) y admin financiero (Ángela). Solo Luis y Carolina escriben. |
| **Aprobación de cambios sensibles** | Luis **aprueba cada uno** (esquema, roles/auth, datos reales) vía PR borrador + aviso WhatsApp. Lo aditivo/solo-lectura se auto-fusiona con CI verde. |
| **Accesos (Horizonte 1, finanzas familiares)** | `luis@iwin.im`, `carodz2@gmail.com` (owner) · `angela@iwin.im` (admin_financiero) · `ma.isabel@iwin.im` (tesorería) · `santiago@iwin.im` (contador CO). Todos los del equipo, **solo lectura**. |

## Principio de arquitectura: captura rápida + contabilidad por debajo

Se preservan las dos capas y se conectan con una tercera:

1. **Captura (existente, rápida):** SilvIA/PWA/EmailBot registran `movimientos` e
   `ingresos` como hoy. Nadie deja de usar el flujo on-the-go.
2. **Contabilización (nueva):** cada `movimiento`/`ingreso` capturado genera
   **automáticamente** un asiento balanceado, usando un mapeo
   `categoría`/`cuenta bancaria` → `cuenta PUC`. El contador también puede pedir
   **asientos manuales** de ajuste (los registra Luis/Carolina por él).
3. **Reportes (nueva):** Balance General, Estado de Resultados, Libro Mayor,
   Libro Diario y Balance de Comprobación se derivan de los asientos.

Así la partida doble es la **fuente de verdad contable** sin sacrificar la
rapidez de la captura. La conciliación con extractos (ya diseñada en
[`conciliacion.md`](conciliacion.md)) marca los asientos "en firme".

## Modelo de datos nuevo (se suma al Postgres actual)

| Tabla | Rol |
|---|---|
| `plan_cuentas` | Catálogo de cuentas PUC (código, nombre, clase 1–9, naturaleza débito/crédito, cuenta padre). Semilla con un PUC simplificado para familia. |
| `asientos` | Cabecera del asiento: fecha, descripción, `entidad_id`, origen (apertura/automático/manual/ajuste), estado (borrador/contabilizado), `estado_conciliacion`. |
| `asiento_lineas` | Renglones: `cuenta` (→ `plan_cuentas`), `debito`, `credito`, `tercero_id`, `movimiento_id`/`ingreso_id` de origen. **Restricción: Σ débito = Σ crédito** por asiento. |
| `reglas_contables` | Mapeo `categoría`/`cuenta bancaria`/`tipo` → cuentas PUC para la contabilización automática. |

Tablas que ya existen y se reusan: `entidades`, `terceros`, `cuentas_bancarias`,
`ingresos`, `movimientos`, `costos_actividad`, `usuarios`, `extractos`.

## Hoja de ruta — 2 semanas

Cada tarea es un issue `autobuild`. Las que tocan esquema/auth/datos reales van
en **PR borrador para aprobación de Luis** (decisión 3). Las de esquema dejan un
`sql/*.sql` que **Luis corre en Neon** antes de fusionar.

### Semana 1 — Motor de partida doble

- **T1 · Plan de cuentas (PUC).** Tabla `plan_cuentas` + semilla de un PUC
  simplificado (activos: bancos/efectivo/CxC; pasivos: tarjetas de crédito/CxP;
  patrimonio; ingresos por cédula; gastos por categoría; costos Ahinoa).
- **T2 · Libro diario (asientos).** Tablas `asientos` + `asiento_lineas` con la
  validación Σdébito = Σcrédito. Endpoint de asiento manual (solo owner) + tests
  del cuadre. *Depende de T1.*
- **T3 · Asiento de apertura (saldos iniciales).** Pantalla PWA para montar el
  saldo de cada cuenta al 1-jul como un asiento de apertura balanceado
  (débito activos / crédito pasivos + patrimonio); valida que cuadre.
  *Depende de T2.*
- **T4 · Contabilización automática.** `reglas_contables` + generar el asiento
  balanceado de cada `movimiento`/`ingreso` capturado. *Depende de T2.*
- **T5 · Libro Mayor + Balance de Comprobación.** Saldos por cuenta PUC
  (débitos/créditos acumulados), consultable. *Depende de T2.*

### Semana 2 — Estados financieros, portal y fiscal

- **T6 · Estado de Resultados (P&L).** Clases 4 − (5+6) del mayor, por entidad y
  periodo. *Depende de T5.*
- **T7 · Balance General.** Clases 1, 2, 3 a una fecha, por entidad, con
  patrimonio calculado. *Depende de T5.*
- **T8 · Roles + portal de solo-lectura.** Cablear `usuarios` + roles; portal web
  donde Santiago/María Isabel/Ángela consultan diario, mayor, balance, resultados
  y exports. Alcance por entidad. *Sensible (auth).*
- **T9 · Reporte IBC mensual** por persona (absorbe la propuesta #37), alimentado
  del mayor. *Depende de T5.*
- **T10 · Conciliación con extractos** (absorbe #39): marca asientos "en firme".
- **T11 · Soporte PDF** de comprobantes (absorbe #35) + soporte adjunto a asientos.
- **T12 · Cierre mensual + exports contables** (libro diario, mayor, balance,
  comprobación en Excel/CSV para el contador) + **backup diario** (absorbe #41).

## Lo que Luis y Carolina deben hacer (no lo hace el sistema)

1. **Montar los saldos iniciales al 1-jul** en la pantalla de T3 (el número real
   de cada cuenta/tarjeta/efectivo). Es el punto cero de todo.
2. **Correr las migraciones** `sql/*.sql` en Neon cuando cada tarea de esquema lo
   pida (aviso por WhatsApp).
3. **Aprobar los PR sensibles** cuando llegue el aviso.

## Validaciones pendientes del contador (Santiago)

- Nivel de detalle del PUC (¿cuánto simplificamos para una familia?).
- Reglas del IBC: costos reales vs. presunción de costos DIAN (ver
  [`roadmap-contable.md`](roadmap-contable.md) §3).
- Tratamiento de Ahinoa y de consignaciones en cuentas de los hijos (§8.b).
- Tarifas/topes del año (SMMLV, FSP, ARL).
