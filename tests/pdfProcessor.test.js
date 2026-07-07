import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contarPaginasPDF } from '../app/src/utils/pdfProcessor.js';

test('contarPaginasPDF: cuenta un único objeto /Type /Page', () => {
  const pdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n';
  assert.equal(contarPaginasPDF(pdf), 1);
});

test('contarPaginasPDF: cuenta varios objetos /Type/Page (sin espacio)', () => {
  const pdf = '3 0 obj\n<< /Type/Page /Parent 2 0 R >>\nendobj\n' +
    '4 0 obj\n<< /Type/Page /Parent 2 0 R >>\nendobj\n';
  assert.equal(contarPaginasPDF(pdf), 2);
});

test('contarPaginasPDF: no confunde /Type /Pages (árbol) con /Type /Page', () => {
  const pdf = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n';
  assert.equal(contarPaginasPDF(pdf), 1);
});

test('contarPaginasPDF: sin objetos de página detectables asume 1 (no bloquea de más)', () => {
  assert.equal(contarPaginasPDF('contenido binario sin marcadores reconocibles'), 1);
  assert.equal(contarPaginasPDF(''), 1);
});
