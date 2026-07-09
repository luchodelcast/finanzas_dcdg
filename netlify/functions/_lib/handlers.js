/**
 * _lib/handlers.js — Handlers reutilizables para los endpoints /api/*.
 *
 * Centraliza auth + parseo + manejo de errores para que cada función pública
 * sea un one-liner. SilvIA (o la PWA) llaman estas rutas con el token de servicio.
 */

import { authorize, parseBody, ok, bad, csv } from './http.js';
import {
  csvLibroDiario, csvLibroMayor, csvComprobacion, csvEstadoResultados, csvBalanceGeneral,
} from './exports.js';
import { registrarMovimiento, resumen } from './finanzas.js';
import {
  queryMovimientos, listEntidades, listTerceros, findOrCreateTercero,
  insertIngreso, queryIngresos, listPlanCuentas, insertPlanCuenta,
  insertExtracto, insertExtractoLineas, queryExtractos, queryExtractoLineas,
  getExtracto, queryMovimientosProvisionales, queryIngresosProvisionales, confirmarConciliacion,
  queryAsientos, movimientosSinAsiento, ingresosSinAsiento,
  insertMovimiento, getExtractoLinea, marcarLineaMaterializada,
  listCuentasMeta, upsertCuentaMeta,
} from './repo.js';
import { deriveIngresoKey, deriveAporteHogarKey } from './idempotency.js';
import { registrarCuenta, listCuentas } from './cuentas.js';
import { clasificar } from './classify.js';
import { resolvePwaUser, verifyGoogleIdToken } from './google-auth.js';
import { signSession, sessionSecretConfigured } from './session.js';
import { callAnthropic, extractJson, buildReceiptContent } from './anthropic.js';
import { buildSystemPrompt } from '../../../app/src/config/prompt.js';
import { parseCsvExtracto } from './extractos.js';
import { parseExtractoPdfText } from './extracto-pdf.js';
import { crearAsiento } from './asientos.js';
import { construirApertura } from './apertura.js';
import { contabilizarMovimiento, contabilizarIngreso } from './contabilizar.js';
import { mayorCuenta, balanceComprobacion } from './mayor.js';
import { estadoResultados, balanceGeneral } from './estados.js';
import { patrimonioPorPersona, miPatrimonio } from './patrimonio.js';
import { proponerCruces, VENTANA_DIAS_DEFAULT, toISODate } from './conciliacion.js';
import { proponerBackfillExtracto } from './backfill.js';
import { reporteAportes } from './aportes.js';
import { reporteAportesHogar, registrarAporteHogar } from './aportes-hogar.js';
import {
  listPagosFijos, queryPagosEstadoMes, insertPagoFijo, updatePagoFijo,
  upsertPagoEstado, desmarcarPagoEstado,
} from './repo.js';
import { armarPagosDelMes, resumenPagos, mesAnterior, estaVigenteEnMes } from './pagos.js';
import { listPrestamos } from './repo.js';
import {
  calcularSaldoPrestamos, registrarPrestamoConAsiento, marcarSaldadoConAsiento, registrarPagoDeOtro,
} from './prestamos.js';
import { crearSolicitudMejora, listarSolicitudesAbiertas } from './backlog.js';
import { anularMovimientoCompleto, recategorizarMovimiento } from './corregir.js';
import { hoyISO } from '../../../app/src/utils/formatters.js';

const CONFIG_GITHUB_RE = /Configura GITHUB_TOKEN_FINANZAS/;

/**
 * Contabiliza un movimiento recién registrado, best-effort: NUNCA debe tumbar la
 * captura (si falta una regla o el plan de cuentas, se registra el fallo y ya).
 */
async function contabilizarMovSafe(result) {
  if (result && result.registrado && result.id) {
    try { await contabilizarMovimiento(result.id); } catch (e) { console.error('contabilizar mov', result.id, e.message); }
  }
  return result;
}

/** Handler genérico de registro para un tipo dado (gasto | pago | factura). */
export function makeRegistrarHandler(tipo) {
  return async (req) => {
    if (req.method !== 'POST') return bad('Método no permitido', 405);
    const auth = authorize(req);
    if (!auth.ok) return auth.response;
    const body = await parseBody(req);
    try {
      const result = await registrarMovimiento({ ...body, tipo, origen: body.origen || 'SilvIA' });
      await contabilizarMovSafe(result);
      return ok(result);
    } catch (e) {
      return bad(e.message, 422);
    }
  };
}

/** Handler de alta de cuenta/tarjeta en `⚙️ CUENTAS` (token de servicio; SilvIA). */
export async function registrarCuentaHandler(req) {
  if (req.method !== 'POST') return bad('Método no permitido', 405);
  const auth = authorize(req);
  if (!auth.ok) return auth.response;
  const body = await parseBody(req);
  try {
    return ok(await registrarCuenta(body));
  } catch (e) {
    return bad(e.message, 422);
  }
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
    await resolvePwaUser(bearer);
  } catch (e) {
    return bad(e.message, e.status || 401);
  }
  const body = await parseBody(req);
  try {
    const result = await registrarMovimiento({ ...body, origen: body.origen || 'App' });
    await contabilizarMovSafe(result);
    return ok(result);
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Handler de clasificación para la PWA (texto, imagen o PDF), autenticado con
 * el login de Google del usuario (no con el token de servicio). Usa la
 * ANTHROPIC_API_KEY del backend, así el navegador nunca necesita la API key.
 * Devuelve el shape DCDG completo (fecha, monto, comercio, categoría, …).
 *
 * El campo `imagen` es genérico (base64 de una foto o de un PDF); `media_type`
 * decide el bloque que se arma para Claude (`image` o `document` nativo de
 * PDF — ver `buildReceiptContent` en `_lib/anthropic.js`). Solo PWA; el lado
 * SilvIA/WhatsApp vive en otro repo y no se toca acá (issue #35).
 */
export async function pwaClasificarHandler(req) {
  if (req.method !== 'POST') return bad('Método no permitido', 405);
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try {
    await resolvePwaUser(bearer);
  } catch (e) {
    return bad(e.message, e.status || 401);
  }
  const body = await parseBody(req);
  try {
    let content;
    if (body.imagen) {
      content = buildReceiptContent({ base64: body.imagen, mediaType: body.media_type });
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
      quien: g('quien'), texto: g('texto'), tipoGasto: g('tipo_gasto'), limit: g('limit'),
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
  try { await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
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
  try { await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  const url = new URL(req.url);
  const body = req.method === 'POST' ? await parseBody(req) : {};
  const g = (k) => url.searchParams.get(k) || body[k];
  try {
    const rows = await queryMovimientos({
      desde: g('desde'), hasta: g('hasta'), categoria: g('categoria'),
      quien: g('quien'), texto: g('texto'), tipoGasto: g('tipo_gasto'), limit: g('limit'),
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

/**
 * Quién soy / qué rol tengo (T8, issue #97). Auth Google. La PWA lo llama tras
 * el login para decidir qué botones de captura/edición mostrar según el rol.
 */
export async function pwaWhoamiHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  return ok({ ok: true, email: auth.email, rol: auth.rol, owner: esOwner(auth) });
}

/**
 * POST /api/pwa-login — Canjea un Google ID token (Sign-In) por un token de
 * sesión propio (HMAC, 12 h). Arranque del carril de auth sin scopes de API: el
 * navegador solo se identifica y a partir de aquí manda este token como Bearer,
 * sin volver a ver la pantalla de autorización de Google en cada carga.
 */
export async function pwaLoginHandler(req) {
  if (req.method !== 'POST') return bad('Método no permitido', 405);
  if (!sessionSecretConfigured()) {
    return bad('Login no disponible: falta configurar AUTH_SECRET en el servidor.', 503);
  }
  const body = await parseBody(req);
  let user;
  try {
    user = await verifyGoogleIdToken(body.id_token || body.credential);
  } catch (e) {
    return bad(e.message, e.status || 401);
  }
  const token = signSession({ email: user.email });
  return ok({ ok: true, token, email: user.email, rol: user.rol, ttl: 60 * 60 * 12 });
}

/**
 * GET /api/pwa-cuentas — Catálogo `⚙️ CUENTAS` (cuentas/tarjetas activas) leído
 * en el backend con la cuenta de servicio. Reemplaza el `loadCuentas` que el
 * navegador hacía directo contra Sheets (lo que obligaba el scope spreadsheets).
 */
export async function pwaCuentasHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  try {
    const cuentas = await listCuentas();
    return ok({ ok: true, cuentas, n: cuentas.length });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * POST /api/pwa-movimiento — Corregir un movimiento ya registrado. SOLO owners.
 *   { accion: 'anular', id, motivo? }
 *   { accion: 'recategorizar', id, categoria?, subcategoria?, tipo?, descripcion? }
 * Anular hace borrado suave + reverso contable; recategorizar reversa y recontabiliza.
 */
export async function pwaCorregirMovimientoHandler(req) {
  if (req.method !== 'POST') return bad('Método no permitido', 405);
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden corregir movimientos.', 403);
  const body = await parseBody(req);
  const id = Number(body.id);
  if (!id) return bad('Falta el id del movimiento.');
  try {
    if (body.accion === 'anular') {
      return ok(await anularMovimientoCompleto(id, body.motivo));
    }
    if (body.accion === 'recategorizar') {
      return ok(await recategorizarMovimiento(id, {
        tipo: body.tipo, categoria: body.categoria, subcategoria: body.subcategoria, descripcion: body.descripcion,
      }));
    }
    return bad('accion inválida (anular | recategorizar)');
  } catch (e) {
    return bad(e.message, e.status || 422);
  }
}

/** Catálogos para el formulario de ingresos (entidades, terceros, cédulas). Auth Google. */
export async function pwaCatalogosHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  try {
    const [entidades, terceros] = await Promise.all([listEntidades(), listTerceros()]);
    return ok({ ok: true, entidades, terceros, cedulas: CEDULAS });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Plan de cuentas (PUC). Auth Google.
 *   GET  /api/pwa-plan-cuentas?clase= → lista (lectura, todo el equipo).
 *   POST /api/pwa-plan-cuentas { clase, nombre } → agrega una cuenta nueva de
 *        Activo (1) o Pasivo (2), con código sugerido automático. SOLO owners.
 */
export async function pwaPlanCuentasHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

  if (req.method === 'POST') {
    if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden agregar cuentas.', 403);
    const body = await parseBody(req);
    try {
      const cuenta = await insertPlanCuenta({ nombre: body.nombre, clase: body.clase, cuenta_padre: body.cuenta_padre });
      return ok({ ok: true, cuenta });
    } catch (e) {
      return bad(e.message, 422);
    }
  }

  const url = new URL(req.url);
  const clase = url.searchParams.get('clase');
  try {
    const cuentas = await listPlanCuentas({ clase });
    return ok({ ok: true, cuentas, n: cuentas.length });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Metadatos de cuenta — dueño/bolsillo/cuenta PUC explícita (issue #112). Auth Google.
 *   GET  /api/pwa-cuentas-meta → cada cuenta del catálogo `⚙️ CUENTAS`, con sus
 *        metadatos si tiene fila (lectura, todo el equipo).
 *   POST /api/pwa-cuentas-meta { nombre, dueno, bolsillo, cuenta_puc? } → fija los
 *        metadatos de una cuenta. SOLO owners.
 */
export async function pwaCuentasMetaHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

  if (req.method === 'POST') {
    if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden editar los metadatos de una cuenta.', 403);
    const body = await parseBody(req);
    try {
      const meta = await upsertCuentaMeta(body);
      return ok({ ok: true, meta });
    } catch (e) {
      return bad(e.message, 422);
    }
  }

  try {
    const [cuentas, metas] = await Promise.all([listCuentas(), listCuentasMeta()]);
    const porNombre = new Map(metas.map((m) => [String(m.nombre).trim().toLowerCase(), m]));
    const items = cuentas.map((c) => ({
      nombre: c.name,
      banco: c.banco,
      titular: c.titular,
      meta: porNombre.get(String(c.name).trim().toLowerCase()) || null,
    }));
    return ok({ ok: true, cuentas: items, n: items.length });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * ¿El usuario autenticado puede escribir? (T8, issue #97). `auth.rol` viene de
 * `verifyFinanceUser` — hoy solo `owner` (Luis/Carolina) escribe; el resto del
 * equipo (admin_financiero/tesoreria/contador/solo_lectura) es de lectura.
 */
function esOwner(auth) {
  return String((auth && auth.rol) || '').toLowerCase() === 'owner';
}

/**
 * Libro diario de partida doble (T2). Auth Google (equipo financiero).
 *   GET  /api/pwa-asiento?desde=&hasta=&entidad_id= → lista asientos (lectura, todo el equipo).
 *   POST /api/pwa-asiento { fecha, descripcion?, entidad_id?, origen?, lineas:[{cuenta,debito,credito,...}] }
 *        → crea un asiento manual cuadrado. SOLO owners (Luis/Carolina).
 */
export async function pwaAsientoHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const g = (k) => url.searchParams.get(k);
    try {
      const asientos = await queryAsientos({ desde: g('desde'), hasta: g('hasta'), entidad_id: g('entidad_id'), limit: g('limit') });
      if (g('formato') === 'csv') return csv('libro-diario.csv', csvLibroDiario(asientos));
      return ok({ ok: true, asientos, n: asientos.length });
    } catch (e) {
      return bad(e.message, 422);
    }
  }
  if (req.method !== 'POST') return bad('Método no permitido', 405);
  if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden crear asientos manuales.', 403);

  const body = await parseBody(req);
  try {
    return ok(await crearAsiento({
      fecha: body.fecha, descripcion: body.descripcion, entidad_id: body.entidad_id,
      origen: body.origen || 'manual', lineas: body.lineas, idempotency_key: body.idempotency_key,
    }));
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Asiento de apertura / saldos iniciales (T3). Auth Google.
 *   GET  /api/pwa-apertura?entidad_id= → devuelve la apertura existente (o null).
 *   POST /api/pwa-apertura { entidad_id?, fecha?, saldos:[{cuenta, monto}] }
 *        → arma y guarda el asiento de apertura cuadrado. SOLO owners.
 */
export async function pwaAperturaHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const entidad_id = url.searchParams.get('entidad_id') || null;
    try {
      const asientos = await queryAsientos({ limit: 500 });
      const apertura = asientos.find((a) => a.origen === 'apertura' && String(a.entidad_id || '') === String(entidad_id || '')) || null;
      return ok({ ok: true, apertura });
    } catch (e) {
      return bad(e.message, 422);
    }
  }
  if (req.method !== 'POST') return bad('Método no permitido', 405);
  if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden montar la apertura.', 403);

  const body = await parseBody(req);
  const entidad_id = body.entidad_id || null;
  const fecha = String(body.fecha || '').slice(0, 10) || '2026-07-01';
  try {
    const cuentas = await listPlanCuentas({});
    const plan = new Map(cuentas.map((c) => [c.codigo, c]));
    const lineas = construirApertura(body.saldos, plan);
    const r = await crearAsiento({
      fecha, descripcion: 'Saldos iniciales (apertura)', entidad_id, origen: 'apertura',
      lineas, idempotency_key: `apertura:${entidad_id || 'todas'}:${fecha}`,
    });
    return ok(r);
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Recontabiliza en LOTE los movimientos/ingresos que aún no tienen asiento
 * (los capturados antes de T4). Auth Google, solo owners. Procesa un lote
 * acotado por llamada (para no pasar el timeout) y reporta cuántos quedan.
 *   POST /api/pwa-recontabilizar { limite? }
 */
export async function pwaRecontabilizarHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  if (req.method !== 'POST') return bad('Método no permitido', 405);
  if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden recontabilizar.', 403);

  const body = await parseBody(req);
  const limite = Math.min(Math.max(Number(body.limite) || 40, 1), 100);
  try {
    const movs = await movimientosSinAsiento({ limit: limite });
    let hechos = 0; let errores = 0;
    for (const m of movs) {
      try { await contabilizarMovimiento(m.id); hechos++; } catch (e) { errores++; console.error('recontab mov', m.id, e.message); }
    }
    let restanMov = 0;
    if (movs.length >= limite) restanMov = (await movimientosSinAsiento({ limit: 2000 })).length;
    // Ingresos solo si ya no quedan movimientos por procesar (para acotar el lote).
    let hechosIng = 0; let erroresIng = 0; let restanIng = 0;
    if (restanMov === 0) {
      const ings = await ingresosSinAsiento({ limit: limite });
      for (const i of ings) {
        try { await contabilizarIngreso(i.id); hechosIng++; } catch (e) { erroresIng++; console.error('recontab ing', i.id, e.message); }
      }
      if (ings.length >= limite) restanIng = (await ingresosSinAsiento({ limit: 2000 })).length;
    }
    const restan = restanMov + restanIng;
    return ok({
      ok: true, contabilizados: hechos + hechosIng, con_error: errores + erroresIng, restan,
      mensaje: `Contabilizados ${hechos + hechosIng} registro(s)`
        + ((errores + erroresIng) ? `, ${errores + erroresIng} con error` : '')
        + (restan ? `. Quedan ${restan}: vuelve a ejecutar.` : '.'),
    });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Libro Mayor de una cuenta (T5). Auth Google (equipo financiero, solo lectura).
 *   GET /api/pwa-mayor?cuenta=&desde=&hasta=&entidad_id= → renglones con saldo corrido.
 */
export async function pwaMayorHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  const url = new URL(req.url);
  const g = (k) => url.searchParams.get(k);
  try {
    const r = await mayorCuenta({ cuenta: g('cuenta'), desde: g('desde'), hasta: g('hasta'), entidad_id: g('entidad_id') });
    if (g('formato') === 'csv') return csv(`libro-mayor-${r.cuenta.codigo}.csv`, csvLibroMayor(r.cuenta, r.lineas));
    return ok({ ok: true, ...r });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Balance de Comprobación (T5). Auth Google (equipo financiero, solo lectura).
 *   GET /api/pwa-comprobacion?desde=&hasta=&entidad_id= → saldo por cuenta + cuadre.
 */
export async function pwaComprobacionHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  const url = new URL(req.url);
  const g = (k) => url.searchParams.get(k);
  try {
    const r = await balanceComprobacion({ desde: g('desde'), hasta: g('hasta'), entidad_id: g('entidad_id') });
    if (g('formato') === 'csv') return csv('balance-comprobacion.csv', csvComprobacion(r.cuentas));
    return ok({ ok: true, ...r });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Estado de Resultados (T6). Auth Google (equipo financiero, solo lectura).
 *   GET /api/pwa-estado-resultados?desde=&hasta=&entidad_id= → ingresos − gastos − costos.
 */
export async function pwaEstadoResultadosHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  const url = new URL(req.url);
  const g = (k) => url.searchParams.get(k);
  try {
    const r = await estadoResultados({ desde: g('desde'), hasta: g('hasta'), entidad_id: g('entidad_id') });
    if (g('formato') === 'csv') return csv('estado-resultados.csv', csvEstadoResultados(r));
    return ok({ ok: true, ...r });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Balance General (T7). Auth Google (equipo financiero, solo lectura).
 *   GET /api/pwa-balance-general?fecha=&entidad_id= → activo/pasivo/patrimonio a una fecha.
 */
export async function pwaBalanceGeneralHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  const url = new URL(req.url);
  const g = (k) => url.searchParams.get(k);
  try {
    const r = await balanceGeneral({ fecha: g('fecha'), entidad_id: g('entidad_id') });
    if (g('formato') === 'csv') return csv('balance-general.csv', csvBalanceGeneral(r));
    return ok({ ok: true, ...r });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Patrimonio individual (T7 filtrado por dueño, issue #115). Auth Google
 * (equipo financiero, solo lectura).
 *   GET /api/pwa-patrimonio?fecha= → Balance General de Luis, Carolina, el
 *   fondo/bolsillo Común (asientos sin dueño individual) y el consolidado.
 */
export async function pwaPatrimonioHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  const url = new URL(req.url);
  try {
    const r = await patrimonioPorPersona({ fecha: url.searchParams.get('fecha') });
    return ok({ ok: true, ...r });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * "Mi patrimonio" (issue #115): neto y evolución mensual de la persona
 * logueada (según `usuarios.nombre`), pensada para que cada quien vea crecer
 * lo suyo. Auth Google (equipo financiero, solo lectura); degrada al
 * consolidado si el email no está asociado a una persona.
 *   GET /api/pwa-mi-patrimonio?meses=&fecha=
 */
export async function pwaMiPatrimonioHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  const url = new URL(req.url);
  try {
    const r = await miPatrimonio({
      email: auth.email,
      meses: url.searchParams.get('meses') || undefined,
      fecha: url.searchParams.get('fecha') || undefined,
    });
    return ok({ ok: true, ...r });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/** Registra (POST) o lista (GET) ingresos. Auth Google (equipo financiero); registrar es SOLO owners. */
export async function pwaIngresoHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

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
  if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden registrar ingresos.', 403);

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
    if (inserted && row && row.id) {
      try { await contabilizarIngreso(row.id); } catch (e) { console.error('contabilizar ingreso', row.id, e.message); }
    }
    return ok({
      ok: true, registrado: inserted, ya_existia: !inserted, id: row && row.id,
      mensaje: inserted ? 'Ingreso registrado ✅' : 'Ese ingreso ya estaba registrado (no se duplicó).',
    });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Carga (POST) o lista (GET) extractos bancarios en CSV. Auth Google (equipo
 * financiero). Primer paso de la conciliación (docs/conciliacion.md): solo
 * normaliza y guarda las líneas (`extracto_lineas`, sin_conciliar); el cruce
 * automático contra lo capturado es una fase futura.
 */
export async function pwaExtractoHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const extracto_id = Number(url.searchParams.get('extracto_id')) || null;
    try {
      if (extracto_id) {
        const lineas = await queryExtractoLineas({ extracto_id });
        return ok({ ok: true, lineas, n: lineas.length });
      }
      const extractos = await queryExtractos({ cuenta: url.searchParams.get('cuenta') || undefined });
      return ok({ ok: true, extractos, n: extractos.length });
    } catch (e) {
      return bad(e.message, 422);
    }
  }
  if (req.method !== 'POST') return bad('Método no permitido', 405);
  if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden cargar extractos.', 403);

  const body = await parseBody(req);
  const cuenta = String(body.cuenta || '').trim();
  if (!cuenta) return bad('cuenta requerida');

  // Dos fuentes: CSV (texto crudo) o el TEXTO ya extraído de un PDF en el
  // navegador (la contraseña del PDF nunca llega acá). El texto de PDF lo
  // estructura Claude; el CSV, el parser puro.
  const textoPdf = String(body.texto || '');
  const csvText = String(body.csv || '');
  const esPdf = textoPdf.trim().length > 0;
  if (!esPdf && !csvText.trim()) return bad('archivo (CSV o texto de PDF) vacío o faltante');

  let lineas; let errores;
  try {
    ({ lineas, errores } = esPdf ? await parseExtractoPdfText(textoPdf) : parseCsvExtracto(csvText));
  } catch (e) {
    return bad(e.message, 422);
  }
  if (!lineas.length) {
    return bad(`No se encontraron transacciones válidas en el ${esPdf ? 'PDF' : 'CSV'}.${errores[0] ? ' ' + errores[0] : ''}`, 422);
  }

  try {
    const extracto = await insertExtracto({
      cuenta,
      periodo: body.periodo, fecha_desde: body.fecha_desde, fecha_hasta: body.fecha_hasta,
      saldo_inicial: body.saldo_inicial, saldo_final: body.saldo_final, moneda: body.moneda,
      fuente: esPdf ? 'pdf' : 'csv',
    });
    await insertExtractoLineas(extracto.id, lineas);
    const nErr = errores.length;
    return ok({
      ok: true, extracto_id: extracto.id, lineas: lineas.length, errores,
      mensaje: `Extracto cargado ✅ ${lineas.length} línea${lineas.length === 1 ? '' : 's'}`
        + (nErr ? ` (${nErr} con aviso).` : '.'),
    });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/** Suma/resta días a una fecha YYYY-MM-DD (para la ventana del motor de cruce). */
function addDias(fechaISO, dias) {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return fechaISO; // fecha inválida: no desplazamos
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * GET|POST /api/pwa-conciliacion — motor de cruce automático de conciliación
 * (fase 2 de docs/conciliacion.md, issue #39). Auth Google (equipo financiero).
 *
 * GET  ?extracto_id=NN → PROPONE cruces entre las líneas `sin_conciliar` de
 * ese extracto y los movimientos/ingresos `provisional` de la misma ventana
 * de fechas. Solo lectura: no escribe nada.
 *
 * POST { linea_id, tipo: 'movimiento'|'ingreso', id } → única escritura del
 * motor: el usuario confirma el cruce propuesto (o, ante ambigüedad, el que
 * eligió manualmente entre los candidatos) y se marca `conciliado` en
 * `extracto_lineas` + `movimientos`/`ingresos`.
 */
export async function conciliacionHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const extracto_id = Number(url.searchParams.get('extracto_id')) || null;
    if (!extracto_id) return bad('extracto_id requerido');
    try {
      const extracto = await getExtracto(extracto_id);
      if (!extracto) return bad('Extracto no encontrado', 404);
      const todasLineas = await queryExtractoLineas({ extracto_id });
      // Normaliza `fecha` (Date → 'YYYY-MM-DD') para todo el motor de cruce.
      const lineas = todasLineas
        .filter((l) => l.estado === 'sin_conciliar')
        .map((l) => ({ ...l, fecha: toISODate(l.fecha) }));
      const resumenVacio = { n_lineas: todasLineas.length, n_sin_conciliar: lineas.length, n_match: 0, n_ambiguo: 0, n_solo_extracto: 0 };
      if (!lineas.length) {
        return ok({ ok: true, extracto_id, propuestas: [], resumen: { ...resumenVacio, n_sin_conciliar: 0 } });
      }
      const fechasLineas = lineas.map((l) => l.fecha).filter(Boolean).sort();
      const fechaDesde = toISODate(extracto.fecha_desde) || fechasLineas[0];
      const fechaHasta = toISODate(extracto.fecha_hasta) || fechasLineas[fechasLineas.length - 1];
      if (!fechaDesde || !fechaHasta) {
        return ok({ ok: true, extracto_id, propuestas: [], resumen: resumenVacio });
      }
      const desde = addDias(fechaDesde, -VENTANA_DIAS_DEFAULT);
      const hasta = addDias(fechaHasta, VENTANA_DIAS_DEFAULT);

      const [movimientos, ingresos] = await Promise.all([
        queryMovimientosProvisionales({ desde, hasta }),
        queryIngresosProvisionales({ desde, hasta }),
      ]);
      const norm = (arr) => arr.map((m) => ({ ...m, fecha: toISODate(m.fecha) }));
      const propuestas = proponerCruces(lineas, norm(movimientos), norm(ingresos), VENTANA_DIAS_DEFAULT);
      const resumen = {
        n_lineas: todasLineas.length,
        n_sin_conciliar: lineas.length,
        n_match: propuestas.filter((p) => p.caso === 'match').length,
        n_ambiguo: propuestas.filter((p) => p.caso === 'ambiguo').length,
        n_solo_extracto: propuestas.filter((p) => p.caso === 'solo_extracto').length,
      };
      return ok({ ok: true, extracto_id, propuestas, resumen });
    } catch (e) {
      return bad(e.message, 422);
    }
  }

  if (req.method !== 'POST') return bad('Método no permitido', 405);
  if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden confirmar cruces de conciliación.', 403);
  const body = await parseBody(req);
  const linea_id = Number(body.linea_id);
  const id = Number(body.id);
  const tipo = body.tipo === 'ingreso' ? 'ingreso' : 'movimiento';
  if (!linea_id) return bad('linea_id requerido');
  if (!id) return bad('id (del movimiento/ingreso elegido) requerido');
  try {
    const r = await confirmarConciliacion({ linea_id, tipo, id });
    return ok({ ok: true, ...r, mensaje: 'Cruce confirmado ✅ (conciliado)' });
  } catch (e) {
    return bad(e.message, 422);
  }
}

// Cuántas líneas 'solo_extracto' sin regla se mandan a Claude por corrida de GET
// (protege el timeout ~10s de la function: no se manda TODO el extracto al modelo).
const BACKFILL_MODELO_LIMITE = 12;
// Cuántas líneas se materializan (crean+contabilizan) por llamada a POST — el resto
// queda para que el cliente reintente (ver `restantes` en la respuesta).
const BACKFILL_LOTE_LIMITE = 25;

/**
 * GET|POST /api/pwa-backfill — backfill de líneas `solo_extracto` de un
 * extracto (issue #72, Nocturno 1/7): el banco registró la línea pero nunca
 * se capturó en la App/SilvIA. El extracto es la fuente de verdad; esto
 * MATERIALIZA la línea como movimiento/ingreso ya contabilizado.
 *
 * GET  ?extracto_id=NN → PROPONE la materialización de cada línea `solo_extracto`
 * (clasificación por reglas; Claude como respaldo acotado para las que no
 * matchean ninguna regla). Solo lectura: no escribe nada.
 *
 * POST { extracto_id, lineas: [{ linea_id, tipo, categoria, subcategoria,
 * metodo_pago, quien_pago, tarjeta, notas, moneda, monto?, fecha?, descripcion?,
 * cuenta_destino? (transferencia), entidad_id?, cedula? (ingreso) }], limit? }
 * → crea el movimiento/ingreso (ya `conciliado`, ligado a la línea), lo
 * contabiliza (reusa T4) y marca la línea materializada. Procesa un lote
 * acotado por llamada; devuelve `restantes` para que el cliente reintente.
 */
export async function pwaBackfillHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const extracto_id = Number(url.searchParams.get('extracto_id')) || null;
    if (!extracto_id) return bad('extracto_id requerido');
    try {
      const extracto = await getExtracto(extracto_id);
      if (!extracto) return bad('Extracto no encontrado', 404);
      const todasLineas = await queryExtractoLineas({ extracto_id });
      const lineas = todasLineas
        .filter((l) => l.estado === 'sin_conciliar')
        .map((l) => ({ ...l, fecha: toISODate(l.fecha) }));
      if (!lineas.length) {
        return ok({ ok: true, extracto_id, cuenta: extracto.cuenta, propuestas: [], resumen: { n_solo_extracto: 0, n_auto: 0, n_dudosas: 0 } });
      }
      const fechasLineas = lineas.map((l) => l.fecha).filter(Boolean).sort();
      const fechaDesde = toISODate(extracto.fecha_desde) || fechasLineas[0];
      const fechaHasta = toISODate(extracto.fecha_hasta) || fechasLineas[fechasLineas.length - 1];
      const desde = fechaDesde ? addDias(fechaDesde, -VENTANA_DIAS_DEFAULT) : fechasLineas[0];
      const hasta = fechaHasta ? addDias(fechaHasta, VENTANA_DIAS_DEFAULT) : fechasLineas[fechasLineas.length - 1];

      const [movimientos, ingresos] = await Promise.all([
        queryMovimientosProvisionales({ desde, hasta }),
        queryIngresosProvisionales({ desde, hasta }),
      ]);
      const norm = (arr) => arr.map((m) => ({ ...m, fecha: toISODate(m.fecha) }));
      const cruces = proponerCruces(lineas, norm(movimientos), norm(ingresos), VENTANA_DIAS_DEFAULT);
      const soloExtracto = cruces
        .filter((p) => p.caso === 'solo_extracto')
        .map((p) => ({ id: p.linea_id, fecha: p.fecha, descripcion: p.descripcion, monto: p.monto }));

      const propuestas = proponerBackfillExtracto(soloExtracto, { cuenta: extracto.cuenta });

      // Claude como respaldo (acotado) para gastos sin regla — nunca auto-acepta
      // una sugerencia del modelo: solo prellena la fila dudosa para revisión.
      let usados = 0;
      for (const p of propuestas) {
        if (p.auto || p.tipo !== 'gasto') continue;
        if (usados >= BACKFILL_MODELO_LIMITE) { p.motivo = 'Sin regla de clasificación (límite de sugerencias IA alcanzado en esta corrida).'; continue; }
        usados += 1;
        try {
          const cls = await clasificar(p.descripcion, { usarModelo: true });
          if (cls && cls.categoria) {
            p.categoria = cls.categoria;
            p.subcategoria = cls.subcategoria || '';
            if (cls.metodo_pago) p.metodo_pago = cls.metodo_pago;
            p.confianza = Number(cls.confianza) || 0;
            p.fuente_sugerencia = 'modelo';
            p.motivo = 'Sugerido por IA: revisa antes de aceptar.';
          }
        } catch (e) {
          console.error('backfill: sugerencia IA', p.linea_id, e.message);
        }
      }

      const resumen = {
        n_solo_extracto: propuestas.length,
        n_auto: propuestas.filter((p) => p.auto).length,
        n_dudosas: propuestas.filter((p) => !p.auto).length,
      };
      return ok({ ok: true, extracto_id, cuenta: extracto.cuenta, propuestas, resumen });
    } catch (e) {
      return bad(e.message, 422);
    }
  }

  if (req.method !== 'POST') return bad('Método no permitido', 405);
  if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden materializar líneas de extracto.', 403);
  const body = await parseBody(req);
  const extracto_id = Number(body.extracto_id) || null;
  if (!extracto_id) return bad('extracto_id requerido');
  const itemsTotal = Array.isArray(body.lineas) ? body.lineas : [];
  if (!itemsTotal.length) return bad('lineas requerido (arreglo no vacío)');
  const limit = Math.min(Number(body.limit) || BACKFILL_LOTE_LIMITE, BACKFILL_LOTE_LIMITE);
  const lote = itemsTotal.slice(0, limit);

  try {
    const extracto = await getExtracto(extracto_id);
    if (!extracto) return bad('Extracto no encontrado', 404);

    const resultados = [];
    for (const item of lote) {
      const linea_id = Number(item.linea_id);
      try {
        if (!linea_id) throw new Error('linea_id requerido');
        const linea = await getExtractoLinea(linea_id);
        if (!linea) throw new Error('Línea de extracto no encontrada');
        if (Number(linea.extracto_id) !== extracto_id) throw new Error('La línea no pertenece a este extracto');
        if (linea.estado !== 'sin_conciliar') {
          resultados.push({ linea_id, ok: true, ya_materializada: true });
          continue;
        }

        const tipo = item.tipo === 'ingreso' ? 'ingreso'
          : item.tipo === 'transferencia' ? 'transferencia' : 'gasto';
        const monto = Math.abs(Number(item.monto ?? linea.monto) || 0);
        if (!(monto > 0)) throw new Error('monto inválido');
        const fecha = toISODate(item.fecha) || toISODate(linea.fecha);
        const descripcion = String(item.descripcion || linea.descripcion || `Extracto línea ${linea_id}`).trim();
        const idempotency_key = `extracto:linea:${linea_id}`;

        if (tipo === 'ingreso') {
          const entidad_id = Number(item.entidad_id) || null;
          const cedula = String(item.cedula || '').trim();
          if (!entidad_id) throw new Error('entidad_id requerido para un ingreso');
          if (!cedula) throw new Error('cedula requerida para un ingreso');
          const { inserted, row } = await insertIngreso({
            entidad_id, fecha, cedula, concepto: descripcion, monto, moneda: item.moneda || 'COP',
            origen: 'Extracto', idempotency_key,
            estado_conciliacion: 'conciliado', extracto_linea_id: linea_id,
          });
          if (inserted && row) {
            try { await contabilizarIngreso(row.id); } catch (e) { console.error('backfill contabilizar ingreso', row.id, e.message); }
          }
          const marcada = row ? await marcarLineaMaterializada({ linea_id, tipo: 'ingreso', id: row.id }) : false;
          resultados.push({ linea_id, ok: true, tipo: 'ingreso', id: row && row.id, creado: inserted, marcada });
        } else {
          let cuenta_destino = null;
          if (tipo === 'transferencia') {
            cuenta_destino = String(item.cuenta_destino || '').trim();
            if (!cuenta_destino) throw new Error('cuenta_destino requerida para una transferencia');
          }
          const { inserted, row } = await insertMovimiento({
            fecha, tipo, categoria: item.categoria || null, subcategoria: item.subcategoria || null,
            descripcion, monto, moneda: item.moneda || 'COP',
            metodo_pago: item.metodo_pago || extracto.cuenta, quien_pago: item.quien_pago || null,
            tarjeta: item.tarjeta || null, cuenta_destino, notas: item.notas || null,
            origen: 'Extracto', idempotency_key,
            estado_conciliacion: 'conciliado', extracto_linea_id: linea_id,
          });
          if (inserted && row) {
            try { await contabilizarMovimiento(row.id); } catch (e) { console.error('backfill contabilizar movimiento', row.id, e.message); }
          }
          const marcada = row ? await marcarLineaMaterializada({ linea_id, tipo: 'movimiento', id: row.id }) : false;
          resultados.push({ linea_id, ok: true, tipo, id: row && row.id, creado: inserted, marcada });
        }
      } catch (e) {
        resultados.push({ linea_id: linea_id || item.linea_id, ok: false, error: e.message });
      }
    }

    const creadas = resultados.filter((r) => r.ok && r.creado).length;
    const restantes = itemsTotal.length - lote.length;
    return ok({
      ok: true, extracto_id, procesadas: lote.length, creadas, restantes, resultados,
      mensaje: `${creadas} línea${creadas === 1 ? '' : 's'} contabilizada${creadas === 1 ? '' : 's'} ✅`
        + (restantes ? ` (${restantes} restante${restantes === 1 ? '' : 's'}: vuelve a enviar el resto).` : '.'),
    });
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Reporte mensual de aportes IBC por persona (Fase 3.2, solo lectura). Auth
 * Google (equipo financiero). Query/body: { periodo? } — mismo formato que
 * `pwaResumenHandler` ('mes' | 'YYYY-MM' | rango 'YYYY-MM-DD..YYYY-MM-DD').
 */
export async function pwaAportesHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  const url = new URL(req.url);
  const body = req.method === 'POST' ? await parseBody(req) : {};
  const g = (k) => url.searchParams.get(k) || body[k];
  try {
    return ok(await reporteAportes({ periodo: g('periodo') }));
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Fondo común del hogar (issue #113, Contab. familiar A, `auto-ok`). Auth Google.
 *   GET  /api/pwa-aportes-hogar?periodo= → reporte del mes: quién aportó cuánto,
 *        su cuota proporcional (según ingreso) y % cumplido (lectura, equipo).
 *   POST /api/pwa-aportes-hogar { entidad_id, fecha, monto, moneda?, metodo_pago?, notas? }
 *        → registra un aporte y lo contabiliza. SOLO owners.
 */
export async function pwaAportesHogarHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    try {
      return ok(await reporteAportesHogar({ periodo: url.searchParams.get('periodo') }));
    } catch (e) {
      return bad(e.message, 422);
    }
  }
  if (req.method !== 'POST') return bad('Método no permitido', 405);
  if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden registrar aportes al fondo común.', 403);

  const body = await parseBody(req);
  const entidad_id = Number(body.entidad_id);
  if (!entidad_id) return bad('entidad requerida');
  const monto = Number(body.monto);
  if (!(monto > 0)) return bad('monto inválido');
  const fecha = String(body.fecha || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

  try {
    const idempotency_key = deriveAporteHogarKey({ entidad_id, fecha, monto, metodo_pago: body.metodo_pago, idempotency_key: body.idempotency_key });
    const r = await registrarAporteHogar({
      entidad_id, fecha, monto, moneda: body.moneda, metodo_pago: body.metodo_pago, notas: body.notas, idempotency_key,
    });
    return ok(r);
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * GET|POST /api/pwa-pagos — Pagos del mes (issue #73, Nocturno 2/7, `auto-ok`).
 * Auth Google (equipo financiero).
 *
 * GET ?anio=&mes= (default: mes en curso) → catálogo de pagos fijos activos
 * con su estado (pagado/pendiente/vencido) para ese mes, el resumen de totales,
 * y los pendientes (no pagados) del mes anterior. Solo lectura, todo el equipo.
 *
 * POST { accion: 'marcar', pago_fijo_id, fecha_pago?, monto_pagado?, anio?, mes? }
 *   → marca un pago fijo como pagado en ese mes (upsert en `pagos_estado`).
 * POST { accion: 'desmarcar', pago_fijo_id, anio?, mes? } → vuelve a pendiente.
 * POST { accion: 'crear', concepto, monto?, dia_vencimiento?, familia?, categoria?, moneda? }
 *   → agrega un pago fijo nuevo al catálogo.
 * POST { accion: 'editar', id, concepto?, monto?, dia_vencimiento?, categoria?, activo? }
 *   → edita/(des)activa un pago fijo existente.
 * Toda escritura es SOLO owners (Luis/Carolina); lectura para el equipo.
 */
export async function pwaPagosHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

  const hoy = hoyISO();
  const [hoyAnio, hoyMes] = hoy.split('-').map(Number);

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const anio = Number(url.searchParams.get('anio')) || hoyAnio;
    const mes = Number(url.searchParams.get('mes')) || hoyMes;
    const incluirInactivos = url.searchParams.get('incluir_inactivos') === '1';
    try {
      const anterior = mesAnterior(anio, mes);
      const [pagosFijos, estadosMes, estadosAnterior] = await Promise.all([
        listPagosFijos({ activo: incluirInactivos ? null : true }),
        queryPagosEstadoMes({ anio, mes }),
        queryPagosEstadoMes({ anio: anterior.anio, mes: anterior.mes }),
      ]);
      const pagos = armarPagosDelMes(pagosFijos, estadosMes, anio, mes, hoy);
      // Un pago fijo agregado HOY no "existía" el mes pasado: no debe aparecer
      // como pendiente/vencido de un mes anterior a su creación.
      const vigentesMesAnterior = pagosFijos.filter((p) => estaVigenteEnMes(p, anterior.anio, anterior.mes));
      const pagosMesAnterior = armarPagosDelMes(vigentesMesAnterior, estadosAnterior, anterior.anio, anterior.mes, hoy);
      const pendientesMesAnterior = pagosMesAnterior.filter((p) => p.estado !== 'pagado');
      return ok({
        ok: true,
        anio, mes,
        pagos,
        // El resumen de totales es siempre sobre los pagos fijos ACTIVOS del mes,
        // aunque la lista completa (con inactivos) se haya pedido para gestión.
        resumen: resumenPagos(pagos.filter((p) => p.activo)),
        mes_anterior: anterior,
        pendientes_mes_anterior: pendientesMesAnterior,
      });
    } catch (e) {
      return bad(e.message, 422);
    }
  }

  if (req.method !== 'POST') return bad('Método no permitido', 405);
  const body = await parseBody(req);
  const accion = String(body.accion || '');

  if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden gestionar pagos fijos.', 403);

  try {
    if (accion === 'marcar') {
      const pago_fijo_id = Number(body.pago_fijo_id);
      if (!pago_fijo_id) return bad('pago_fijo_id requerido');
      const r = await upsertPagoEstado({
        pago_fijo_id,
        anio: Number(body.anio) || hoyAnio,
        mes: Number(body.mes) || hoyMes,
        fecha_pago: body.fecha_pago || hoy,
        monto_pagado: body.monto_pagado,
        movimiento_id: body.movimiento_id,
      });
      return ok({ ok: true, pago: r });
    }
    if (accion === 'desmarcar') {
      const pago_fijo_id = Number(body.pago_fijo_id);
      if (!pago_fijo_id) return bad('pago_fijo_id requerido');
      await desmarcarPagoEstado({ pago_fijo_id, anio: Number(body.anio) || hoyAnio, mes: Number(body.mes) || hoyMes });
      return ok({ ok: true });
    }
    if (accion === 'crear') {
      const concepto = String(body.concepto || '').trim();
      if (!concepto) return bad('concepto requerido');
      const familia = body.familia === 'DCC' ? 'DCC' : 'DCDG';
      const dia_vencimiento = Math.min(Math.max(Number(body.dia_vencimiento) || 1, 1), 31);
      try {
        const r = await insertPagoFijo({ concepto, monto: body.monto, dia_vencimiento, familia, categoria: body.categoria, moneda: body.moneda });
        return ok({ ok: true, pago_fijo: r });
      } catch (e) {
        if (/duplicate key|unique constraint/i.test(e.message)) {
          return bad(`Ya existe un pago fijo "${concepto}" en ${familia}.`);
        }
        throw e;
      }
    }
    if (accion === 'editar') {
      const id = Number(body.id);
      if (!id) return bad('id requerido');
      const patch = { ...body };
      if (patch.dia_vencimiento != null) patch.dia_vencimiento = Math.min(Math.max(Number(patch.dia_vencimiento) || 1, 1), 31);
      const r = await updatePagoFijo(id, patch);
      if (!r) return bad('Pago fijo no encontrado', 404);
      return ok({ ok: true, pago_fijo: r });
    }
    return bad('accion inválida (marcar | desmarcar | crear | editar)');
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Préstamos entre Luis y Carolina (issue #77, Nocturno 6/7; partida doble e
 * issue #116, Contab. familiar D). Auth Google.
 *   GET  /api/pwa-prestamos → lista + saldo neto por moneda (lectura, equipo).
 *   POST /api/pwa-prestamos { accion: 'crear' | 'marcar_saldado' | 'pagar_deuda_otro', ... } → SOLO owners.
 */
export async function pwaPrestamosHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

  if (req.method === 'GET') {
    try {
      const prestamos = await listPrestamos({});
      return ok({ ok: true, prestamos, saldo: calcularSaldoPrestamos(prestamos) });
    } catch (e) {
      return bad(e.message, 422);
    }
  }

  if (req.method !== 'POST') return bad('Método no permitido', 405);
  if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden registrar préstamos.', 403);

  const body = await parseBody(req);
  const accion = String(body.accion || 'crear');
  try {
    if (accion === 'crear') {
      const p = await registrarPrestamoConAsiento({
        fecha: String(body.fecha || '').slice(0, 10) || hoyISO(),
        de: body.de, para: body.para, monto: body.monto,
        concepto: body.concepto, moneda: body.moneda, notas: body.notas,
      });
      return ok({ ok: true, prestamo: p });
    }
    if (accion === 'marcar_saldado') {
      const id = Number(body.id);
      if (!id) return bad('id requerido');
      const p = await marcarSaldadoConAsiento(id, body.saldado !== false);
      if (!p) return bad('Préstamo no encontrado', 404);
      return ok({ ok: true, prestamo: p });
    }
    if (accion === 'pagar_deuda_otro') {
      const r = await registrarPagoDeOtro({
        fecha: body.fecha, pagador: body.pagador, deudor: body.deudor, monto: body.monto,
        categoria: body.categoria, subcategoria: body.subcategoria, metodo_pago: body.metodo_pago,
        concepto: body.concepto, moneda: body.moneda, notas: body.notas,
      });
      return ok(r);
    }
    return bad('accion inválida (crear | marcar_saldado | pagar_deuda_otro)');
  } catch (e) {
    return bad(e.message, 422);
  }
}

/**
 * Solicitudes de mejoras (issue #78, Nocturno 7/7). Auth Google.
 *   GET  /api/pwa-solicitudes → lista issues abiertos con label `autobuild` (equipo, lectura).
 *   POST /api/pwa-solicitudes { texto } → crea el issue en GitHub. SOLO owners.
 * Sin GITHUB_TOKEN_FINANZAS configurado, degrada con gracia (no falla la function).
 */
export async function pwaSolicitudesHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let auth;
  try { auth = await resolvePwaUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

  if (req.method === 'GET') {
    try {
      const solicitudes = await listarSolicitudesAbiertas();
      return ok({ ok: true, configurado: true, solicitudes });
    } catch (e) {
      if (CONFIG_GITHUB_RE.test(e.message)) return ok({ ok: true, configurado: false, solicitudes: [], mensaje: e.message });
      return bad(e.message, 422);
    }
  }

  if (req.method !== 'POST') return bad('Método no permitido', 405);
  if (!esOwner(auth)) return bad('Solo Luis o Carolina pueden enviar solicitudes de mejoras.', 403);

  const body = await parseBody(req);
  try {
    const issue = await crearSolicitudMejora(body.texto);
    return ok({ ok: true, issue });
  } catch (e) {
    if (CONFIG_GITHUB_RE.test(e.message)) return bad(e.message, 501);
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
