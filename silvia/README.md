# Integración SilvIA — carril de finanzas DCDG

Este directorio contiene el **snippet de referencia** para enganchar las finanzas
DCDG dentro de **SilvIA** (repo `luchodelcast/sl-crm-live`), siguiendo la
**Opción B** del documento de integración: SilvIA solo conversa; la lógica vive
en `dcdg-finanzas` (este repo) detrás de su API.

> `finanzas-tools.js` **no corre en este repo** — es código para pegar en SilvIA.

## Pasos para activarlo en `sl-crm-live`

### F0 — Acceso (cambio pequeño en SilvIA)
1. **Agregar a Carolina** a `WHATSAPP_USERS` (env Netlify de SilvIA):
   `{"<telefono_carolina>": {"username":"carodz2@gmail.com","name":"Carolina"}}`.
2. **Nuevo rol** en `netlify/functions/_lib/roles.js`:
   ```js
   export function isFinanceUser(username) {
     const list = String(process.env.FINANZAS_USERS || 'luis@iwin.im,carodz2@gmail.com')
       .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
     return !!username && list.includes(username.toLowerCase());
   }
   ```
3. Excluir a Carolina de los proactivos del equipo (allowlist `SILVIA_PROACTIVE_USERS`).

### F1 — Tools de finanzas
En `netlify/functions/_lib/assistant.js`, dentro de `buildTools(who, ...)`:
```js
import { buildFinanzasTools } from './finanzas-tools.js'; // copia este archivo a SilvIA
// ...
...(isFinanceUser(who.username)
  ? buildFinanzasTools({ who, betaZodTool, z })
  : []),
```
Y agrega al `SYSTEM`/`ctx` **solo cuando `isFinanceUser`** una sección con el
vocabulario de categorías/cuentas y las reglas clave (cuentas iWin a ignorar,
ingresos Delca2, tarjeta Jeeves = gasto + adelanto en `EMPRESAS`).

### Env requerido en SilvIA
```
DCDG_API_URL=https://<tu-deploy-dcdg-finanzas>.netlify.app
DCDG_API_TOKEN=<mismo token que dcdg-finanzas>
FINANZAS_USERS=luis@iwin.im,carodz2@gmail.com
```

## Tools expuestas

| Tool | Endpoint | Para |
|---|---|---|
| `registrar_gasto` | `POST /api/registrar-gasto` | "gasté X en Y", "anota el mercado" |
| `registrar_pago` | `POST /api/registrar-pago` | "pagué la luz", "aboné a la tarjeta" |
| `registrar_factura` | `POST /api/registrar-factura` | "llegó la factura de X por Y" |
| `consultar_finanzas` | `POST /api/resumen` | "¿cuánto llevamos este mes?" |

## Aislamiento (crítico)

- Todo el carril financiero está **gateado por `isFinanceUser`**: el resto del
  equipo de Superlikers nunca ve estas tools ni el prompt de finanzas.
- Carolina **no** es de `CRM_USERS`, así que no obtiene tools comerciales.
- Los datos van **solo** al Google Sheet DCDG, nunca a los Blobs del CRM.

## Pendiente (F3) — Foto de recibo por WhatsApp
Hoy `whatsapp.js` procesa texto y audio, no imagen. Para capturar recibos por
foto: detectar mensajes `image`, bajar la media con `_lib/wa.js`, y enviar la
imagen a Claude con visión (patrón análogo a `transcribe.js`) → `registrar_gasto`.
Mientras tanto, la foto se sigue haciendo por la PWA.
