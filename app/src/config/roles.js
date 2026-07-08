/**
 * config/roles.js — Pantallas de captura/edición que el portal solo-lectura
 * oculta para un usuario que no es `owner` (T8b, issue #98, sub-issue de #51).
 *
 * El gate real vive en el backend (T8a, `esOwner` en `_lib/handlers.js`);
 * esto es solo la lista que usa la PWA para decidir qué mostrar/ocultar.
 */

export const OWNER_ONLY_SCREENS = new Set([
  'registrar', 'text', 'cet', 'transfer', 'ingreso', 'extractos',
  'conciliacion', 'pagos', 'prestamos', 'apertura', 'solicitudes',
]);

/** ¿Debe bloquearse la navegación a esta pantalla para este rol? */
export const esPantallaBloqueada = (pantalla, isOwner) =>
  !isOwner && OWNER_ONLY_SCREENS.has(pantalla);
