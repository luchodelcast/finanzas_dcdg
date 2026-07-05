/**
 * _lib/db.js — Cliente Postgres (Neon) para el backend.
 *
 * Usa el driver serverless de Neon sobre HTTP, ideal para Netlify Functions
 * (sin conexiones persistentes ni pool que administrar). `sql.query(text, params)`
 * parametriza los valores (previene inyección).
 *
 * El paquete `@neondatabase/serverless` se importa de forma perezosa (dynamic
 * import) dentro de getSql(): así los tests que inyectan un `sql` falso —o los
 * módulos que solo usan funciones puras— no necesitan el paquete instalado.
 *
 * Inyectable para tests: `setSqlForTests(fake)` reemplaza el cliente.
 */

import { config } from './env.js';

let _sql = null;

/**
 * Devuelve el cliente `sql` (lo crea la primera vez). Async porque importa el
 * driver de forma perezosa. Lanza si falta DATABASE_URL.
 */
export async function getSql() {
  if (_sql) return _sql;
  const url = config.databaseUrl();
  const { neon } = await import('@neondatabase/serverless');
  _sql = neon(url);
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
