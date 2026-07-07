/**
 * utils/pdfExtract.js — Descifra y extrae el TEXTO de un PDF EN EL NAVEGADOR.
 *
 * Para los extractos bancarios protegidos (Bancolombia: la contraseña es la
 * cédula del titular / NIT). La contraseña NUNCA sale del dispositivo: el
 * descifrado y la extracción ocurren acá; al backend solo se manda el texto.
 *
 * pdfjs se carga perezosamente porque este módulo se importa de forma dinámica
 * (`await import('../utils/pdfExtract.js')`) solo cuando hay un PDF que leer.
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * @param {ArrayBuffer} data  bytes del PDF
 * @param {string} [password] contraseña (para PDFs protegidos)
 * @returns {Promise<string>} texto concatenado de todas las páginas
 */
export async function extractTextFromPdf(data, password) {
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data), password: password || undefined }).promise;
  } catch (e) {
    const name = (e && e.name) || '';
    if (name === 'PasswordException' || /password/i.test(String((e && e.message) || ''))) {
      const err = new Error('Contraseña incorrecta o el PDF está protegido. En Bancolombia la clave es la cédula del titular (persona) o el NIT (empresa).');
      err.code = 'BAD_PASSWORD';
      throw err;
    }
    throw new Error('No se pudo leer el PDF: ' + ((e && e.message) || 'formato no soportado'));
  }
  const partes = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    partes.push(content.items.map((it) => (it.str || '')).join(' '));
  }
  return partes.join('\n');
}
