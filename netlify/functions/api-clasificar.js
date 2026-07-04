/**
 * POST /api/clasificar — Clasifica una descripción sin escribir en Sheets.
 * Body: { descripcion, usarModelo? }  (usarModelo=false → solo reglas DCDG)
 */
import { clasificarHandler } from './_lib/handlers.js';

export default clasificarHandler;

export const config = { path: '/api/clasificar' };
