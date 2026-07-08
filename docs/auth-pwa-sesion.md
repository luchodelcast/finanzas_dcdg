# Auth de la PWA — Google Sign-In + token de sesión

Reemplaza el OAuth de *access token* del navegador (que pedía el scope pesado
`spreadsheets` y hacía reaparecer la pantalla de autorización de Google) por el
modelo del CRM/SilvIA: **el navegador solo se identifica** (Google Sign-In, ID
token) y el backend emite un **token de sesión propio** (HMAC, 12 h). Todas las
lecturas/escrituras de Google Sheets ocurren ahora en el backend con la cuenta
de servicio.

## Flujo

1. La PWA carga `accounts.google.com/gsi/client` y muestra el botón oficial de
   **Google Sign-In** (`google.accounts.id`, `auto_select`). Sin scopes de API.
2. Al iniciar sesión, el ID token va a **`POST /api/pwa-login`**, que lo valida
   (tokeninfo → `aud` = nuestro client_id, `email_verified`, email en
   `FINANZAS_USERS`) y devuelve un **token de sesión** (12 h).
3. La PWA guarda el token en `localStorage` (`dcdg_session`) y lo manda como
   `Authorization: Bearer …` en cada request. Dentro de las 12 h no vuelve a
   hablar con Google en cada recarga → se acaba el prompt recurrente.
4. Los endpoints `pwa-*` aceptan el token de sesión **o** (por compatibilidad
   durante la transición) el access token de Google viejo (`resolvePwaUser`).

## Configuración necesaria (una sola vez)

- **Netlify → Environment variables:** agregar **`AUTH_SECRET`** (una cadena
  aleatoria larga; sirve para firmar el token de sesión). Sin ella,
  `/api/pwa-login` responde 503 y la PWA no puede iniciar sesión.
  Ya existen: `GOOGLE_CLIENT_ID`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`,
  `GOOGLE_SPREADSHEET_ID`, `FINANZAS_USERS`, `DCDG_API_TOKEN`.
- **Google Cloud Console → Credenciales → el OAuth Client ID:** confirmar
  `https://dcdg.netlify.app` en *Authorized JavaScript origins* (ya estaba para
  el flujo anterior; Sign-In usa el mismo).
- **Google Cloud Console → OAuth consent screen:** conviene publicarla en
  *In production* (con Sign-In ya no se piden scopes sensibles, así que deja de
  ser fuente de re-prompts).
- **Sheets:** el libro DCDG debe estar compartido como *editor* con
  `GOOGLE_SA_EMAIL` (ya lo está, porque SilvIA escribe por ahí).

## Rollout (importante)

El deploy-preview **no** sirve para probar Google (su dominio no está en los
orígenes autorizados), así que esto se valida en **producción**. Antes de
fusionar a `main`: setear `AUTH_SECRET` en Netlify. Tras fusionar y desplegar,
probar en `dcdg.netlify.app`: iniciar sesión una vez, cerrar y reabrir → debe
entrar sin volver a pedir autorización, y registrar un gasto/CET debe escribir
en la DB + espejo Sheet vía backend.
