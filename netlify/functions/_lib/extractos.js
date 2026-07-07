/**
 * _lib/extractos.js — Parseo de extractos bancarios en CSV (cargador, fase 1
 * de la conciliación; ver docs/conciliacion.md). Módulo puro y testeable.
 *
 * Formato esperado: encabezado con columnas fecha/descripcion/monto (nombres
 * flexibles, sin distinguir mayúsculas/acentos) y filas de datos. Reusa
 * `parseMonto`/`normalizarFecha` (los mismos que la clasificación de texto)
 * para tolerar los formatos de número/fecha que ya soporta el sistema.
 */

import { parseMonto, normalizarFecha } from '../../../app/src/utils/formatters.js';

const HEADERS = {
  fecha: ['fecha', 'date'],
  descripcion: ['descripcion', 'concepto', 'detalle', 'description'],
  monto: ['monto', 'valor', 'amount'],
  referencia: ['referencia', 'ref', 'reference'],
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function detectDelim(line) {
  return line.includes(';') && !line.includes(',') ? ';' : ',';
}

function findCol(header, keys) {
  return header.findIndex((h) => keys.includes(h));
}

/**
 * Parsea el texto de un CSV de extracto a líneas normalizadas.
 * @returns {{ lineas: Array<{fecha, descripcion, monto, tipo, referencia}>, errores: string[] }}
 */
export function parseCsvExtracto(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return { lineas: [], errores: ['CSV vacío'] };

  const delim = detectDelim(lines[0]);
  const header = lines[0].split(delim).map(normalizeHeader);
  const idx = {
    fecha: findCol(header, HEADERS.fecha),
    descripcion: findCol(header, HEADERS.descripcion),
    monto: findCol(header, HEADERS.monto),
    referencia: findCol(header, HEADERS.referencia),
  };
  if (idx.fecha < 0 || idx.monto < 0) {
    return {
      lineas: [],
      errores: [`Encabezado inválido: se requieren columnas "fecha" y "monto" (encontradas: ${header.join(', ')})`],
    };
  }

  const lineas = [];
  const errores = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim);
    const fechaRaw = (cols[idx.fecha] || '').trim();
    const montoRaw = (cols[idx.monto] || '').trim();
    const descripcion = idx.descripcion >= 0 ? (cols[idx.descripcion] || '').trim() : '';
    const referencia = idx.referencia >= 0 ? (cols[idx.referencia] || '').trim() : '';
    const fila = i + 1;
    if (!fechaRaw || !montoRaw) { errores.push(`Fila ${fila}: falta fecha o monto`); continue; }
    const monto = parseMonto(montoRaw);
    if (monto == null) { errores.push(`Fila ${fila}: monto inválido ("${montoRaw}")`); continue; }
    lineas.push({
      fecha: normalizarFecha(fechaRaw),
      descripcion: descripcion || null,
      monto,
      tipo: monto < 0 ? 'debito' : 'credito',
      referencia: referencia || null,
    });
  }
  return { lineas, errores };
}
