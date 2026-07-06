/**
 * _lib/cuentas.js — Alta de cuentas/tarjetas en el catálogo `⚙️ CUENTAS`.
 *
 * `⚙️ CUENTAS` (Sheet) es el catálogo operativo de cuentas y tarjetas que la PWA
 * carga (loadCuentas) y que usa la resolución de tarjeta→cuenta al registrar
 * gastos. Estructura (columnas B..I, datos desde la fila 4):
 *   B nombre · C banco · D titular · E moneda · F tipo · G tipoEspecial ·
 *   H activa ('No' = inactiva) · I tarjeta (últimos 4).
 *
 * Se agrega con appendCells (emoji-safe por sheetId). Deduplica por últimos 4 /
 * nombre para no crear la misma tarjeta dos veces.
 */

import { config } from './env.js';
import { appendRow, readRange } from './sheets.js';

const last4 = (v) => String(v || '').replace(/\D/g, '').slice(-4);

/**
 * Registra una cuenta/tarjeta nueva en `⚙️ CUENTAS`.
 * @param {{ nombre?, banco?, titular?, tarjeta?, tarjeta_ultimos4?, tipo?, moneda? }} c
 * @returns {Promise<Object>}
 */
export async function registrarCuenta(c = {}) {
  const t4 = last4(c.tarjeta || c.tarjeta_ultimos4);
  const banco = String(c.banco || '').trim();
  const titular = String(c.titular || '').trim();
  const tipo = String(c.tipo || '').trim() || 'Normal';
  const moneda = String(c.moneda || '').trim() || 'COP';
  // Nombre: el indicado, o uno derivado "Banco Titular (1234)".
  const nombre = String(c.nombre || '').trim()
    || [banco, titular, t4 && `(${t4})`].filter(Boolean).join(' ').trim();
  if (!nombre) throw new Error('Faltan datos de la cuenta (banco/titular o nombre).');

  // Dedup: si ya existe una con esos últimos 4 o el mismo nombre, no duplica.
  try {
    const rows = await readRange("'⚙️ CUENTAS'!B4:I200");
    const existe = (rows || []).find((r) =>
      (t4 && last4(r[7]) === t4) ||
      String(r[0] || '').trim().toLowerCase() === nombre.toLowerCase()
    );
    if (existe) {
      return { ok: true, registrada: false, ya_existia: true, nombre: existe[0], tarjeta: last4(existe[7]),
        mensaje: `La cuenta ya estaba en el catálogo: ${existe[0]}.` };
    }
  } catch (_) { /* si falla la lectura, seguimos con el alta */ }

  // Fila A..I (A vacía; los datos viven en B..I).
  await appendRow(config.sheetCuentas(), ['', nombre, banco, titular, moneda, tipo, 'Normal', 'Sí', t4]);

  return { ok: true, registrada: true, nombre, banco, titular, tarjeta: t4, tipo, moneda,
    mensaje: `Cuenta registrada ✅ ${nombre}${t4 ? ' · tarjeta ' + t4 : ''}.` };
}
