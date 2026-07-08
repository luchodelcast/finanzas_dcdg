/**
 * utils/download.js — Dispara la descarga de un Blob en el navegador (T12a).
 * Usa un <a download> temporal + Object URL; sin dependencias.
 */
export function descargarBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
