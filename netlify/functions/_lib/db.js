/**
 * _lib/db.js — Cliente Postgres (Neon) para el backend.
 *
 * Usa el driver serverless de Neon sobre HTTP (plain fetch, sin WebSocket ni
 * pool), ideal para Netlify Functions. OJO: la función que devuelve `neon(url)`
 * NO tiene método `.query`; se invoca directamente como `sql(text, params)` y
 * devuelve las filas. Por eso `makeClient` la envuelve en un objeto con `.query`
 * (la interfaz que espera `repo.js`, y que los tests falsean fácilmente).
 *
 * El paquete se importa de forma perezosa (dynamic import) dentro de getSql():
 * así los tests que inyectan un `sql` falso —o los módulos que solo usan
 * funciones puras— no necesitan el paquete instalado.
 */

import { config } from './env.js';

let _sql = null;

/**
 * Adapta la función cruda de neon (`sql(text, params) -> rows`) a un objeto con
 * `.query(text, params) -> rows`. Pura y testeable (guarda el shape esperado).
 */
export function makeClient(rawQueryFn) {
  return { query: (text, params) => rawQueryFn(text, params) };
}

/**
 * Devuelve el cliente `sql` (lo crea la primera vez). Async porque importa el
 * driver de forma perezosa. Lanza si falta DATABASE_URL.
 */
export async function getSql() {
  if (_sql) return _sql;
  const url = config.databaseUrl();
  const { neon } = await import('@neondatabase/serverless');
  _sql = makeClient(neon(url));
  return _sql;
}

/** Reemplaza el cliente por uno falso en tests. Pasa null para restaurar. */
export function setSqlForTests(fake) {
  _sql = fake;
}

/** ¿Está configurada la base de datos? (para degradar con gracia si aún no). */
export function dbConfigured() {
  return !!config.databaseUrlOrNull();
}
