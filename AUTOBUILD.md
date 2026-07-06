# AUTOBUILD — Construcción automática de funcionalidad para DCDG Finanzas

> **STATUS: ACTIVE**
> Cambia a `STATUS: PAUSED` para detener el autobuild. Si esta línea no dice
> exactamente `STATUS: ACTIVE`, **no hagas nada y termina**.

Este documento es el procedimiento que sigue una sesión programada de Claude Code
("el agente autobuild") para construir **mejoras y funcionalidad nueva** del
**sistema de Finanzas Familiares DCDG** a partir de issues que Luis (o Carolina)
abren directamente en este repo. A diferencia de [`AUTOFIX.md`](AUTOFIX.md) (que
arregla reportes de fallas encolados por SilvIA vía WhatsApp), autobuild **no**
depende de SilvIA: el dueño describe lo que quiere en un GitHub Issue y el agente
lo construye.

> ⚠️ **Este repo maneja la contabilidad familiar real.** Sé **más conservador**
> que en un proyecto normal: ante cualquier duda, abre borrador y espera OK. Ante
> la duda de si algo es lo bastante grande/ambiguo como para merecer aprobación
> previa, trátalo como propuesta (ver abajo) en vez de construirlo directo.

## Cómo funciona el circuito

1. Luis (o Carolina) abre un **GitHub Issue** en este repo describiendo la mejora
   o funcionalidad que quiere, con el label **`autobuild`**.
2. **Tú (agente autobuild)** te despiertas por el Trigger, lees los issues abiertos
   con ese label y los atiendes según este documento.
3. Si el issue es claro y de alcance acotado: lo construyes directo (rama → PR →
   CI → merge/borrador, según riesgo).
4. Si el issue (o una idea que tú mismo detectas útil) es grande o ambigua:
   abres una **propuesta** — un issue nuevo, label `autobuild` + `propuesta`,
   explicando qué harías y por qué — y **esperas la aprobación del dueño** antes
   de construir nada.

## La cola

- Trabaja **solo** issues abiertos con label `autobuild`.
- Ignora los que tengan el label **`propuesta`** (esperan aprobación: el dueño la
  aprueba quitando el label, o la rechaza cerrando el issue). No los construyas.
- Ignora los que ya tengan un PR abierto vinculado (evita duplicar trabajo).
- Ignora los que tengan el label `autobuild-espera` (esperan decisión del dueño
  sobre un borrador ya abierto).
- **Prioriza** primero los que tengan 👍 o el label `prioridad-alta`; luego los
  más antiguos.
- Máximo **5 issues por corrida** (contando tanto construcción directa como
  propuestas nuevas que abras). Si hay más trabajo, deja el resto para la
  siguiente corrida.

## Cuándo proponer en vez de construir directo

Abre una **propuesta** (issue nuevo con `autobuild` + `propuesta`, sin PR) en vez
de construir directo cuando el issue original:

- Define un **flujo nuevo** (p. ej. ingesta de archivos, un motor de conciliación)
  cuyo diseño/formato conviene que el dueño confirme antes de escribir código.
- Es **ambiguo** en alcance o deja decisiones de producto abiertas (qué banco,
  qué campos, qué pasa con los duplicados, etc.).
- Toca algo de la lista de "sensible" (ver abajo) **y además** es una funcionalidad
  nueva (no un ajuste puntual) — para eso mejor que el dueño vea el plan primero.

La propuesta debe explicar: qué construirías, alcance acotado sugerido, y por qué
pediste aprobación en vez de construir directo. Termina con las tres opciones para
el dueño (aprobar quitando `propuesta`, rechazar cerrando, priorizar con 👍 o
`prioridad-alta`) — ver el issue #24 como ejemplo de formato.

Si el issue original que la disparó sigue abierto, coméntale que abriste la
propuesta enlazándola; no lo cierres.

## Guardas absolutas (para cualquier issue, incluso ya aprobado)

- **Nunca** hagas push directo a `main` ni force-push: siempre rama + PR + CI.
- **Nunca** toques ni imprimas secretos/tokens/env: la API key de Anthropic, las
  credenciales de la cuenta de servicio de Google (`GOOGLE_SA_*`), el
  `DCDG_API_TOKEN`, ni ninguna otra. No deshabilites verificación TLS ni auth.
- **NUNCA** operaciones destructivas sobre el **Google Sheet real** ni migraciones
  de datos, ni borrar/renombrar hojas, ni scripts que muevan/borren filas o dinero,
  **sin confirmación explícita del dueño**. Los datos financieros son reales.
- Para probar clasificación/escritura, usa **fixtures o un Sheet de staging**,
  **jamás** el libro real (`1c5i7g…Q5N4NQ`).
- No incluyas el identificador del modelo en commits/PR/código (solo en chat).

### Sensible en finanzas → PR **borrador** + label `autobuild-espera` + espera OK

Aunque el issue esté aprobado y tenga alcance claro, **NO auto-mergees** si el
cambio toca:

- **Reglas de clasificación** (`app/src/config/rules.js`, categorías, cuentas,
  filtros iWin/Delca2 en `app/src/config/iwin.js`/`accounts.js`).
- **Escritura en Sheets** (`netlify/functions/_lib/sheets.js`, `finanzas.js`,
  `app/src/services/sheets.js`) o el formato de filas de `Registro Gastos`/`EMPRESAS`.
- El **EmailBot** (`scripts/DCDG_EmailBot_v4.gs`) o la conciliación de extractos.
- Cambios de **esquema** (tablas/columnas nuevas en Sheets, nuevas hojas).
- Cualquier cosa que **mueva, borre o recalcule dinero o filas**, o toque
  `auth`, `env`, `netlify.toml`, o la API de finanzas (`netlify/functions/api-*`).

En esos casos: abre el PR en **borrador**, pon `autobuild-espera` en el issue,
comenta qué construiste y **espera la aprobación del dueño**. No mergees.

### Bajo riesgo → se puede auto-mergear (tras CI)

Funcionalidad **aditiva y de solo lectura** (nuevas tarjetas/filtros en dashboard,
totales, comparativos) que reusa endpoints/funciones ya existentes sin cambiar su
contrato; texto/copys de la PWA, estilos, documentación (`docs/`, `README.md`).
Nada que toque Sheets en escritura, clasificación, EmailBot, esquema, seguridad
ni datos.

## Procedimiento por issue

1. **Lee** el issue (título + cuerpo + reacciones/labels de prioridad).
2. **Triage**: ¿se entiende el alcance?, ¿es código de este repo?, ¿es lo bastante
   grande/ambiguo como para merecer propuesta (ver arriba)?
   - Si falta info: comenta pidiendo detalle, pon `autobuild-espera` y sigue con
     el siguiente. No cierres el issue.
   - Si merece propuesta: ábrela (ver arriba) y sigue con el siguiente issue de
     la cola. No construyas nada todavía.
3. **Rama**: `autobuild/issue-<n>` desde `main` actualizado.
4. **Construye** el cambio más pequeño y localizado que resuelva el issue. Sigue
   el estilo del código vecino y las convenciones ya establecidas (reglas puras
   reusadas en front/back, endpoints existentes antes que nuevos, etc.). Nada de
   refactors grandes ni de alcance mayor al pedido.
5. **Verifica** (obligatorio):
   - `node --check` en los archivos JS tocados.
   - `npm test` (pruebas unitarias — reglas, formatters, finanzas).
   - `npm run build` (la PWA compila).
   - Si agregaste una función pura nueva o tocaste una regla, **agrega un test**
     en `tests/` que cubra el caso. No pruebes contra el Sheet real.
6. **PR** hacia `main`:
   - Cuerpo: qué construiste y por qué, `Closes #<n>`.
   - Termina el cuerpo con la firma estándar de PRs del repo.
7. **Espera el CI** (GitHub Actions, job **"Tests y build"**) en verde.
8. **Merge**:
   - Cambio **de bajo riesgo** + CI verde → **squash-merge**.
   - Cambio **sensible** (ver arriba) → **no mergees**: deja el PR en **borrador**,
     `autobuild-espera` en el issue, y comenta el resumen para que el dueño decida.
9. **Comenta** en el issue el resultado (PR, estado del CI, decisión).

## Interruptor de apagado

- **Repo:** cambia `STATUS: ACTIVE` (arriba) a `PAUSED`.

## Configuración (una sola vez)

### Labels en este repo
`autobuild`, `propuesta`, `prioridad-alta`, `autobuild-espera`, `enhancement`,
`confiable`. (GitHub los crea solos al usarlos en un issue; puedes pre-crearlos
en Settings → Labels.)

### Trigger de Claude Code (lo crea Luis, una vez)
En claude.ai/code → entorno de `finanzas_dcdg` → Automations/Triggers → Trigger
**horario** (o por evento de issue) con el prompt:
> Sigue AUTOBUILD.md.
