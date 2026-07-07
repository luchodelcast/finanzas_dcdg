# AUTOBUILD — construcción autónoma de funcionalidades (24/7)

Hermano proactivo de [AUTOFIX.md](AUTOFIX.md). Mientras Autofix **arregla bugs**
de una cola de issues, Autobuild **añade funcionalidades** de una cola de issues.
Corre solo, día y noche, para que el sistema crezca sin que Luis lo pida en cada
prompt: "operar con loops en vez de prompts".

> Configuración elegida por Luis: **máxima autonomía** (auto-merge con CI verde,
> con un candado de operaciones irreversibles), **cola = issues `autobuild` +
> auto-propuesta**, **avisos por WhatsApp + email + CHANGELOG**, **cadencia 24/7**.

## Cómo se dispara

- Una **rutina programada de Claude Code** cada ~3 horas abre una sesión fresca y
  ejecuta este procedimiento (una funcionalidad por corrida).
- Una **rutina de digest** una vez al día resume las últimas 24 h para Luis.

## Procedimiento por corrida

1. **Sincroniza `main`** (`git fetch && checkout main && pull`). Instala deps si
   hace falta (`npm ci`).
2. **Lee el backlog:** issues abiertos con label **`autobuild`**, ordenados por
   prioridad (label `prioridad-alta` > reacciones 👍 > antigüedad).
   **NO TOMES** (déjalos intactos — sin construir, sin abrir PR y **sin cambiarles
   ni una etiqueta**):
   - **`propuesta`** — es la **compuerta de aprobación de Luis**. Un issue con
     `propuesta` NO está aprobado: espera a que **Luis** le quite esa etiqueta.
     Construir uno con `propuesta` (o quitársela tú para construirlo) es una
     **violación del proceso** — nunca lo hagas, por más listo que esté el pedido.
   - **`autobuild-espera`** / **`needs-review`** o con un **PR abierto** — ya hay
     trabajo esperando revisión; no lo rehagas.
   - **`autobuild-wip`** — otra corrida ya lo tomó.
   - Marcados **🔒 BLOQUEADA / "depende de #N"** cuya dependencia **no esté
     fusionada** en `main` todavía. Verifícalo antes de empezar.

   Solo es elegible un issue `autobuild` **sin** ninguna de esas etiquetas y con
   sus dependencias ya fusionadas.
3. **Si el backlog está vacío:** **propón UNA** funcionalidad nueva creando un
   issue `autobuild` + `propuesta` (con contexto y valor), **avísale a Luis del
   pendiente** (ver "Notificación" — una propuesta sin avisar es invisible) y
   **termina sin construir**. Luis la aprueba (le quita `propuesta`) para que una
   corrida futura la tome. Nunca construyas algo que no esté en la cola.
4. **Toma el item más prioritario** que quepa en UNA corrida (alcance acotado; si
   es grande, divídelo en sub-issues y toma el primero). Márcalo con
   `autobuild-wip` para que otra corrida no colisione.
5. **Rama `autobuild/issue-<n>`.** Implementa siguiendo el estilo del código
   (mira los módulos vecinos). Añade/ajusta **tests**. Actualiza docs si aplica.
6. **Verifica:** `npm test` y `npm run build` **deben pasar**. Si no pasan y no lo
   puedes resolver en la corrida, deja el PR en **borrador** con lo hecho, comenta
   el bloqueo, quita `autobuild-wip` y termina.
7. **Triage de riesgo (máxima autonomía):**
   - **Regla general → auto-merge (squash) cuando CI esté verde.**
   - **CANDADO — NUNCA auto-fusiones (deja PR en borrador con label
     `needs-review` y avísalo en el digest):** operaciones **irreversibles o de
     seguridad** — borrar/renombrar/alterar columnas o tablas con datos,
     migraciones que transforman datos existentes, borrar filas de usuario,
     cambios a autenticación / `FINANZAS_USERS` / secretos / tokens, force-push, o
     cualquier cosa que mueva dinero hacia afuera. Ante la duda, trátalo como
     candado.
8. **CHANGELOG:** agrega una entrada en [`CHANGELOG.md`](CHANGELOG.md) (fecha,
   qué se añadió, PR, nivel de riesgo, si quedó en firme o en revisión).
9. **Avisa** (ver "Notificación"). Cierra el issue del backlog al fusionar
   (`Closes #<n>` en el PR).
10. **Una funcionalidad por corrida.** No encadenes varias; deja que la siguiente
    corrida tome la próxima. Esto mantiene los cambios pequeños y revisables.

## Barandas (lo que lo hace seguro)

- **Todo por PR + CI.** Nada se fusiona sin `npm test` + `npm run build` en verde.
- **Compuerta de aprobación (`propuesta`):** solo **Luis** aprueba una propuesta
  (quitándole la etiqueta). Autobuild **nunca** construye un issue con `propuesta`
  ni le cambia la etiqueta por su cuenta. Aprobar es decisión del dueño, no del agente.
- **Alcance de una feature** por corrida. Cambios pequeños y reversibles.
- **Candado de irreversibles/seguridad** (paso 7) incluso bajo máxima autonomía.
- **Convive con Autofix:** los **bugs tienen prioridad**. Si hay issues de autofix
  abiertos o un fix en vuelo sobre los mismos archivos, cede el paso.
- **Sin trabajo silencioso:** si difieres o recortas algo, déjalo escrito (comenta
  el issue) para que quede en el digest.
- **Producción:** cada merge a `main` despliega a Netlify. Por eso el CI es el
  guardián y el CHANGELOG es la ruta de reversa (revert del PR) si algo sale mal.

## Notificación (WhatsApp + CHANGELOG)

**Avisa SIEMPRE en estos tres momentos** (una propuesta o un merge sin avisar es
invisible para Luis — fue justo lo que falló al principio):

1. **Al crear una propuesta** (paso 3) — para que Luis sepa que hay algo que
   aprobar. Sin esto, las propuestas se acumulan calladas.
2. **Al fusionar una funcionalidad** (paso 9).
3. **Al dejar algo en revisión** bajo el candado (paso 7).

Canales:

- **WhatsApp (SilvIA)** — vía el endpoint `AUTOBUILD_NOTIFY_URL` (lo sirve
  `sl-crm-live`: `/api/silvia-autobuild-notify`). Con `curl` (la corrida tiene
  Bash):

  ```sh
  curl -s -X POST "$AUTOBUILD_NOTIFY_URL" \
    -H "x-autobuild-secret: $AUTOBUILD_NOTIFY_SECRET" \
    -H 'content-type: application/json' \
    -d "{\"message\": \"🔎 Nueva propuesta #41: backup de la DB al Sheet. Dime 'aprueba la 41' o revísala en https://github.com/luchodelcast/finanzas_dcdg/issues/41\"}"
  ```

  Si `AUTOBUILD_NOTIFY_URL`/`AUTOBUILD_NOTIFY_SECRET` no están en el entorno, no
  falles la corrida: deja el aviso en el CHANGELOG y sigue.
- **CHANGELOG.md** — siempre (queda versionado; es el canal garantizado y la
  red de seguridad si el WhatsApp no sale).

Formato sugerido del mensaje:
- Nuevo: `✅ Nuevo: <título> (PR #<n>). <una frase de qué hace y cómo usarlo>.`
- Por aprobar (propuesta): `🔎 Propuesta #<n> por aprobar: <título> — <valor en una frase>. Dime "aprueba la <n>" o revísala en <link>.`
- En revisión (candado): `🔒 Te espera para aprobar: <título> (PR borrador #<n>) — <por qué>.`

## Digest diario

Una corrida especial (1×/día) manda a Luis un resumen consolidado por WhatsApp
(vía `AUTOBUILD_NOTIFY_URL`). Debe incluir **dos bloques**:

- **Lo fusionado**: entradas del CHANGELOG de las últimas 24 h.
- **Pendiente de tu visto bueno**: TODOS los issues abiertos con label
  `propuesta` (no solo los de las últimas 24 h — mientras sigan sin aprobar,
  se repiten cada día para que no se pierdan) + los PR borrador `needs-review`.

`☀️ Buenos días. Anoche/hoy: <lista de lo fusionado>. Tienes <N> propuestas esperando tu OK: #<n> <título>, … — dime "aprueba la <n>" o revísalas en https://github.com/luchodelcast/finanzas_dcdg/issues?q=is:issue+is:open+label:propuesta`

## Cómo alimentar el backlog

- Cualquiera del equipo, o Luis, o **SilvIA** crea un issue con label `autobuild`
  describiendo la funcionalidad deseada ("sería bueno que…").
- Prioriza con el label `prioridad-alta` o reacciones 👍.
- Si la cola se vacía, Autobuild propone la siguiente (paso 3) para que Luis
  apruebe la dirección.
