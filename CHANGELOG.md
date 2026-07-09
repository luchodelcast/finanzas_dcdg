# Novedades — DCDG Finanzas

Registro de lo que el sistema va ganando. Las entradas marcadas 🤖 las construyó
**Autobuild** (ver [AUTOBUILD.md](AUTOBUILD.md)) de forma autónoma; las demás son
cambios hechos en sesión.

El formato: fecha · qué se añadió · PR · estado (✅ en firme / 🔎 en revisión).

---

## 2026-07-09 (autobuild)
- 🤖 **[Contab. familiar B] Clasificar gasto compartido (hogar) vs. personal**
  (issue #114, `auto-ok`, PR pendiente): al capturar un egreso, cada movimiento
  ahora lleva un marcador `hogar` (compartido) o `personal de <persona>`. Por
  defecto se **infiere** del `bolsillo` de la cuenta usada (`cuentas_meta`,
  #112): bolsillo `comun` → hogar; `gasto_individual`/`patrimonio_individual`
  → personal del dueño de esa cuenta. La PWA permite **override manual** en la
  pantalla de confirmación de registro ("¿Hogar o personal?"), y el marcador
  queda visible en el historial del Dashboard y filtrable vía
  `GET /api/pwa-movimientos?tipo_gasto=hogar|personal`. Columnas nuevas
  (`tipo_gasto`, `tipo_gasto_persona`, `tipo_gasto_auto`) vía DDL idempotente
  en runtime, sin `.sql` manual — aditivo puro (candado de `AUTOBUILD.md`
  respetado). `npm test` (267/267) + `npm run build` en verde → auto-merge. ✅

## 2026-07-09 (autobuild)
- 🤖 **[Contab. familiar A] Fondo común + reporte de aportes al hogar** (issue
  #113, `auto-ok`, PR #123): nueva tabla `aportes_hogar` (DDL idempotente en
  runtime) para que cada persona registre su aporte al fondo común del hogar,
  distinto de una transferencia genérica. Cada aporte se contabiliza solo
  (débito a la cuenta PUC nueva `1115` "Fondo común del hogar" / crédito el
  medio de pago de origen, usando la prioridad de `cuenta_puc` de `cuentas_meta`
  de #112 cuando aplica). El reporte del mes ("🏡 Fondo común" en Más → Familia)
  muestra cuánto aportó cada quien, su cuota proporcional sugerida (según su
  ingreso del periodo) y el % cumplido. Aditivo puro (candado de `AUTOBUILD.md`
  respetado). `npm test` + `npm run build` en verde → auto-merge. ✅

## 2026-07-09 (autobuild)
- 🤖 **[Contab. familiar 0] Dueño/bolsillo por cuenta (`cuentas_meta`)** (issue
  #112, `auto-ok`, PR #122): la contabilización automática agrupaba cada
  cuenta a una cuenta PUC solo por palabra clave del nombre
  (`efectivo`/`crédito`/`tc`), así que no distinguía el efectivo de Luis de la
  tarjeta de Carolina, y una tarjeta sin esas palabras (p. ej. "Serfinanza")
  se contabilizaba mal (agrupada en `1110`). Ahora una tabla nueva
  `cuentas_meta` (dueño/bolsillo/cuenta PUC explícita por cuenta, DDL
  idempotente en runtime, sin `.sql` manual) le da prioridad a la cuenta PUC
  explícita cuando existe, y cae a la heurística de siempre cuando no —
  llave que habilita el resto de la épica de contabilidad familiar (#111,
  #113–#118). UI mínima en "Saldos iniciales" para fijar los metadatos de
  cada cuenta (solo Luis/Carolina). Aditivo puro (candado de `AUTOBUILD.md`
  respetado igual). `npm test` (251/251) + `npm run build` en verde →
  auto-merge. ✅

## 2026-07-09
- **Corregir movimientos: anular y recategorizar** (botón "Corregir" en el
  Dashboard, solo Luis/Carolina): hasta ahora la captura y SilvIA solo sabían
  *agregar* — si algo quedaba mal (p. ej. una transferencia registrada como
  "Gasto Bancario"), no había forma de arreglarlo en la app. Ahora un owner puede
  **anular** un movimiento (borrado suave — no destruye la fila — con su
  **reverso contable**: un asiento espejo que neutraliza el original, auditable) o
  **recategorizarlo** (reversa y vuelve a contabilizar). Los movimientos anulados
  salen del dashboard, del resumen y de la recontabilización. Nuevo endpoint
  `POST /api/pwa-movimiento` (owner) + `_lib/corregir.js`; columnas `anulado`/
  `contab_version` vía DDL idempotente en runtime (sin `.sql` manual). En sesión
  (no autobuild) por tocar datos financieros. ✅

## 2026-07-09 (autobuild, corrida sin item elegible)
- Siguiendo `AUTOBUILD.md`, esta corrida sincronizó `main` (ya traía el
  rediseño de UI del PR #109, fusionado directo por Luis) y revisó el
  backlog de issues `autobuild`. **Mismo diagnóstico que las dos corridas
  anteriores** (#106 y la de #100/limpieza) — nada cambió desde entonces:
  - `#40`, `#41`, `#92`, `#98` siguen `autobuild-espera` con PR borrador
    abierto (`#58`, `#55`, `#96`, `#103`) esperando revisión de Luis.
  - `#51`, `#52` siguen siendo issues "padre" ya divididos en sub-issues.
  - `#100` sigue como propuesta abierta esperando aprobación — no se creó
    una segunda propuesta duplicada.
  - Sin issues `autofix` abiertos que deban tener prioridad.

  `npm test` → ✅ · `npm run build` → ✅ (sin cambios de comportamiento,
  solo `CHANGELOG.md`).

---

## 2026-07-08 (autobuild, corrida sin item elegible + limpieza de proceso)
- Siguiendo `AUTOBUILD.md`, esta corrida sincronizó `main` y revisó el backlog
  de issues `autobuild`. **Mismo diagnóstico que la corrida anterior (PR
  #106, fusionado ahora)** — nada cambió en las ~4 h entre corridas:
  - `#40`, `#41`, `#92`, `#98` siguen `autobuild-espera` con PR borrador
    abierto (`#58`, `#55`, `#96`, `#103`) esperando revisión de Luis.
  - `#51`, `#52` siguen siendo issues "padre" ya divididos en sub-issues.
  - `#100` sigue como propuesta abierta esperando aprobación — no se creó una
    segunda propuesta duplicada.
  - Ningún issue `autofix` abierto sin `autofix-espera` que deba tener
    prioridad.
- **Limpieza de proceso** (guardrail "sin trabajo silencioso"): las últimas
  corridas sin item elegible dejaban su propio PR de CHANGELOG abierto en
  borrador en vez de fusionarlo (aunque son cambios aditivos de riesgo nulo,
  que la regla general de `AUTOBUILD.md` dice fusionar con CI verde). Esta
  corrida:
  - **Fusionó #106** (la entrada de CHANGELOG más reciente y completa de esa
    serie, CI verde).
  - **Cerró sin fusionar**, por quedar duplicados/superados por #106: #105
    (mismo diagnóstico), #101 (propuesta #100 ya reflejada), #62 (muy
    desactualizado, el bookkeeping real —cerrar #37/#39— ya estaba hecho
    aparte) y #27 (versión temprana de `AUTOBUILD.md`, ya superada por el
    contenido fusionado en #20/#42/#59/#71). Ninguno perdía información real.

  `npm test` → ✅ · `npm run build` → ✅ (sin cambios de comportamiento, solo
  `CHANGELOG.md`).

## 2026-07-08 (autobuild, corrida sin item elegible)
- Siguiendo `AUTOBUILD.md`, esta corrida sincronizó `main` (ya traía la Auth
  PWA Google Sign-In del PR #104, fusionada por Luis directamente) y revisó
  el backlog de issues `autobuild`. **No había ningún item elegible para
  construir**, mismo diagnóstico que la corrida anterior (PR #105, aún sin
  fusionar):
  - `#40`, `#41`, `#92`, `#98` — etiqueta `autobuild-espera` con PR en
    borrador ya abierto (`#58`, `#55`, `#96`, `#103` respectivamente)
    esperando revisión de Luis.
  - `#51`, `#52` — issues "padre" ya divididos en sub-issues más chicos, en
    curso vía sus splits; no se toman directo.
  - `#100` — propuesta abierta (cuadre de saldos del extracto) esperando la
    aprobación de Luis. Como ya cubre el hueco de la cola, esta corrida **no
    creó una segunda propuesta** (evitar duplicar el mismo aviso).
  - No hay issues `autofix` abiertos que deban tener prioridad.

  Esta corrida **no fusionó ni construyó ningún código** — solo este cambio
  de documentación/CHANGELOG. `npm test` → 229/229 ✅ · `npm run build` → ✅
  (sin cambios de comportamiento).

## 2026-07-08 (autobuild, corrida nueva)
- **Auth de la PWA: Google Sign-In + token de sesión** (Issue #2 de auth): el
  navegador ya no hace OAuth de *access token* con el scope pesado
  `spreadsheets` (que reaparecía la pantalla de autorización de Google en cada
  apertura). Ahora solo hace **Google Sign-In** (ID token) y el backend emite un
  **token de sesión propio** (HMAC, 12 h) que se guarda en localStorage; dentro
  de esa ventana la app no vuelve a hablar con Google en cada recarga. Las dos
  últimas llamadas directas del navegador a Sheets (leer `⚙️ CUENTAS` y anexar
  el CET) pasan al backend (cuenta de servicio): nuevos `GET /api/pwa-cuentas` y
  `POST /api/pwa-login`; el CET se registra por `pwa-registrar`. Los `pwa-*`
  aceptan el token de sesión o, en transición, el access token viejo
  (`resolvePwaUser`). **Config pendiente antes de fusionar**: setear
  `AUTH_SECRET` en Netlify (ver `docs/auth-pwa-sesion.md`). Se elimina
  `services/sheets.js` del cliente. 🔎 en revisión.
- **[T8a] Roles de primera clase** (issue #97, sub-issue de #51 — split
  explicado en #97/#98): `verifyFinanceUser` ahora devuelve `{ email, rol }`
  leyendo la tabla `usuarios` (DDL + siembra idempotente en runtime, sin
  `.sql` manual); si el email no tiene fila (o la DB no responde), cae al
  mismo criterio que regía hoy vía `FINANZAS_OWNERS` (retrocompatible: nadie
  pierde ni gana acceso). `esOwner` pasa de una lista de emails hardcodeada a
  `rol === 'owner'`, reusado por los 9 endpoints que ya lo exigían. Además
  **cierra un hueco real**: `pwaIngresoHandler`, `pwaExtractoHandler`,
  `conciliacionHandler` (confirmar cruce) y `pwaBackfillHandler`
  (materializar líneas) escribían sin ningún gate de rol — cualquier email de
  `FINANZAS_USERS` podía registrar ingresos, cargar extractos, confirmar
  conciliación o materializar backfill; ahora exigen `owner` como el resto,
  cumpliendo la decisión documentada ("Solo Luis y Carolina escriben").
  Endpoint nuevo `GET /api/pwa-whoami` (equipo, lectura) para que la PWA
  (issue #98, bloqueado hasta que este se fusione) sepa qué rol tiene.
  **Pendiente**: #98 (ocultar botones de captura/edición en la PWA según el
  rol) queda para una corrida futura. 🤖 · PR #99 (en borrador, espera OK de
  Luis — candado/sensible). Closes #97.
- **Exports contables en CSV** (T12a, botón 📥, issue #91 — sub-issue de
  #52): descarga Libro Diario, Libro Mayor (por cuenta), Balance de
  Comprobación, Estado de Resultados y Balance General de un
  periodo/fecha. Los 5 reportes de solo lectura ya existentes responden
  CSV con `?formato=csv` (sin endpoints nuevos, sin escritura). Montos
  como número plano para Excel/Sheets. **Pendiente**: #92 (cierre
  mensual, la otra mitad de #52) queda para una corrida futura por su
  riesgo medio. 🤖 · PR #94. Closes #91.
- **Solicitudes de mejoras desde la PWA** (Nocturno 7/7, botón 💡): un
  textarea + botón crea un issue de GitHub (label `autobuild` +
  `enhancement`) para que Autobuild lo tome en una corrida futura; debajo,
  la lista de solicitudes/propuestas abiertas. Usa `GITHUB_TOKEN_FINANZAS`/
  `GITHUB_REPO_FINANZAS` (opcionales, sin secretos hardcodeados); sin el
  token configurado, degrada con gracia en vez de fallar. **Pendiente**:
  configurar `GITHUB_TOKEN_FINANZAS` en Netlify para activarla. 🤖 auto-ok
  · PR #89. Closes #78.
- **Préstamos entre Luis y Carolina** (Nocturno 6/7, botón 🤝): registra
  préstamos en ambos sentidos y muestra el saldo neto ("Carolina te debe
  $X" / "Le debes a Carolina $Y"), agrupado por moneda. Un abono es
  sencillamente un registro en sentido inverso; también se puede marcar un
  préstamo como saldado (sale del cálculo del neto). Esquema nuevo
  (`prestamos`) vía DDL idempotente en runtime — sin `.sql` manual.
  Escritura solo owners, lectura equipo. 🤖 auto-ok · PR #87. Closes #77.
- **Botón 🏠 en el header** (Nocturno 5/7): siempre accesible junto a los
  demás íconos, lleva al Home desde cualquier pantalla en un toque (antes
  había que usar "← Volver" varias veces). 🤖 auto-ok · PR #85. Closes #76.
- **Nuevo Home útil + "Registrar egresos"** (Nocturno 4/7): la captura de
  gastos (foto, galería, texto, CET, transferencia + últimos registros) se
  mudó intacta a una pantalla nueva "Registrar egresos". El Home ahora abre
  directo en un tablero: saldos en bancos (Caja + Bancos y billeteras),
  pagos pendientes/vencidos de este mes y pendientes del mes pasado (reusa
  #73), comparativo del gasto vs. mes anterior, y accesos rápidos a
  Registrar egresos / Ingresos / Pagos del mes / Reportes. 🤖 auto-ok · PR
  #83. Closes #75.
- **Plan de cuentas: más rubros de pasivo/activo + "＋ Agregar cuenta"**
  (Nocturno 3/7): en 🏦 Saldos Iniciales se agregan `2110` Obligaciones
  financieras (créditos bancarios/leasing), `1315` Cuentas por cobrar a
  empresas/socios y `2340` Cuentas por pagar a empresas/socios (DDL/inserts
  idempotentes en runtime, sin `.sql` manual). Además, una sección nueva para
  crear cuentas propias de Activo o Pasivo al vuelo, con código sugerido
  automático dentro de su clase y naturaleza inferida (solo owners). El
  asiento de apertura sigue cuadrando sin cambios (es agnóstico a la cuenta).
  🤖 auto-ok · PR #82. Closes #74.
- **Pagos del mes** (Nocturno 2/7, botón 📅): espejo del "Pagos Fijos" del Excel
  de Luis — ~12 conceptos sembrados (Arriendo, Internet, Claro/Tigo, Colegio
  Alemán, servicios…, DCDG y DCC) con día de vencimiento y estado ✅ pagado /
  ⏳ pendiente / 🔴 vencido. Marca/desmarca pagado, muestra los pendientes del
  mes pasado y el total pagado vs. pendiente; gestión para agregar/editar/
  desactivar pagos fijos (solo owners). Esquema nuevo (`pagos_fijos`,
  `pagos_estado`) vía DDL idempotente en runtime — sin `.sql` manual, como pide
  el modo `auto-ok`. 🤖 auto-ok · PR #80. Closes #73.
- **Backfill de extracto: "Contabilizar estas N líneas"** (Nocturno 1/7):
  en 🔗 Conciliación, las líneas `solo_extracto` (el banco las registró pero
  nunca se capturaron) ahora se pueden materializar directo desde ahí. Se
  clasifican automáticamente (reglas DCDG; Claude como respaldo acotado para
  las que no matchean ninguna regla) y se separan en **alta confianza**
  (pre-marcadas) y **dudosas** (tabla editable: categoría/subcategoría para
  gastos, entidad/cédula para ingresos, cuenta destino para transferencias).
  Al aceptar, cada línea crea su movimiento/ingreso ya `conciliado` y lo
  contabiliza (reusa T4); es idempotente (reintentar no duplica) y procesa en
  lotes acotados para no pasar el timeout de la function. 🤖 auto-ok · PR #79.
  Closes #72.
- **[T5] Libro Mayor + Balance de Comprobación**: `_lib/mayor.js` deriva, de los
  asientos de T2, el saldo corrido por cuenta (`GET /api/pwa-mayor?cuenta=`) y
  el balance de comprobación de todas las cuentas con movimiento
  (`GET /api/pwa-comprobacion`, valida Σdébito = Σcrédito). Pantalla PWA 📒
  de solo lectura para ambos. Cierra la Semana 1 del motor contable — base de
  Estado de Resultados (T6) y Balance General (T7). 🤖 PR #69.
- **Limpieza de cola**: cerré #45 (T2) y #46 (T3) — ya estaban fusionados a
  `main` (PR #65/#66) pero sus PR decían "Cierra #N" en vez de `Closes #N`,
  así que GitHub no los auto-cerró. Cerré también el PR borrador #60,
  duplicado de #45 ya superado por #65. Dejé anotado en #47 que hay dos PR
  borrador paralelos (#67/#68) para lo mismo — a la espera de que Luis elija
  cuál revisar.

## 2026-07-07
- Motor de cruce automático de conciliación (botón 🔗), fase 2 de
  docs/conciliacion.md: para un extracto a la vez, propone cruces entre sus
  líneas y lo capturado (`movimientos`/`ingresos` `provisional`); el usuario
  revisa y confirma antes de marcar `conciliado` (ante ambigüedad, elige
  manualmente entre los candidatos — nunca se auto-resuelve). 🤖 PR #57.
- Soporte de comprobantes en PDF en la PWA ("Elegir de galería"), solo 1 página
  por ahora: se manda como bloque `document` nativo de Anthropic reusando el
  mismo flujo de clasificación que las fotos; si el PDF trae más páginas o pesa
  de más, se avisa en vez de fallar en silencio. Límite exacto de tamaño y
  soporte multi-página quedan como decisiones abiertas; el lado SilvIA/WhatsApp
  queda fuera (otro repo). 🤖 PR #54.
- Cargador de extractos bancarios en CSV (botón 🧾): sube fecha/descripción/
  monto de una cuenta y un periodo y los deja guardados en `extracto_lineas`
  (`sin_conciliar`) — primer paso de la conciliación (docs/conciliacion.md);
  aún sin el motor de cruce automático. 🤖 PR #38. ✅

## 2026-07-06
- Dashboard: comparativo del periodo vs. el anterior (variación % del total y
  por categoría, "Este mes"/"Mes pasado"/"Año"). 🤖 PR #29. ✅
- **Autobuild activado** 🤖 — construcción autónoma de funcionalidades 24/7 desde
  la cola de issues `autobuild`, con auto-merge bajo CI verde y avisos por
  WhatsApp/email/este CHANGELOG. (Sistema base.) ✅
- Conciliación con extractos: diseño + esquema (`extractos`, `estado_conciliacion`). PR #19. ✅
- Captura de ingresos en la PWA (botón 💵). PR #16. ✅
- Dashboard online (botón 📊). PR #13. ✅
- Motor: Postgres (Neon) como fuente de verdad; el Sheet pasa a espejo. PR #10. ✅
- SilvIA: registrar tarjetas/cuentas (`registrar_cuenta`) + confiabilidad de reportes. PR #18. ✅
