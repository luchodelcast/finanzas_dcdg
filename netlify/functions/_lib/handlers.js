/**
 * _lib/handlers.js — Handlers reutilizables para los endpoints /api/*.
 *
 * Centraliza auth + parseo + manejo de errores para que cada función pública
 * sea un one-liner. SilvIA (o la PWA) llaman estas rutas con el token de servicio.
 */

import { authorize, parseBody, ok, bad } from './http.js';
import { registrarMovimiento, resumen } from './finanzas.js';
import {
  queryMovimientos, listEntidades, listTerceros, findOrCreateTercero,
  insertIngreso, queryIngresos,
} from './repo.js';
import { deriveIngresoKey } from './idempotency.js';
import { clasificar } from './classify.js';
import { verifyFinanceUser } from './google-auth.js';
import { callAnthropic, extractJson } from './anthropic.js';
import { buildSystemPrompt } from '../../../app/src/config/prompt.js';

/** Handler genérico de registro para un tipo dado (gasto | pago | factura). */
export function makeRegistrarHandler(tipo) {
  return async (req) => {
    if (req.method !== 'POST') return bad('Método no permitido', 405);
    const auth = authorize(req);
    if (!auth.ok) return auth.response;
    const body = await parseBody(req);
    try {
      const result = await registrarMovimiento({ ...body, tipo, origen: body.origen || 'SilvIA' });
      return ok(result);
    } catch (e) {
      return bad(e.message, 422);
    }
  };
}

/** Handler de resumen/consulta. */
export async function resumenHandler(req) {
  const auth = authorize(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const body = req.method === 'POST' ? await parseBody(req) : {};
  const q = {
    periodo: url.searchParams.get('periodo') || body.periodo,
    categoria: url.searchParams.get('categoria') || body.categoria,
    quien: url.searchParams.get('quien') || body.quien,
  };
  try {
    return ok(await resumen(q));
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Handler de REGISTRO para la PWA, autenticado con el login de Google (no con el
 * token de servicio). Pasa por `registrarMovimiento`, así la app comparte el
 * mismo dedup + timestamp + reglas iWin/Delca2 que la ruta de SilvIA.
 */
export async function pwaRegistrarHandler(req) {
  if (req.method !== 'POST') return bad('Método no permitido', 405);
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try {
    await verifyFinanceUser(bearer);
  } catch (e) {
    return bad(e.message, e.status || 401);
  }
  const body = await parseBody(req);
  try {
    return ok(await registrarMovimiento({ ...body, origen: body.origen || 'App' }));
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Handler de clasificación para la PWA (texto o imagen), autenticado con el
 * login de Google del usuario (no con el token de servicio). Usa la
 * ANTHROPIC_API_KEY del backend, así el navegador nunca necesita la API key.
 * Devuelve el shape DCDG completo (fecha, monto, comercio, categoría, …).
 */
export async function pwaClasificarHandler(req) {
  if (req.method !== 'POST') return bad('Método no permitido', 405);
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try {
    await verifyFinanceUser(bearer);
  } catch (e) {
    return bad(e.message, e.status || 401);
  }
  const body = await parseBody(req);
  try {
    let content;
    if (body.imagen) {
      content = [
        { type: 'image', source: { type: 'base64', media_type: body.media_type || 'image/jpeg', data: body.imagen } },
        { type: 'text', text: 'Extrae los datos de esta transacción o recibo.' },
      ];
    } else {
      const texto = String(body.texto || '').trim();
      if (!texto) return bad('texto o imagen requerido');
      content = [{ type: 'text', text: `Fecha: ${body.fecha || ''}\nDescripción: ${texto}` }];
    }
    const raw = await callAnthropic({ content, system: buildSystemPrompt(), maxTokens: 600 });
    return ok(extractJson(raw));
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Handler de CONSULTA de movimientos (lista/búsqueda) desde la DB. Para SilvIA
 * ("muéstrame los gastos de restaurantes de julio") y el futuro dashboard.
 * Acepta filtros por query o body: desde, hasta, categoria, quien, texto, limit.
 */
export async function movimientosHandler(req) {
  const auth = authorize(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const body = req.method === 'POST' ? await parseBody(req) : {};
  const g = (k) => url.searchParams.get(k) || body[k];
  try {
    const rows = await queryMovimientos({
      desde: g('desde'), hasta: g('hasta'), categoria: g('categoria'),
      quien: g('quien'), texto: g('texto'), limit: g('limit'),
    });
    return ok({ ok: true, movimientos: rows, n: rows.length });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Handlers de CONSULTA para la PWA (dashboard), autenticados con el login de
 * Google del usuario (no con el token de servicio). Leen de la DB.
 */
export async function pwaResumenHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await verifyFinanceUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  const url = new URL(req.url);
  const body = req.method === 'POST' ? await parseBody(req) : {};
  const g = (k) => url.searchParams.get(k) || body[k];
  try {
    return ok(await resumen({ periodo: g('periodo'), categoria: g('categoria'), quien: g('quien') }));
  } catch (e) {
    return bad(e.message, 422);
  }
}

export async function pwaMovimientosHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await verifyFinanceUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  const url = new URL(req.url);
  const body = req.method === 'POST' ? await parseBody(req) : {};
  const g = (k) => url.searchParams.get(k) || body[k];
  try {
    const rows = await queryMovimientos({
      desde: g('desde'), hasta: g('hasta'), categoria: g('categoria'),
      quien: g('quien'), texto: g('texto'), limit: g('limit'),
    });
    return ok({ ok: true, movimientos: rows, n: rows.length });
  } catch (e) {
    return bad(e.message, 422);
  }
}

// Cédulas de ingreso (renta personas naturales) para los desplegables del form.
const CEDULAS = [
  { value: 'trabajo', label: 'Salario (rentas de trabajo)' },
  { value: 'honorarios', label: 'Honorarios' },
  { value: 'no_laboral', label: 'Rentas no laborales (negocio, ventas)' },
  { value: 'capital', label: 'Rentas de capital (arriendos, rendimientos)' },
  { value: 'dividendos', label: 'Dividendos' },
  { value: 'pension', label: 'Pensiones' },
];

/** Catálogos para el formulario de ingresos (entidades, terceros, cédulas). Auth Google. */
export async function pwaCatalogosHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await verifyFinanceUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  try {
    const [entidades, terceros] = await Promise.all([listEntidades(), listTerceros()]);
    return ok({ ok: true, entidades, terceros, cedulas: CEDULAS });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/** Registra (POST) o lista (GET) ingresos. Auth Google (equipo financiero). */
export async function pwaIngresoHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await verifyFinanceUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const g = (k) => url.searchParams.get(k);
    try {
      const rows = await queryIngresos({ entidad_id: g('entidad_id'), desde: g('desde'), hasta: g('hasta'), limit: g('limit') });
      return ok({ ok: true, ingresos: rows, n: rows.length });
    } catch (e) {
      return bad(e.message, 422);
    }
  }
  if (req.method !== 'POST') return bad('Método no permitido', 405);

  const body = await parseBody(req);
  const entidad_id = Number(body.entidad_id);
  if (!entidad_id) return bad('entidad requerida');
  if (!body.cedula) return bad('tipo de ingreso (cédula) requerido');
  const monto = Number(body.monto);
  if (!(monto > 0)) return bad('monto inválido');
  const fecha = String(body.fecha || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

  try {
    let tercero_id = null;
    if (body.tercero_nombre) {
      tercero_id = await findOrCreateTercero({ nombre: body.tercero_nombre, nit: body.tercero_nit, tipo: 'pagador' });
    }
    const idempotency_key = deriveIngresoKey({ entidad_id, fecha, monto, concepto: body.concepto, cedula: body.cedula, idempotency_key: body.idempotency_key });
    const { inserted, row } = await insertIngreso({
      entidad_id, fecha, cedula: body.cedula, concepto: body.concepto, tercero_id, monto,
      moneda: body.moneda, retencion_fuente: Number(body.retencion_fuente) || 0,
      actividad: body.actividad, notas: body.notas, origen: 'App', idempotency_key,
    });
    return ok({
      ok: true, registrado: inserted, ya_existia: !inserted, id: row && row.id,
      mensaje: inserted ? 'Ingreso registrado ✅' : 'Ese ingreso ya estaba registrado (no se duplicó).',
    });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/** Handler de clasificación (sin escribir en Sheets). */
export async function clasificarHandler(req) {
  if (req.method !== 'POST') return bad('Método no permitido', 405);
  const auth = authorize(req);
  if (!auth.ok) return auth.response;
  const body = await parseBody(req);
  const desc = String(body.descripcion || body.texto || '').trim();
  if (!desc) return bad('descripcion requerida');
  try {
    return ok(await clasificar(desc, { usarModelo: body.usarModelo !== false }));
  } catch (e) {
    return bad(e.message, 422);
  }
}
