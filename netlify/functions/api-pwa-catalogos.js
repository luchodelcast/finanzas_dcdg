/**
 * GET /api/pwa-catalogos — Catálogos para el formulario de ingresos
 * (entidades, terceros, cédulas), autenticado con el login de Google.
 */
import { pwaCatalogosHandler } from './_lib/handlers.js';

export default pwaCatalogosHandler;

export const config = { path: '/api/pwa-catalogos' };
