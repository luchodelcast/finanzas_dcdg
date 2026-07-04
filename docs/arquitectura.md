# Arquitectura — DCDG Finanzas

## Visión general

Dos frentes sobre un mismo dominio (finanzas familiares DCDG):

```
┌─────────────────────────┐        ┌─────────────────────────────┐
│  PWA  (app/)            │        │  SilvIA (repo sl-crm-live)  │
│  captura + clasificación│        │  WhatsApp / Chat / Web      │
└───────────┬─────────────┘        └───────────────┬─────────────┘
            │ OAuth usuario (GIS)                  │ HTTP + Bearer token
            │                                      │ (tools delgadas)
            ▼                                      ▼
     Google Sheets  ◀───────────  API de finanzas (netlify/functions)
     (libro maestro DCDG)          Service Account → Sheets (batchUpdate)
                                   Reglas DCDG + Anthropic (fallback)
```

- **PWA**: el usuario captura foto/texto, se clasifica con Claude en el navegador
  y se escribe a Sheets con su propio OAuth. Modular por responsabilidad.
- **API de finanzas** (Opción B del doc de integración): SilvIA envía los
  mensajes de WhatsApp de Luis/Carolina a estos endpoints con un token de
  servicio. La lógica de negocio (reglas, filtros iWin, escritura a Sheets) vive
  aquí, versionada y testeada.

## Flujo de un registro por WhatsApp

```
Carolina (WhatsApp): "pagué 120mil de mercado en el D1 con la Nequi"
 → SilvIA resuelve teléfono → carodz2@gmail.com (isFinanceUser=true)
 → tool registrar_gasto → POST /api/registrar-gasto  (Bearer + X-DCDG-User)
   → authorize(): valida token + FINANZAS_USERS
   → registrarMovimiento():
       parseMonto("120mil") = 120000
       clasificar("mercado en el D1") → reglas → Alimentación/Mercado
       evaluarMovimiento() → registrar=true (cuenta DCDG)
       appendRow("Registro Gastos", [fecha, mes, cat, subcat, desc, monto, metodo, quien, notas, tarjeta])
 → responde: "Anotado ✅ Alimentación/Mercado $120.000, Nequi Carolina."
```

## Separación de secretos (P1)

- **Navegador**: `app/src/config/env.js` — defaults + `import.meta.env` + overrides
  en localStorage. La API key solo la ingresa el usuario en Ajustes.
- **Backend**: `netlify/functions/_lib/env.js` — todo por `process.env`, con
  `requireEnv()` que falla ruidosamente si falta algo crítico.

## Fuente única de verdad

- **Reglas de clasificación**: `app/src/config/rules.js` (puro). El backend lo
  importa desde `netlify/functions/_lib/classify.js`. Un solo lugar que cambiar.
- **Cuentas / filtros iWin**: `app/src/config/accounts.js` e `iwin.js`, también
  reutilizados por el backend. Espejo local de la hoja `⚙️ CUENTAS`.

## Por qué `batchUpdate` con sheetId numérico

El endpoint `:append` de la Sheets API falla silenciosamente cuando el nombre de
la hoja contiene emoji (`⚙️ CUENTAS`). Ambos wrappers (navegador y backend)
resuelven el `sheetId` numérico y escriben con `spreadsheets:batchUpdate` +
`appendCells`, inmune al problema.

## Testing

`tests/` corre con `node --test` sin red ni dependencias:
- `classify.test.js` — reglas DCDG.
- `formatters.test.js` — montos/fechas.
- `finanzas.test.js` — filtros iWin/Delca2, resolución de cuenta, rangos de periodo.
