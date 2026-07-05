/**
 * POST /api/pwa-clasificar — Clasificación para la PWA (texto o imagen).
 * Auth: Bearer <access token de Google del usuario> (no el token de servicio).
 * Body: { texto, fecha } | { imagen: base64, media_type }
 * Usa la ANTHROPIC_API_KEY del backend, así la PWA no necesita la API key.
 */
import { pwaClasificarHandler } from './_lib/handlers.js';

export default pwaClasificarHandler;

export const config = { path: '/api/pwa-clasificar' };
