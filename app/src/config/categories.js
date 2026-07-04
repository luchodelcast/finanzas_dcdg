/**
 * config/categories.js — Taxonomía de categorías/subcategorías DCDG.
 *
 * Portado 1:1 del objeto `CATS` del monolito DCDG_Captura_v5.html. Alimenta los
 * selects de la pantalla de confirmación y valida la salida del clasificador.
 */

export const CATS = {
  'Alimentación': ['Mercado', 'Restaurante', 'Domicilios'],
  'Transporte': ['Uber/Taxi', 'Gasolina/EDS', 'Vehículos/Lavado', 'SOAT Vehículo', 'Bus/Metro', 'Peajes'],
  'Personal LADCC': ['Gastos Personales LADCC'],
  'Personal CMDG': ['Gastos Personales CMDG'],
  'Salud': ['Salud: Medicamentos', 'Salud: Citas Médicas', 'Salud: Otros'],
  'Entretenimiento': ['Suscripciones Online', 'Ocio y entretenimiento'],
  'Regalos y celebraciones': ['Regalo', 'Celebración'],
  'Educación': ['Colegio', 'Útiles y materiales', 'Extracurriculares'],
  'Gastos Luhijo - Luciano': ['Meriendas y Almuerzos Colegio', 'Actividades', 'Otros hijos'],
  'Hogar/Aseo': ['Artículos del hogar', 'Productos de aseo'],
  'Ropa': ['Ropa adultos', 'Ropa niños', 'Calzado'],
  'Viajes': ['Tiquetes', 'Hotel', 'Gastos en viaje'],
  'Gastos Bancarios': ['4x1000', 'Cuota manejo', 'Comisiones'],
  'Imprevistos': ['Otros'],
};

/** Lista de nombres de categoría en orden. */
export const CATEGORIAS = Object.keys(CATS);

/** Subcategorías de una categoría (o []). */
export function subcategorias(categoria) {
  return CATS[categoria] || [];
}

/**
 * Cuentas de respaldo cuando no se pueden leer desde ⚙️ CUENTAS.
 * Portado de `CUENTAS_FALLBACK` del monolito.
 */
export const CUENTAS_FALLBACK = [
  { name: 'Débito Bancolombia', tipoEspecial: 'Normal' },
  { name: 'TC Colpatria', tipoEspecial: 'Normal' },
  { name: 'TC Serfinanza 6014', tipoEspecial: 'Normal' },
  { name: 'Nequi', tipoEspecial: 'Normal' },
  { name: 'TC iWin (Superlikers)', tipoEspecial: 'iWin-Adelanto' },
  { name: 'Mercury USD', tipoEspecial: 'USD-Internacional' },
  { name: 'DollarApp', tipoEspecial: 'USD-Internacional' },
  { name: 'Efectivo', tipoEspecial: 'Normal' },
];

/** Cuentas origen para el CET (últimos 4 → etiqueta). */
export const CET_CUENTAS = [
  { value: '0965', label: 'Cta 0965 · Luis (principal)' },
  { value: '3355', label: 'Cta 3355 · Luis (ahorros)' },
  { value: '4549', label: 'Cta 4549 · Luis/DCDG' },
  { value: '3164', label: 'Cta 3164 · Carolina (Sebas)' },
  { value: '5688', label: 'Cta 5688 · Carolina (Ahinoa)' },
];
