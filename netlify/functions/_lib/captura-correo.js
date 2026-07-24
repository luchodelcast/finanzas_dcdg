/**
 * _lib/captura-correo.js — Orquestador de la captura automática por correo.
 * Toma una notificación bancaria cruda, la parsea (`email-parse.js`) y, si es un
 * GASTO reconocido, lo registra (con idempotencia por el message-id del correo y
 * el dedup que ya trae `registrarMovimiento`). Ingresos y transferencias quedan
 * "pendientes" para que la rutina los rutee (Ahinoa, colapso de transferencias,
 * préstamos Luis↔Caro, bolsillo educación del hijo).
 */
import { parseNotificacion } from './email-parse.js';
import { registrarMovimiento } from './finanzas.js';

const NOMBRE_CUENTA = {
  '0965': 'Bcol Aho 0965 (Luis)', '2331': 'Bcol Déb 2331 (Luis)', '3355': 'Bcol Aho 3355 (Luis)',
  '4549': 'Bcol Aho 4549 (Luis)', '6940': 'Bcol Déb 6940 (Luis)',
  '5688': 'Bcol Aho 5688 (Carolina)', '3164': 'Bcol Aho 3164 (Carolina)',
  '4550': 'Bcol Déb 4550 (Carolina)', '9354': 'Bcol Déb 9354 (Carolina)',
  '2953': 'Bcol Aho 2953 (Hijo)',
};

/** Etiqueta de método de pago a partir de los últimos 4 de la cuenta. */
export function metodoDeCuenta(last4) {
  return NOMBRE_CUENTA[last4] || (last4 ? `Bcol *${last4}` : 'Bancolombia');
}

/**
 * Construye el movimiento de GASTO a partir de una transacción parseada (puro).
 * `categoria`/`subcategoria` opcionales: si no se pasan, `registrarMovimiento`
 * las infiere del comercio con el clasificador existente.
 */
export function movimientoGastoDesdeTx(tx, message_id, { categoria, subcategoria } = {}) {
  const mov = {
    tipo: 'gasto',
    fecha: tx.fecha,
    monto: tx.monto,
    moneda: tx.moneda || 'COP',
    descripcion: tx.comercio || tx.destino || 'Gasto',
    quien_pago: tx.dueno || 'Luis',
    metodo_pago: metodoDeCuenta(tx.cuenta),
    origen: 'CorreoBanco',
    idempotency_key: `email:${message_id}`,
    notas: `Captura automática por correo${tx.cuenta ? ` · cuenta *${tx.cuenta}` : ''}`,
  };
  if (categoria) mov.categoria = categoria;
  if (subcategoria) mov.subcategoria = subcategoria;
  return mov;
}

/**
 * Captura una notificación bancaria. Devuelve el resultado del registro, o un
 * marcador (`skip` = ruido/excluido, `pendiente` = ingreso/transferencia que
 * rutea la rutina). Idempotente: el mismo correo (message-id) nunca duplica.
 */
export async function capturarCorreo({ message_id, from, subject, body, categoria, subcategoria } = {}) {
  if (!message_id) throw new Error('message_id requerido (idempotencia)');
  const r = parseNotificacion({ from, subject, body });
  if (r.skip) return { registrado: false, skip: r.skip };
  if (r.clase === 'gasto') {
    const mov = movimientoGastoDesdeTx(r, message_id, { categoria, subcategoria });
    const res = await registrarMovimiento(mov);
    return { ...res, tx: r };
  }
  // ingreso / transferencia → la rutina decide (Ahinoa, colapso, préstamo, bolsillo).
  return { registrado: false, pendiente: r.clase, tx: r };
}
