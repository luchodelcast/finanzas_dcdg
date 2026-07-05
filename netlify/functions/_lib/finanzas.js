/**
 * _lib/finanzas.js — Lógica de negocio financiera DCDG (backend, fuente de verdad).
 *
 * Registra movimientos que llegan por SilvIA/WhatsApp (o cualquier cliente de la
 * API) en el Google Sheet DCDG. Soporta tres tipos:
 *   - "gasto":   gasto familiar diario.
 *   - "pago":    pago de una obligación (servicios, tarjeta, cuota).
 *   - "factura": factura recibida / cuenta por pagar registrada como movimiento.
 *
 * Todos se escriben en `Registro Gastos` (columnas A-J; K es fórmula en la hoja),
 * etiquetando el tipo y el origen en la columna I (Notas). Aplica las reglas de
 * negocio iWin/Delca2 (sección 10) y, si corresponde, registra el adelanto de
 * honorarios en la hoja `EMPRESAS`.
 */

import { config } from './env.js';
import { appendRow, readRange, updateValues } from './sheets.js';
import { matchDuplicate } from './dedup.js';
import { clasificar } from './classify.js';
import { evaluarMovimiento } from '../../../app/src/config/iwin.js';
import { cuentaPorTarjeta } from '../../../app/src/config/accounts.js';
import {
  parseMonto,
  normalizarFecha,
  mesDeISO,
  ultimos4,
  formatCOP,
} from '../../../app/src/utils/formatters.js';

const TIPOS = new Set(['gasto', 'pago', 'factura']);

const ETIQUETA_TIPO = {
  gasto: '🤖 SilvIA · gasto',
  pago: '🤖 SilvIA · pago',
  factura: '🤖 SilvIA · factura',
};

/**
 * Registra un movimiento financiero.
 * @param {Object} mov
 * @param {'gasto'|'pago'|'factura'} mov.tipo
 * @param {number|string} mov.monto
 * @param {string} mov.descripcion
 * @param {string} [mov.quien_pago]     Luis | Carolina
 * @param {string} [mov.metodo_pago]    nombre de cuenta / tarjeta
 * @param {string} [mov.fecha]          YYYY-MM-DD (def hoy)
 * @param {string} [mov.categoria]
 * @param {string} [mov.subcategoria]
 * @param {string} [mov.tarjeta_ultimos4]
 * @param {string} [mov.notas]
 * @param {string} [mov.origen]         etiqueta de canal (def "SilvIA")
 * @returns {Promise<Object>} resultado con lo escrito o el motivo de omisión.
 */
export async function registrarMovimiento(mov = {}) {
  const tipo = String(mov.tipo || 'gasto').toLowerCase();
  if (!TIPOS.has(tipo)) {
    throw new Error(`tipo inválido: "${mov.tipo}". Usa gasto | pago | factura.`);
  }

  const monto = parseMonto(mov.monto);
  if (monto == null || monto <= 0) {
    throw new Error('monto inválido o ausente');
  }
  const descripcion = String(mov.descripcion || '').trim();
  if (!descripcion) throw new Error('descripcion requerida');

  // 1) Clasificación: respeta lo que venga; completa con reglas/modelo.
  let categoria = String(mov.categoria || '').trim();
  let subcategoria = String(mov.subcategoria || '').trim();
  let metodo = String(mov.metodo_pago || '').trim();
  let iwinPrestamo = false;

  if (!categoria || !subcategoria) {
    const cls = await clasificar(descripcion);
    categoria = categoria || cls.categoria;
    subcategoria = subcategoria || cls.subcategoria;
    if (!metodo && cls.metodo_pago) metodo = cls.metodo_pago;
    iwinPrestamo = !!cls.iwin_prestamo;
  }

  // 2) Resolver tarjeta y cuenta.
  const tarjeta = ultimos4(mov.tarjeta_ultimos4 || metodo);
  if (!metodo && tarjeta) {
    const cta = cuentaPorTarjeta(tarjeta);
    if (cta) metodo = cta.nombre;
  }

  // 3) Reglas de negocio iWin/Delca2.
  const evalMov = evaluarMovimiento({
    tarjeta_ultimos4: tarjeta,
    metodo_pago: metodo,
    iwin_prestamo: iwinPrestamo,
  });
  if (!evalMov.registrar) {
    return { ok: true, registrado: false, motivo: evalMov.motivo, tipo, monto };
  }

  const fecha = normalizarFecha(mov.fecha);
  const origen = String(mov.origen || 'SilvIA');
  const titular = String(mov.quien_pago || '').trim() || 'Luis';

  // 4) Deduplicación a nivel del Sheet (fuente-agnóstica): revisa las filas
  //    recientes por misma fecha + monto + comercio. Protege API, PWA y SilvIA.
  let dup = null;
  try {
    const previas = await readRange(`${config.sheetGastos()}!A2:L`);
    dup = matchDuplicate(previas, { fecha, monto, descripcion });
  } catch (_) {
    /* si falla la lectura, seguimos como alta normal (no bloquear el registro) */
  }

  if (dup) {
    // 4a) La fila ya existe pero le faltaba la cuenta y ahora la traemos →
    //     ACTUALIZAR esa fila en vez de crear otra (evita el duplicado del
    //     flujo "regístralo… ah, y fue con la tarjeta X").
    if (!dup.metodoActual && (metodo || tarjeta)) {
      const g = config.sheetGastos();
      if (metodo) await updateValues(`${g}!G${dup.rowNumber}`, [[metodo]]);
      if (tarjeta) await updateValues(`${g}!J${dup.rowNumber}`, [[tarjeta]]);
      const emp = await escribirEmpresas(evalMov, { descripcion, titular, monto, fecha, origen });
      return {
        ok: true, registrado: true, actualizado: true, fila: dup.rowNumber,
        tipo, fecha, categoria, subcategoria, monto, monto_fmt: formatCOP(monto),
        metodo_pago: metodo, quien_pago: titular, tarjeta,
        adelanto_empresas: emp.adelanto, retiro_delca2: emp.retiroDelca2,
        mensaje: `Actualicé el registro con la cuenta ✅ ${metodo || tarjeta}${emp.retiroDelca2 ? ' · retiro Delca2 registrado' : ''}${emp.adelanto ? ' · adelanto iWin registrado' : ''}.`,
      };
    }
    // 4b) Duplicado genuino (ya tiene la info) → NO escribir; preguntar. Solo se
    //     registra si el llamador confirma explícitamente (confirmar: true).
    if (!mov.confirmar) {
      return {
        ok: true,
        registrado: false,
        posible_duplicado: {
          fila: dup.rowNumber, fecha, monto, monto_fmt: formatCOP(monto),
          descripcion, categoria, subcategoria, metodo_actual: dup.metodoActual,
        },
        mensaje: `Parece que ya está registrado: ${categoria}${subcategoria ? '/' + subcategoria : ''} ${formatCOP(monto)} "${descripcion}" del ${fecha}. ¿Lo anoto igual?`,
      };
    }
    // confirmar === true → cae al alta normal (registro forzado).
  }

  // 5) Alta normal. Fila A-L: A-J como siempre, K vacío (cuenta auto-resuelta) y
  //    L = timestamp de creación (para poder distinguir filas después).
  const notasBase = ETIQUETA_TIPO[tipo].replace('SilvIA', origen);
  const notas = [notasBase, mov.notas].filter(Boolean).join(' — ');
  const fila = [
    fecha,                 // A Fecha
    mesDeISO(fecha),       // B Mes
    categoria,             // C Categoría
    subcategoria,          // D Subcategoría
    descripcion,           // E Descripción / Comercio
    monto,                 // F Monto (número)
    metodo,                // G Método de pago
    titular,               // H Quién pagó
    notas,                 // I Notas
    tarjeta,               // J Tarjeta (últimos 4)
    '',                    // K Cuenta auto-resuelta (fórmula en la hoja)
    nowISO(),              // L Registrado (timestamp UTC)
  ];
  await appendRow(config.sheetGastos(), fila);

  const emp = await escribirEmpresas(evalMov, { descripcion, titular, monto, fecha, origen });

  return {
    ok: true,
    registrado: true,
    tipo,
    fecha,
    categoria,
    subcategoria,
    monto,
    monto_fmt: formatCOP(monto),
    metodo_pago: metodo,
    quien_pago: titular,
    tarjeta,
    adelanto_empresas: emp.adelanto,
    retiro_delca2: emp.retiroDelca2,
    mensaje: `Anotado ✅ ${categoria}${subcategoria ? '/' + subcategoria : ''} ${formatCOP(monto)}${metodo ? ', ' + metodo : ''}${emp.retiroDelca2 ? ' · retiro Delca2 registrado' : ''}${emp.adelanto ? ' · adelanto iWin registrado' : ''}.`,
  };
}

/** ISO timestamp (helper aislado para poder mockearlo en tests si hiciera falta). */
function nowISO() {
  return new Date().toISOString();
}

/**
 * Escribe en EMPRESAS el adelanto (Jeeves/iWin) o el retiro (Delca2) si aplica.
 * Formato de 13 columnas del monolito. Reutilizado por el alta y por la
 * actualización de una fila a la que se le agrega la cuenta.
 */
async function escribirEmpresas(evalMov, { descripcion, titular, monto, fecha, origen }) {
  const mesNum = mesDeISO(fecha);
  const anio = Number(fecha.slice(0, 4)) || new Date().getFullYear();
  const mesNombre = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][mesNum - 1];
  let adelanto = null;
  let retiroDelca2 = null;
  if (evalMov.adelanto_empresas) {
    await appendRow(config.sheetEmpresas(), [
      '', 'Superlikers', 'Empresa → Familia', mesNombre, anio,
      `Adelanto honorarios LADCC · ${descripcion}`, titular,
      monto, 'COP', monto, 'Pendiente', '', `Registrado vía ${origen} · ${fecha}`,
    ]);
    adelanto = { hoja: config.sheetEmpresas(), tipo: 'adelanto', monto };
  }
  if (evalMov.retiro_delca2) {
    await appendRow(config.sheetEmpresas(), [
      '', 'Delca2', 'Empresa → Familia', mesNombre, anio,
      `Retiro/distribución socios Delca2 · ${descripcion}`, titular,
      monto, 'COP', monto, 'Registrado', '', `Registrado vía ${origen} · ${fecha}`,
    ]);
    retiroDelca2 = { hoja: config.sheetEmpresas(), tipo: 'retiro', monto };
  }
  return { adelanto, retiroDelca2 };
}

/**
 * Resumen de gastos del Registro Gastos.
 * @param {Object} q
 * @param {string} [q.periodo]    'mes' | 'semana' | 'YYYY-MM' | 'YYYY-MM-DD..YYYY-MM-DD'
 * @param {string} [q.categoria]  filtra por categoría (contains, case-insensitive)
 * @param {string} [q.quien]      filtra por quién pagó
 * @param {Date}   [q.hoy]        fecha de referencia (inyectable para tests)
 * @returns {Promise<Object>}
 */
export async function resumen(q = {}) {
  const hoy = q.hoy instanceof Date ? q.hoy : new Date();
  const { desde, hasta, etiqueta } = rangoPeriodo(q.periodo, hoy);

  // Registro Gastos no tiene emoji → values API directa.
  const rows = await readRange(`${config.sheetGastos()}!A2:J`);

  const catFiltro = (q.categoria || '').toLowerCase().trim();
  const quienFiltro = (q.quien || '').toLowerCase().trim();

  let total = 0;
  const porCategoria = {};
  let n = 0;
  for (const r of rows) {
    const fecha = r[0];
    if (!fecha || fecha < desde || fecha > hasta) continue;
    const categoria = r[2] || 'Sin categoría';
    const monto = Number(r[5]) || 0;
    const quien = (r[7] || '').toLowerCase();
    if (catFiltro && !categoria.toLowerCase().includes(catFiltro)) continue;
    if (quienFiltro && !quien.includes(quienFiltro)) continue;
    total += monto;
    porCategoria[categoria] = (porCategoria[categoria] || 0) + monto;
    n++;
  }

  const desglose = Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .map(([categoria, monto]) => ({ categoria, monto, monto_fmt: formatCOP(monto) }));

  return {
    ok: true,
    periodo: etiqueta,
    desde,
    hasta,
    total,
    total_fmt: formatCOP(total),
    movimientos: n,
    por_categoria: desglose,
  };
}

/** Calcula el rango [desde, hasta] (YYYY-MM-DD) de un periodo. */
export function rangoPeriodo(periodo, hoy = new Date()) {
  const iso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const p = String(periodo || 'mes').toLowerCase().trim();

  // Rango explícito YYYY-MM-DD..YYYY-MM-DD
  const rango = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(p);
  if (rango) return { desde: rango[1], hasta: rango[2], etiqueta: `${rango[1]} a ${rango[2]}` };

  // Mes específico YYYY-MM
  const mesEsp = /^(\d{4})-(\d{2})$/.exec(p);
  if (mesEsp) {
    const y = Number(mesEsp[1]);
    const m = Number(mesEsp[2]);
    const ini = new Date(y, m - 1, 1);
    const fin = new Date(y, m, 0);
    return { desde: iso(ini), hasta: iso(fin), etiqueta: p };
  }

  if (p === 'semana') {
    const d = new Date(hoy);
    const dow = (d.getDay() + 6) % 7; // lunes=0
    const ini = new Date(d);
    ini.setDate(d.getDate() - dow);
    return { desde: iso(ini), hasta: iso(hoy), etiqueta: 'semana' };
  }

  // Mes en curso (default)
  const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  return { desde: iso(ini), hasta: iso(hoy), etiqueta: 'mes' };
}
