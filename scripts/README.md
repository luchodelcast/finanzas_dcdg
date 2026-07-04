# Google Apps Scripts — DCDG Finanzas

Scripts que viven adjuntos al libro de Google Sheets DCDG. Se versionan aquí
como referencia; el editor de Apps Script sigue siendo el runtime.

| Archivo | Función | Estado |
|---|---|---|
| `DCDG_EmailBot_v4.gs` | Bot email horario: parsea alertas Bancolombia/Nequi/Colpatria/Serfinanza y CETs, clasifica con `claude-haiku-4-5-20251001`, deduplica y escribe en `Registro Gastos` (col K auto-resuelta). | ✅ En repo · Activo (verificar trigger) |
| `DCDG_Corregir.gs` | 4 fixes post-restructuración + columnas tarjeta débito en CUENTAS/Registro Gastos/2026 COP. | ✅ En repo · Ejecutado |
| `DCDG_CrearHojas.gs` | Crea hojas `⚙️ CUENTAS` y `EMPRESAS`. | Pendiente exportar |
| `DCDG_Restructurar.gs` | Crea secciones DGP y Sebas en Presupuesto. | Pendiente exportar |

Las constantes duras de estos scripts (cuentas iWin, mapa de tarjetas, reglas de
clasificación) son la misma fuente conceptual que `app/src/config/` — al
modificar una, sincronizar la otra.

## Notas de migración (del doc de contexto)

- **Tracking de emails**: usar `LAST_PROCESSED_TS` en Script Properties, **no**
  etiquetas de hilo Gmail (Gmail etiqueta el hilo completo, no el mensaje).
- **Deduplicación**: `fecha` + `monto` (±1 COP) + primeros 6 chars del comercio.
  No usar método de pago (falsos positivos: Flypass vía F2X SAS).
- **Cuentas iWin a ignorar**: ver `app/src/config/iwin.js` (fuente compartida).
- **Fórmula columna K**: usar `VALUE()` (no `TEXT()`) para la cuenta auto-resuelta.

## Para exportar los `.gs`

Desde el editor de Apps Script del libro → cada archivo → copiar contenido a
`scripts/<Nombre>.gs` y commitear. Idealmente, extraer las reglas duras (cuentas
iWin, keywords) para que consuman la misma fuente conceptual que el resto del repo.
