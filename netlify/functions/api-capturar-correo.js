/**
 * POST /api/capturar-correo — Captura una notificación bancaria recibida por
 * correo y registra el movimiento (el asiento sale automático). Idempotente por
 * `message_id`. Lo usa la rutina de captura (lee Gmail y reenvía cada correo).
 * Body: { message_id, from, subject, body }.
 * Auth: Bearer DCDG_API_TOKEN + header X-DCDG-User (correo autorizado).
 */
import { makeCapturarCorreoHandler } from './_lib/handlers.js';

export default makeCapturarCorreoHandler();

export const config = { path: '/api/capturar-correo' };
