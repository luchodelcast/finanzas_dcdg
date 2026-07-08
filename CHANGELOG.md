# Novedades — DCDG Finanzas

Registro de lo que el sistema va ganando. Las entradas marcadas 🤖 las construyó
**Autobuild** (ver [AUTOBUILD.md](AUTOBUILD.md)) de forma autónoma; las demás son
cambios hechos en sesión.

El formato: fecha · qué se añadió · PR · estado (✅ en firme / 🔎 en revisión).

---

## 2026-07-08
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
