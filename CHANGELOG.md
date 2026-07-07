# Novedades — DCDG Finanzas

Registro de lo que el sistema va ganando. Las entradas marcadas 🤖 las construyó
**Autobuild** (ver [AUTOBUILD.md](AUTOBUILD.md)) de forma autónoma; las demás son
cambios hechos en sesión.

El formato: fecha · qué se añadió · PR · estado (✅ en firme / 🔎 en revisión).

---

## 2026-07-07
- **Nota de proceso (corrida de la tarde):** al sincronizar el backlog, esta
  corrida encontró que los PR #56 (Reporte IBC, issue #37) y #57 (Motor de
  cruce, issue #39) — ambos marcados explícitamente "queda en borrador, no se
  auto-fusiona, espera el OK del dueño" por tocar categorías sensibles — ya
  estaban **fusionados a `main`** sin ningún comentario o review registrado en
  el PR, poco después de que PR #59 reforzara la compuerta de aprobación por un
  incidente similar. Esta corrida no fusionó nada: solo cerró #37/#39 (el
  código ya estaba en `main`, así que la mejora en sí ya está viva) y avisó a
  Luis para que confirme si el merge fue suyo. No había nada más elegible para
  construir: el resto de la cola (#40, #41) sigue en borrador esperando
  revisión, y las tareas T3–T12 del sprint contable dependen de T2 (#45, PR
  #60), que sigue sin fusionar en espera de correr `sql/asientos.sql` en Neon.
- Reporte mensual de aportes IBC por persona (Fase 3.2 contable, tarjeta 🧮):
  por persona y mes, `IBC = 40% × (ingresos − costos deducibles)` con piso/techo
  en SMMLV y desglose de aportes (salud/pensión/FSP); solo lectura, sin tablas
  nuevas. Deja anotadas para el contador varias decisiones (costos reales vs.
  presunción DIAN, SMMLV 2026, FSP simplificado, ARL pendiente). 🤖 PR #56. ✅
- Motor de cruce automático de conciliación (botón 🔗), fase 2 de
  docs/conciliacion.md: para un extracto a la vez, propone cruces entre sus
  líneas y lo capturado (`movimientos`/`ingresos` `provisional`); el usuario
  revisa y confirma antes de marcar `conciliado` (ante ambigüedad, elige
  manualmente entre los candidatos — nunca se auto-resuelve). 🤖 PR #57. ✅
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
