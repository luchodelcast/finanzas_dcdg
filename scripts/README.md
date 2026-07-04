# Google Apps Scripts — DCDG Finanzas

Scripts que viven adjuntos al libro de Google Sheets DCDG. Aún **no migrados** a
este repo porque sus fuentes (`.gs`) no estaban disponibles en el entorno de la
refactorización; se documentan aquí para completar la migración cuando se
exporten desde el editor de Apps Script.

| Archivo | Función | Estado |
|---|---|---|
| `DCDG_EmailBot_v4.gs` | Bot email horario: parsea alertas Bancolombia/Nequi, clasifica con `claude-haiku-4-5-20251001`, deduplica y escribe en `Registro Gastos`. | Activo (verificar trigger) |
| `DCDG_CrearHojas.gs` | Crea hojas `⚙️ CUENTAS` y `EMPRESAS`. | Ejecutado |
| `DCDG_Restructurar.gs` | Crea secciones DGP y Sebas en Presupuesto. | Ejecutado |
| `DCDG_Corregir.gs` | Fixes post-restructuración + columnas tarjeta. | Ejecutado |

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
