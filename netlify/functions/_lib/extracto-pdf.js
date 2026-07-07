/**
 * _lib/extracto-pdf.js — Estructura el TEXTO de un extracto bancario en líneas
 * normalizadas, usando Claude. Reusa el mismo shape que `parseCsvExtracto` para
 * compartir el flujo de guardado (insertExtracto / insertExtractoLineas).
 *
 * El descifrado del PDF protegido y la extracción de texto ocurren EN EL
 * NAVEGADOR (`app/src/utils/pdfExtract.js`): la contraseña (cédula del titular /
 * NIT en Bancolombia) NUNCA llega al servidor. Acá solo llega el texto legible.
 */
import { parseMonto, normalizarFecha } from '../../../app/src/utils/formatters.js';
import { callAnthropic, extractJson } from './anthropic.js';

const SYSTEM = `Eres un extractor de transacciones de extractos bancarios colombianos (p. ej. Bancolombia). Recibes el TEXTO plano de un extracto y devuelves EXCLUSIVAMENTE un objeto JSON, sin explicaciones ni texto fuera del JSON, con esta forma:
{"transacciones":[{"fecha":"YYYY-MM-DD","descripcion":"texto","monto":-12345.67}]}
Reglas:
- Una entrada por movimiento/transacción del extracto.
- "monto" es un número: NEGATIVO para débitos/retiros/cargos/pagos; POSITIVO para créditos/consignaciones/abonos/depósitos.
- "fecha" en formato YYYY-MM-DD. Si a una fila le falta el año, dedúcelo del periodo del extracto.
- Ignora encabezados, saldos, totales, cuotas de manejo informativas y publicidad: SOLO transacciones reales.
- Si no identificas transacciones, devuelve {"transacciones":[]}.`;

const MAX_TEXT = 60000;

/** Mapea las filas devueltas por el modelo al shape de líneas del extracto (puro). */
export function mapClaudeLineas(rows) {
  const lineas = [];
  const errores = [];
  const arr = Array.isArray(rows) ? rows : [];
  arr.forEach((r, i) => {
    const fechaRaw = String((r && (r.fecha ?? r.date)) || '').trim();
    const montoVal = r && (r.monto ?? r.valor ?? r.amount);
    const monto = typeof montoVal === 'number' ? montoVal : parseMonto(String(montoVal ?? ''));
    if (!fechaRaw || monto == null) { errores.push(`Transacción ${i + 1}: falta fecha o monto`); return; }
    const descripcion = String((r.descripcion ?? r.concepto ?? r.detalle) || '').trim() || null;
    lineas.push({
      fecha: normalizarFecha(fechaRaw),
      descripcion,
      monto,
      tipo: monto < 0 ? 'debito' : 'credito',
      referencia: (r.referencia && String(r.referencia).trim()) || null,
    });
  });
  return { lineas, errores };
}

/**
 * Estructura el texto de un extracto en líneas usando Claude.
 * `deps` permite inyectar callAnthropic/extractJson en tests (sin red).
 * @returns {Promise<{lineas: Array, errores: string[]}>}
 */
export async function parseExtractoPdfText(texto, deps = {}) {
  const _call = deps.callAnthropic || callAnthropic;
  const _extract = deps.extractJson || extractJson;
  const clean = String(texto || '').trim();
  if (!clean) return { lineas: [], errores: ['Texto del extracto vacío'] };
  const raw = await _call({
    content: [{ type: 'text', text: `Texto del extracto bancario:\n\n${clean.slice(0, MAX_TEXT)}` }],
    system: SYSTEM,
    maxTokens: 8000,
  });
  let data;
  try { data = _extract(raw); } catch (e) {
    return { lineas: [], errores: [`El modelo no devolvió JSON válido: ${e.message}`] };
  }
  return mapClaudeLineas(data && data.transacciones);
}
