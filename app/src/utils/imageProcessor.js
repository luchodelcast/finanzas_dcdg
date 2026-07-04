/**
 * utils/imageProcessor.js — Procesamiento de imágenes de recibos (navegador).
 *
 * Migra la lógica del monolito: convierte HEIC/PNG/etc. a JPEG vía Canvas,
 * redimensiona para no exceder límites de la API de visión, y devuelve base64
 * listo para el bloque `image` de Anthropic.
 *
 * Solo funciona en el navegador (usa Image/Canvas/FileReader).
 */

const MAX_DIMENSION = 1568; // límite recomendado por Anthropic para visión
const JPEG_QUALITY = 0.85;

/** Lee un File/Blob como data URL. */
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('No se pudo leer el archivo'));
    fr.readAsDataURL(file);
  });
}

/** Carga una data URL en un elemento Image. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Formato de imagen no soportado por el navegador'));
    img.src = src;
  });
}

/**
 * Procesa una imagen de recibo → { base64, mediaType, dataUrl }.
 * @param {File|Blob} file
 * @returns {Promise<{ base64: string, mediaType: string, dataUrl: string }>}
 */
export async function procesarRecibo(file) {
  const dataUrl = await readAsDataURL(file);
  let img;
  try {
    img = await loadImage(dataUrl);
  } catch (e) {
    // HEIC no siempre decodifica en <img>; se informa al usuario.
    throw new Error(
      'No se pudo procesar la imagen (¿HEIC?). Prueba tomar la foto en JPEG o usa "elegir de galería".'
    );
  }

  let { width, height } = img;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  const jpegDataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const base64 = jpegDataUrl.split(',')[1];
  return { base64, mediaType: 'image/jpeg', dataUrl: jpegDataUrl };
}
