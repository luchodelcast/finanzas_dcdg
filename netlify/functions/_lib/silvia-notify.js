/**
 * _lib/silvia-notify.js — aviso opcional por WhatsApp vía SilvIA (mismo
 * endpoint que usa Autobuild, ver AUTOBUILD.md § Notificación). Reusado aquí
 * para que "Cierre del mes" (issue #118) pueda mandarle el resumen a la
 * pareja. Best-effort: sin AUTOBUILD_NOTIFY_URL/SECRET configurados, degrada
 * con gracia (no lanza) en vez de tumbar la pantalla de solo lectura.
 */
import { env } from './env.js';

/** Envía `message` a SilvIA. Nunca lanza: devuelve `{enviado, motivo?}`. */
export async function notificarSilvia(message) {
  const url = env('AUTOBUILD_NOTIFY_URL', null);
  const secret = env('AUTOBUILD_NOTIFY_SECRET', null);
  if (!url || !secret) {
    return { enviado: false, motivo: 'AUTOBUILD_NOTIFY_URL/AUTOBUILD_NOTIFY_SECRET no configurados.' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-autobuild-secret': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) return { enviado: false, motivo: `SilvIA respondió ${res.status}` };
    return { enviado: true };
  } catch (e) {
    return { enviado: false, motivo: e.message };
  }
}
