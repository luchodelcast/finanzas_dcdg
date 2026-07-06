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
   prioridad (label `prioridad-alta` > reacciones 👍 > antigüedad). **Ignora** los
   que ya tengan un PR abierto o el label `autobuild-wip` (otra corrida los tomó).
3. **Si el backlog está vacío:** **propón UNA** funcionalidad nueva creando un
   issue `autobuild` + `propuesta` (con contexto y valor), y **termina sin
   construir**. Luis la aprueba (le quita `propuesta`) para que una corrida futura
   la tome. Nunca construyas algo que no esté en la cola.
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
- **Alcance de una feature** por corrida. Cambios pequeños y reversibles.
- **Candado de irreversibles/seguridad** (paso 7) incluso bajo máxima autonomía.
- **Convive con Autofix:** los **bugs tienen prioridad**. Si hay issues de autofix
  abiertos o un fix en vuelo sobre los mismos archivos, cede el paso.
- **Sin trabajo silencioso:** si difieres o recortas algo, déjalo escrito (comenta
  el issue) para que quede en el digest.
- **Producción:** cada merge a `main` despliega a Netlify. Por eso el CI es el
  guardián y el CHANGELOG es la ruta de reversa (revert del PR) si algo sale mal.

## Notificación (WhatsApp + email + CHANGELOG)

Al terminar cada corrida (y en el digest diario), informa a Luis de forma breve y
humana ("qué hay de nuevo"):

- **CHANGELOG.md** — siempre (queda versionado; es el canal garantizado).
- **WhatsApp (SilvIA) + email** — vía el endpoint de notificación configurado
  (`AUTOBUILD_NOTIFY_URL`, reusando el canal de SilvIA). Si no está configurado,
  el CHANGELOG y el digest quedan igual.

Formato sugerido del aviso:
`✅ Nuevo: <título> (PR #<n>). <una frase de qué hace y cómo usarlo>.`
Y para lo que quedó en revisión:
`🔎 Te espera para aprobar: <título> (PR borrador #<n>) — <por qué>.`

## Digest diario

Una corrida especial (1×/día) recorre las entradas del CHANGELOG de las últimas
24 h y manda a Luis un resumen consolidado por WhatsApp + email:
`☀️ Buenos días. Anoche/hoy: <lista de lo fusionado>. Pendiente de tu visto bueno: <lista de borradores>.`

## Cómo alimentar el backlog

- Cualquiera del equipo, o Luis, o **SilvIA** crea un issue con label `autobuild`
  describiendo la funcionalidad deseada ("sería bueno que…").
- Prioriza con el label `prioridad-alta` o reacciones 👍.
- Si la cola se vacía, Autobuild propone la siguiente (paso 3) para que Luis
  apruebe la dirección.
