/**
 * utils/pdfProcessor.js — Procesamiento de comprobantes en PDF (navegador).
 *
 * A diferencia de imageProcessor.js, acá no hay que convertir nada: la
 * Messages API de Anthropic soporta PDF nativo (bloque `document`), así que
 * solo leemos el archivo como base64. Lo que sí hacemos es un chequeo
 * best-effort de tamaño/páginas ANTES de mandarlo, para avisar al usuario en
 * vez de fallar en silencio (o gastar tokens) del lado de Claude.
 *
 * Alcance acotado (issue #35): solo comprobantes de **una página**. Si el PDF
 * trae más páginas, se avisa y no se envía — soportar multi-página queda como
 * decisión abierta para el dueño.
 *
 * El límite de tamaño (`MAX_PDF_SIZE_BYTES`) es un placeholder conservador:
 * el valor exacto también queda como decisión abierta (ver PR #35).
 */

export const MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB — placeholder, ver nota arriba

/** Lee un File/Blob como data URL. */
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('No se pudo leer el archivo'));
    fr.readAsDataURL(file);
  });
}

/**
 * Cuenta páginas de un PDF de forma best-effort, contando objetos
 * `/Type /Page` (sin contar el nodo `/Type /Pages` del árbol de páginas). Es
 * una heurística de texto plano, NO un parser real de PDF: funciona bien para
 * los PDFs "normales" que emiten bancos/comercios, pero puede subcontar en
 * PDFs que usan "object streams" comprimidos (PDF 1.5+) — limitación conocida,
 * documentada en el PR. Si no detecta ningún objeto de página, asume 1 (para
 * no bloquear de más ante un PDF que no matchea el patrón).
 * @param {string} binaryStr  contenido crudo del PDF como binary string (1 char = 1 byte, p.ej. el resultado de atob())
 * @returns {number}
 */
export function contarPaginasPDF(binaryStr) {
  const matches = String(binaryStr || '').match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches && matches.length > 0 ? matches.length : 1;
}

/**
 * Procesa un PDF de recibo → { base64, mediaType, dataUrl, paginas }.
 * Lanza un Error con mensaje amigable si excede el tamaño máximo o si detecta
 * más de 1 página (en vez de mandarlo igual y fallar en silencio).
 * @param {File|Blob} file
 * @returns {Promise<{ base64: string, mediaType: string, dataUrl: string, paginas: number }>}
 */
export async function procesarReciboPDF(file) {
  if (file.size > MAX_PDF_SIZE_BYTES) {
    const mb = Math.round(MAX_PDF_SIZE_BYTES / (1024 * 1024));
    throw new Error(
      `El PDF pesa más de ${mb} MB. Prueba con un PDF más liviano o toma una foto del comprobante.`
    );
  }
  const dataUrl = await readAsDataURL(file);
  const base64 = dataUrl.split(',')[1];

  let paginas = 1;
  try {
    paginas = contarPaginasPDF(atob(base64));
  } catch (_) {
    // best-effort: si atob falla (base64 raro), no bloqueamos por páginas.
  }
  if (paginas > 1) {
    throw new Error(
      `Este PDF tiene ${paginas} páginas. Por ahora solo se admiten comprobantes de 1 página; ` +
        'exporta solo la página del comprobante o usa una foto.'
    );
  }

  return { base64, mediaType: 'application/pdf', dataUrl, paginas };
}
