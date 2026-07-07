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
  insertIngreso, queryIngresos, listPlanCuentas,
  insertExtracto, insertExtractoLineas, queryExtractos, queryExtractoLineas,
  getExtracto, queryMovimientosProvisionales, queryIngresosProvisionales, confirmarConciliacion,
} from './repo.js';
import { deriveIngresoKey } from './idempotency.js';
import { registrarCuenta } from './cuentas.js';
import { clasificar } from './classify.js';
import { verifyFinanceUser } from './google-auth.js';
import { callAnthropic, extractJson, buildReceiptContent } from './anthropic.js';
import { buildSystemPrompt } from '../../../app/src/config/prompt.js';
import { parseCsvExtracto } from './extractos.js';
import { parseExtractoPdfText } from './extracto-pdf.js';
import { proponerCruces, VENTANA_DIAS_DEFAULT, toISODate } from './conciliacion.js';
import { reporteAportes } from './aportes.js';

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
    await verifyFinanceUser(bearer);
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

/** Plan de cuentas (PUC) para consulta. Auth Google (equipo financiero, lectura). */
export async function pwaPlanCuentasHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await verifyFinanceUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  const url = new URL(req.url);
  const clase = url.searchParams.get('clase');
  try {
    const cuentas = await listPlanCuentas({ clase });
    return ok({ ok: true, cuentas, n: cuentas.length });
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

/**
 * Carga (POST) o lista (GET) extractos bancarios en CSV. Auth Google (equipo
 * financiero). Primer paso de la conciliación (docs/conciliacion.md): solo
 * normaliza y guarda las líneas (`extracto_lineas`, sin_conciliar); el cruce
 * automático contra lo capturado es una fase futura.
 */
export async function pwaExtractoHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await verifyFinanceUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

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
  try { await verifyFinanceUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }

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

/**
 * Reporte mensual de aportes IBC por persona (Fase 3.2, solo lectura). Auth
 * Google (equipo financiero). Query/body: { periodo? } — mismo formato que
 * `pwaResumenHandler` ('mes' | 'YYYY-MM' | rango 'YYYY-MM-DD..YYYY-MM-DD').
 */
export async function pwaAportesHandler(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  try { await verifyFinanceUser(bearer); } catch (e) { return bad(e.message, e.status || 401); }
  const url = new URL(req.url);
  const body = req.method === 'POST' ? await parseBody(req) : {};
  const g = (k) => url.searchParams.get(k) || body[k];
  try {
    return ok(await reporteAportes({ periodo: g('periodo') }));
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
