# Novedades — DCDG Finanzas

Registro de lo que el sistema va ganando. Las entradas marcadas 🤖 las construyó
**Autobuild** (ver [AUTOBUILD.md](AUTOBUILD.md)) de forma autónoma; las demás son
cambios hechos en sesión.

El formato: fecha · qué se añadió · PR · estado (✅ en firme / 🔎 en revisión).

---

## 2026-07-08
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
