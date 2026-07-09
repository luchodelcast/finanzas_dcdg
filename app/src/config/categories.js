/**
 * config/categories.js — Taxonomía de categorías/subcategorías DCDG.
 *
 * Portado 1:1 del objeto `CATS` del monolito DCDG_Captura_v5.html. Alimenta los
 * selects de la pantalla de confirmación y valida la salida del clasificador.
 */

// Taxonomía completa DCDG, alineada con el Excel maestro (Presupuesto + Pagos
// Fijos + Registro de Gastos). Es la ÚNICA fuente de verdad: la usa el
// desplegable del formulario Y el clasificador (config/prompt.js la enumera),
// para que formulario y clasificación no se desalineen.
export const CATS = {
  'Alimentación': ['Mercado', 'Restaurante', 'Domicilios'],
  'Servicios Públicos': ['Agua', 'Gas', 'Energía', 'Internet', 'Telefonía', 'Aseo/Basuras'],
  'Vivienda': ['Arriendo', 'Administración', 'Reparaciones y mantenimiento'],
  'Transporte': ['Uber/Taxi', 'Gasolina/EDS', 'Vehículos/Lavado', 'SOAT Vehículo', 'Parqueadero', 'Peajes', 'Bus/Metro'],
  'Salud': ['Salud: Medicamentos', 'Salud: Citas Médicas', 'Salud: Otros'],
  'Seguros y Medicina Prepagada': ['Medicina Prepagada', 'Plan Complementario', 'Seguro Vehículo', 'Otros seguros'],
  'Educación': ['Colegio', 'Extracurriculares', 'Útiles y materiales'],
  'Gastos Luhijo - Luciano': ['Meriendas y Almuerzos Colegio', 'Actividades', 'Otros hijos'],
  'Entretenimiento': ['Suscripciones Online', 'Ocio y entretenimiento', 'Actividades niños'],
  'Ropa': ['Ropa adultos', 'Ropa niños', 'Calzado'],
  'Hogar/Aseo': ['Artículos del hogar', 'Productos de aseo'],
  'Regalos y celebraciones': ['Regalo', 'Celebración'],
  'Viajes': ['Tiquetes', 'Hotel', 'Gastos en viaje'],
  'Créditos y Tarjetas': ['Pago crédito bancario', 'Pago tarjeta de crédito'],
  'Gastos Bancarios': ['4x1000', 'Cuota manejo', 'Comisiones'],
  'Personal LADCC': ['Gastos Personales LADCC'],
  'Personal CMDG': ['Gastos Personales CMDG'],
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
