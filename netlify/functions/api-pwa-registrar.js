/**
 * POST /api/pwa-registrar — Registro de movimientos desde la PWA.
 * Auth: Bearer <access token de Google del usuario>.
 * Body: { tipo?, monto, descripcion, quien_pago?, metodo_pago?, fecha?, categoria?,
 *         subcategoria?, tarjeta_ultimos4?, notas?, confirmar? }
 * Comparte dedup + timestamp + reglas iWin/Delca2 con la ruta de SilvIA.
 * Si detecta un posible duplicado devuelve { registrado:false, posible_duplicado }.
 */
import { pwaRegistrarHandler } from './_lib/handlers.js';

export default pwaRegistrarHandler;

export const config = { path: '/api/pwa-registrar' };
