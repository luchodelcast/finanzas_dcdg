/**
 * GET/POST /api/pwa-cuentas-meta — Metadatos de cuenta (dueño/bolsillo/cuenta PUC
 * explícita, issue #112). Auth Google; escritura solo owners (Luis/Carolina).
 */
import { pwaCuentasMetaHandler } from './_lib/handlers.js';

export default pwaCuentasMetaHandler;

export const config = { path: '/api/pwa-cuentas-meta' };
