# Legacy — monolito original de referencia

`DCDG_Captura_v5.html` es la **app PWA original** (monolito HTML/CSS/JS de ~1250
líneas) desde la cual se refactorizó la arquitectura modular en `app/`.

Se conserva aquí como **referencia funcional**: la paridad de la app modular se
verifica contra este archivo. No se despliega; el deploy usa `app/` (Vite).

## Mapa monolito → módulos

| En el monolito | Migrado a |
|---|---|
| `CATS` (taxonomía) | `app/src/config/categories.js` |
| `SYS` (system prompt) | `app/src/config/prompt.js` |
| `TARJETAS_MAP`, `CUENTAS_FALLBACK`, `resolveCard`, `isIwinAccount` | `app/src/config/accounts.js` |
| `callClaude`, `doImg`, `doText` | `app/src/services/claude.js` |
| `loadCuentas`, `doSheet`, `doEmpresasSheet`, `appendRow` | `app/src/services/sheets.js` |
| `tryGIS`, `onTok`, `signOut` | `app/src/services/auth.js` |
| `onImg` (HEIC→JPEG canvas) | `app/src/utils/imageProcessor.js` |
| `fmtCOP`, `today`, `fmtDate`, montos | `app/src/utils/formatters.js` |
| `hist`, `save`, `renderH` | `app/src/services/history.js` |
| pantallas + `go()` + CET | `app/index.html` + `app/src/main.js` |

La lógica de intake conversacional (WhatsApp/SilvIA) que no existía en el
monolito vive en `netlify/functions/` (API) y `silvia/` (tools).
