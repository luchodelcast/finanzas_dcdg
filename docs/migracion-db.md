# Migración a base de datos (Neon Postgres)

El Google Sheet dejó de ser la base de datos. Ahora la **fuente de verdad es
Postgres (Neon)** y el Sheet quedó como **espejo de exportación** (se sigue
llenando best-effort por si necesitas exportar/ver, pero ya no manda; si alguien
lo edita a mano no afecta al sistema).

## Por qué

- **Integridad:** llave `UNIQUE(idempotency_key)` + `INSERT … ON CONFLICT DO
  NOTHING` elimina los duplicados en el motor, inmune a reintentos y a escrituras
  en carrera. Se acabó el problema que veníamos parchando con heurísticas.
- **Control de acceso:** nadie edita la DB a mano; solo el backend con su token.
- **Consultas reales:** SQL responde cualquier pregunta (comparativos, rangos,
  búsquedas) — no solo el resumen fijo de antes.

## Arquitectura

```
  PWA ─┐
SilvIA ┼─▶  Backend (Netlify Functions)  ──▶  Postgres (Neon)   ← fuente de verdad
Aquí ──┘     registrarMovimiento()                  │
Dashboard    consultar()/resumen() = SQL            │ espejo best-effort
                                                     ▼
                                             Google Sheet (solo backup/lectura)
```

## Puesta en marcha (una sola vez)

1. **Crear proyecto en Neon** (https://neon.tech, plan gratis). Copia el
   *connection string* (formato `postgresql://usuario:clave@host/db?sslmode=require`).
2. **Cargar el esquema:** abre el editor SQL de Neon y pega el contenido de
   [`sql/schema.sql`](../sql/schema.sql). Es idempotente (se puede re-ejecutar).
3. **Configurar Netlify** (sitio `dcdg`): en *Site settings → Environment
   variables* agrega:
   - `DATABASE_URL` = el connection string de Neon.
4. **Redeploy** del sitio para que las funciones tomen la variable.

No hay que migrar el histórico: la DB **arranca desde la fecha de corte** (hoy).
Lo viejo se queda en el Sheet como archivo.

## Componentes

| Archivo | Rol |
|---|---|
| `sql/schema.sql` | DDL: `movimientos`, `empresas_mov`, `eventos`, y (Fase 1.5) `cuentas`/`categorias`/`reglas`. |
| `_lib/db.js` | Cliente Neon (import perezoso; inyectable en tests). |
| `_lib/repo.js` | Única capa que habla con la DB (insert/dedup/update/consulta). |
| `_lib/idempotency.js` | Deriva la llave de idempotencia del movimiento. |
| `_lib/finanzas.js` | Lógica: DB-primero + espejo al Sheet + reglas iWin/Delca2. |
| `_lib/sheet-mirror.js` | Espejo best-effort al Sheet (no bloquea la transacción). |
| `api-movimientos.js` | `GET/POST /api/movimientos` — lista/búsqueda para SilvIA y dashboard. |

## Idempotencia — cómo funciona

Cada movimiento lleva una `idempotency_key`:

- Si el llamador manda `source_msg_id` (p. ej. el id del mensaje de WhatsApp) o
  una `idempotency_key` explícita, se respeta (señal fuerte de "es lo mismo").
- Si no, se deriva de `tipo|fecha|monto|comercio` normalizado.

Un reintento con la misma llave devuelve `ya_existia: true` sin crear otra fila.
El dedup por **ventana de ±3 días** (monto ±1 · comercio) se conserva como
**pregunta humana** (`posible_duplicado`) para el caso "lo re-registro otro día".
Cuando confirmas (`confirmar: true`) un duplicado genuino, se fuerza una llave
única para que sí entre la segunda fila.

## Siguientes fases (no incluidas aquí)

- **Fase 1.5 — config-como-datos:** poblar/leer `cuentas`, `categorias`, `reglas`
  desde la DB para editarlas sin deploy.
- **Fase 2 — dashboard online:** página en el sitio Netlify (auth Google que ya
  existe) que consume `/api/movimientos` y `/api/resumen` con gráficos.
- **Export programada:** función agendada que vuelca la DB al Sheet como backup
  completo (hoy el espejo es incremental por escritura).
