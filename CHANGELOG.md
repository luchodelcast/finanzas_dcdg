# Novedades — DCDG Finanzas

Registro de lo que el sistema va ganando. Las entradas marcadas 🤖 las construyó
**Autobuild** (ver [AUTOBUILD.md](AUTOBUILD.md)) de forma autónoma; las demás son
cambios hechos en sesión.

El formato: fecha · qué se añadió · PR · estado (✅ en firme / 🔎 en revisión).

---

## 2026-07-07
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
