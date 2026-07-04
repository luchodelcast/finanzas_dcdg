# Guía de despliegue — DCDG Finanzas

Guía paso a paso para dejar el sistema **100% operativo**: la PWA en Netlify, el
backend de finanzas (endpoints `/api/*`) y la integración con SilvIA por WhatsApp.

Estado de partida (ya hecho):
- Repo `luchodelcast/finanzas_dcdg` con el código modular en `main`.
- Sitio Netlify **`dcdg`** (`dcdg.netlify.app`) en el equipo *Finanzas DCDG*.
- Variables **no secretas** ya cargadas en el sitio: `GOOGLE_SPREADSHEET_ID`,
  `SHEET_GASTOS`, `SHEET_EMPRESAS`, `SHEET_CUENTAS`, `FINANZAS_USERS`,
  `ANTHROPIC_MODEL`, `ANTHROPIC_MODEL_FAST`, `NODE_VERSION=22`, y `DCDG_API_TOKEN`
  (secreto, generado).

Faltan **3 bloques** que solo puede hacer el owner: enlazar el repo, crear la
cuenta de servicio de Google, y configurar el lado de SilvIA.

---

## 1. Enlazar el repo al sitio `dcdg` (CI/CD)

En **app.netlify.com → sitio `dcdg` → Site configuration → Build & deploy →
Continuous deployment → "Link repository"**:

1. Proveedor **GitHub** → autoriza → repo **`luchodelcast/finanzas_dcdg`**.
2. Rama a desplegar: **`main`**.
3. Build command / Publish / Functions se autocompletan desde `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `app/dist`
   - Functions directory: `netlify/functions`
4. **Deploy site**.

Tras el primer build:
- ✅ La **PWA** queda en `dcdg.netlify.app` (reemplaza el monolito). Trae por
  defecto el Client ID de Google y el ID del Sheet; solo hay que pegar la
  Anthropic API key en **Ajustes** y conectar Google.
- Los endpoints `/api/*` quedan publicados pero **darán error hasta el paso 2**.

> Cada `git push` a `main` redeploya solo. El CI (GitHub Actions) corre `npm test`
> y `npm run build` en cada PR antes de fusionar.

---

## 2. Cuenta de servicio de Google (para escribir en el Sheet)

El backend escribe en el Sheet con una **cuenta de servicio** (sin sesión de
usuario). Una sola vez:

1. En **console.cloud.google.com** → crea o elige un proyecto.
2. **APIs y servicios → Biblioteca** → activa **Google Sheets API**.
3. **APIs y servicios → Credenciales → Crear credenciales → Cuenta de servicio**.
   - Nombre: p.ej. `dcdg-finanzas`. Crea la cuenta.
   - Copia su email: `dcdg-finanzas@<proyecto>.iam.gserviceaccount.com`.
4. En la cuenta creada → pestaña **Claves → Agregar clave → Crear clave nueva →
   JSON**. Se descarga un `.json`; ábrelo y ubica los campos `client_email` y
   `private_key`.
5. **Comparte el Google Sheet DCDG** (`1c5i7g…Q5N4NQ`) con ese `client_email`
   como **Editor** (botón Compartir, igual que con una persona).

Luego, en **Netlify → sitio `dcdg` → Environment variables**, agrega:

| Variable | Valor |
|---|---|
| `GOOGLE_SA_EMAIL` | el `client_email` de la cuenta de servicio |
| `GOOGLE_SA_PRIVATE_KEY` | el `private_key` completo del JSON (incluye `-----BEGIN PRIVATE KEY-----\n…`) |
| `ANTHROPIC_API_KEY` | tu llave de console.anthropic.com |

Notas:
- La `GOOGLE_SA_PRIVATE_KEY` puede pegarse tal cual (con `\n` escapados o con
  saltos reales); el código la normaliza (`netlify/functions/_lib/env.js`).
- Marca `GOOGLE_SA_PRIVATE_KEY` y `ANTHROPIC_API_KEY` como **secretas**.
- Tras agregarlas, dispara un redeploy (Deploys → Trigger deploy) para que las
  Functions tomen las nuevas variables.

### Probar el backend

Con las variables puestas, prueba el endpoint (reemplaza el token):

```bash
curl -sS https://dcdg.netlify.app/api/registrar-gasto \
  -H "authorization: Bearer <DCDG_API_TOKEN>" \
  -H "x-dcdg-user: luis@iwin.im" \
  -H "content-type: application/json" \
  -d '{"monto":"45000","descripcion":"prueba mercado D1","quien_pago":"Luis"}'
```

Respuesta esperada: `{"ok":true,"registrado":true,"categoria":"Alimentación",…}`
y una fila nueva en `Registro Gastos`.

---

## 3. Lado SilvIA (repo `sl-crm-live`)

Para que Luis y Carolina registren por **WhatsApp** (Opción B). En `sl-crm-live`:

### 3.1 Variables de entorno (Netlify de `sl-crm-live`)

| Variable | Valor |
|---|---|
| `DCDG_API_URL` | `https://dcdg.netlify.app` |
| `DCDG_API_TOKEN` | el **mismo** token del sitio `dcdg` |
| `FINANZAS_USERS` | `luis@iwin.im,carodz2@gmail.com` |

### 3.2 Acceso y rol

1. Agregar a **Carolina** al mapa `WHATSAPP_USERS` (env):
   `{"<telefono_carolina>": {"username":"carodz2@gmail.com","name":"Carolina"}}`.
2. En `netlify/functions/_lib/roles.js`, agregar `isFinanceUser` (ver
   `silvia/README.md` de este repo).
3. Excluir a Carolina de los proactivos del equipo (`SILVIA_PROACTIVE_USERS`).

### 3.3 Tools

Copiar `silvia/finanzas-tools.js` de este repo a `sl-crm-live` y engancharlo en
`buildTools()` de `netlify/functions/_lib/assistant.js`:

```js
import { buildFinanzasTools } from './finanzas-tools.js';
// dentro de buildTools(who, ...):
...(isFinanceUser(who.username) ? buildFinanzasTools({ who, betaZodTool, z }) : []),
```

Agregar además, **solo cuando `isFinanceUser`**, una sección de finanzas al
`SYSTEM`/`ctx` con el vocabulario de categorías/cuentas y las reglas clave
(cuentas iWin a ignorar, ingresos Delca2, tarjeta Jeeves = gasto + adelanto).

### 3.4 Probar por WhatsApp

Luis o Carolina escriben al número de SilvIA:
> "pagué 120mil de mercado en el D1 con la Nequi"

SilvIA debe responder algo como: *"Anotado ✅ Alimentación/Mercado $120.000,
Nequi Carolina."* y aparecer la fila en `Registro Gastos`.

---

## 4. Resumen de variables de entorno

### Sitio `dcdg` (backend + PWA)
```
# Ya cargadas
GOOGLE_SPREADSHEET_ID, SHEET_GASTOS, SHEET_EMPRESAS, SHEET_CUENTAS,
FINANZAS_USERS, ANTHROPIC_MODEL, ANTHROPIC_MODEL_FAST, NODE_VERSION, DCDG_API_TOKEN
# Faltan (paso 2)
ANTHROPIC_API_KEY, GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY
```

### Sitio `sl-crm-live` (SilvIA)
```
DCDG_API_URL, DCDG_API_TOKEN, FINANZAS_USERS
+ Carolina en WHATSAPP_USERS
```

---

## 5. Checklist

- [ ] Repo enlazado al sitio `dcdg` (paso 1), primer deploy OK.
- [ ] PWA abre en `dcdg.netlify.app`, se conecta a Google y registra un gasto.
- [ ] Cuenta de servicio creada y Sheet compartido como Editor (paso 2).
- [ ] `ANTHROPIC_API_KEY`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` en Netlify.
- [ ] `curl` a `/api/registrar-gasto` devuelve `ok:true` y escribe en el Sheet.
- [ ] SilvIA: vars + `isFinanceUser` + Carolina + tools (paso 3).
- [ ] Prueba real por WhatsApp registra en el Sheet.
