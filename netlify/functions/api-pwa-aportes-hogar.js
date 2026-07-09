/**
 * GET/POST /api/pwa-aportes-hogar — Fondo común del hogar (issue #113): reporte
 * mensual de aportes + cuota proporcional (lectura) y registro de un aporte
 * nuevo (solo owners). Auth Google.
 */
import { pwaAportesHogarHandler } from './_lib/handlers.js';

export default pwaAportesHogarHandler;

export const config = { path: '/api/pwa-aportes-hogar' };
