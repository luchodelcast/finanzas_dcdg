/**
 * GET|POST /api/pwa-conciliacion — motor de cruce automático de conciliación
 * (fase 2 de docs/conciliacion.md, issue #39), autenticado con el login de
 * Google del usuario (equipo financiero).
 * GET  ?extracto_id=NN → propone cruces (solo lectura, no escribe nada).
 * POST { linea_id, tipo: 'movimiento'|'ingreso', id } → única escritura: el
 * usuario confirma un cruce (o elige, ante ambigüedad, cuál de los
 * candidatos es el correcto) antes de marcar `conciliado`.
 */
import { conciliacionHandler } from './_lib/handlers.js';

export default conciliacionHandler;

export const config = { path: '/api/pwa-conciliacion' };
