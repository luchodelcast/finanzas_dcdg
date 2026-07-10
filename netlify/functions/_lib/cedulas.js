/**
 * _lib/cedulas.js — Catálogo de cédulas de ingreso (renta personas naturales),
 * compartido entre los desplegables de captura (`pwaCatalogosHandler`) y la
 * hoja de trabajo de renta por cédulas (issue #130, `_lib/renta-anual.js`).
 */
export const CEDULAS = [
  { value: 'trabajo', label: 'Salario (rentas de trabajo)' },
  { value: 'honorarios', label: 'Honorarios' },
  { value: 'no_laboral', label: 'Rentas no laborales (negocio, ventas)' },
  { value: 'capital', label: 'Rentas de capital (arriendos, rendimientos)' },
  { value: 'dividendos', label: 'Dividendos' },
  { value: 'pension', label: 'Pensiones' },
];
