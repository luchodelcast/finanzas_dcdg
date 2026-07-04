# DCDG Finanzas

Sistema de control financiero familiar DCDG, refactorizado desde el monolito
`DCDG_Captura_v5.html` hacia una **arquitectura modular** con dos frentes:

1. **PWA** (`app/`) — captura y clasificación de gastos (Vite + JS modular).
2. **API de finanzas** (`netlify/functions/`) — backend que **SilvIA** consume por
   WhatsApp para **registrar facturas, pagos y gastos** (Opción B del doc de integración).

> **Paridad con el monolito:** la PWA modular replica la funcionalidad de
> `legacy/DCDG_Captura_v5.html` (setup/ajustes, captura por foto/galería/texto,
> creación de CET, pantalla de confirmación con dropdowns de categoría, aviso de
> umbral < $10.000, aviso iWin, badge de confianza, resolución tarjeta→cuenta,
> carga dinámica de `⚙️ CUENTAS`, escritura a `Registro Gastos` y préstamo en
> `EMPRESAS`, historial local). El mapeo monolito→módulos está en
> [`legacy/README.md`](legacy/README.md). Fix aplicado: modelo `claude-sonnet-4-6`
> (configurable) en vez del deprecado.

---

## Estructura

```
finanzas_dcdg/
├── app/                                # PWA (Vite)
│   ├── index.html
│   ├── vite.config.js
│   ├── public/manifest.json
│   └── src/
│       ├── main.js                     # Orquestador de UI (todas las pantallas)
│       ├── config/
│       │   ├── env.js                  # Config centralizada (reemplaza hardcode)
│       │   ├── categories.js           # Taxonomía CATS (14 categorías)
│       │   ├── prompt.js               # System prompt DCDG (SYS)
│       │   ├── rules.js                # Reglas de clasificación DCDG (fuente única)
│       │   ├── accounts.js             # Mapa tarjetas → cuentas + resolveCard/isIwin
│       │   └── iwin.js                 # Filtros cuentas iWin / Delca2
│       ├── services/
│       │   ├── claude.js               # Wrapper Anthropic (navegador)
│       │   ├── sheets.js               # Wrapper Sheets (values:append + loadCuentas)
│       │   ├── auth.js                 # Google OAuth (GIS)
│       │   └── history.js              # Historial local (localStorage)
│       └── utils/
│           ├── imageProcessor.js       # HEIC→JPEG, resize
│           └── formatters.js           # COP, fechas, montos
├── netlify/functions/                  # API de finanzas (Functions v2)
│   ├── _lib/
│   │   ├── env.js                      # Config backend (Service Account, tokens)
│   │   ├── http.js                     # Auth Bearer + gate isFinanceUser
│   │   ├── anthropic.js                # Wrapper Anthropic (backend)
│   │   ├── sheets.js                   # Service Account (JWT RS256) + batchUpdate
│   │   ├── classify.js                 # Reglas + fallback modelo
│   │   ├── finanzas.js                 # Núcleo: registrar movimiento + resumen
│   │   └── handlers.js                 # Handlers reutilizables
│   ├── api-registrar-gasto.js          # POST /api/registrar-gasto
│   ├── api-registrar-pago.js           # POST /api/registrar-pago
│   ├── api-registrar-factura.js        # POST /api/registrar-factura
│   ├── api-resumen.js                  # GET|POST /api/resumen
│   └── api-clasificar.js               # POST /api/clasificar
├── silvia/finanzas-tools.js            # Tools delgadas para pegar en SilvIA (sl-crm-live)
├── scripts/                            # Google Apps Scripts (EmailBot v4, Corregir)
├── legacy/DCDG_Captura_v5.html         # Monolito original (referencia de paridad)
├── docs/                               # arquitectura, reglas, cuentas
├── tests/                              # node --test (reglas, formatters, finanzas)
├── netlify.toml
├── .env.example
└── package.json
```

---

## Puesta en marcha

```bash
npm install
cp .env.example .env      # completa credenciales
npm test                  # 25 pruebas unitarias (sin red)
npm run dev               # PWA en local (Vite)
```

### Variables de entorno
Ver `.env.example`. Las críticas:

| Variable | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Clasificación (backend). Reemplaza modelo deprecado por `claude-sonnet-4-6`. |
| `GOOGLE_SPREADSHEET_ID` | Libro maestro DCDG. |
| `GOOGLE_SA_EMAIL` / `GOOGLE_SA_PRIVATE_KEY` | Service Account para escribir en Sheets sin sesión de usuario. |
| `DCDG_API_TOKEN` | Token de servicio que SilvIA envía como `Authorization: Bearer`. |
| `FINANZAS_USERS` | Correos autorizados al carril de finanzas. |

---

## API de finanzas (para SilvIA)

Todas las rutas exigen:
- `Authorization: Bearer <DCDG_API_TOKEN>`
- `X-DCDG-User: <correo>` — debe estar en `FINANZAS_USERS`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/registrar-gasto` | Registra un gasto familiar. |
| POST | `/api/registrar-pago` | Registra el pago de una obligación. |
| POST | `/api/registrar-factura` | Registra una factura recibida. |
| GET/POST | `/api/resumen` | Totales por periodo/categoría/persona. |
| POST | `/api/clasificar` | Clasifica sin escribir en Sheets. |

**Body de registro** (los tres tipos comparten shape):
```json
{
  "monto": "120mil",
  "descripcion": "mercado en el D1",
  "quien_pago": "Carolina",
  "metodo_pago": "Nequi Carolina",
  "fecha": "2026-07-04",
  "categoria": "",
  "subcategoria": "",
  "tarjeta_ultimos4": "",
  "notas": ""
}
```
`monto` acepta texto humano (`"120mil"`, `"45.000"`, `"1.2M"`). Si faltan
`categoria`/`subcategoria`, el backend clasifica con las reglas DCDG (y modelo
como fallback). Aplica los filtros iWin/Delca2 y, si el pago fue con la TC iWin
(Jeeves), registra además el adelanto en `EMPRESAS`.

**Respuesta:**
```json
{ "ok": true, "registrado": true, "categoria": "Alimentación", "subcategoria": "Mercado",
  "monto": 120000, "monto_fmt": "$120.000", "metodo_pago": "Nequi Carolina",
  "mensaje": "Anotado ✅ Alimentación/Mercado $120.000, Nequi Carolina." }
```

### Enganche en SilvIA
Ver `silvia/finanzas-tools.js` y `silvia/README.md`: son tools delgadas que se
pegan en `buildTools()` de `sl-crm-live`, gateadas por `isFinanceUser`.

---

## Decisiones de arquitectura

- **Opción B** (doc de integración): la lógica financiera vive **aquí**, SilvIA
  solo conversa y hace HTTP. Reglas versionadas y testeadas.
- **Service Account** para Sheets: el bot escribe sin sesión de usuario.
- **`batchUpdate` + `sheetId` numérico**: evita el bug de `:append` con emoji en
  `⚙️ CUENTAS` (sección 9 del doc).
- **Sin dependencias de runtime**: Anthropic y Sheets vía `fetch`; el JWT de la
  Service Account se firma con `node:crypto`. Solo `vite` como devDependency.
- **Fuente única de reglas**: `app/src/config/rules.js` se reutiliza en el backend
  (`netlify/functions/_lib/classify.js`) — no se duplica la clasificación.

Ver `docs/` para detalle de arquitectura, reglas y cuentas.
