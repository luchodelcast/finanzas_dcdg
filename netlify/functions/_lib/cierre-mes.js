/**
 * _lib/cierre-mes.js — "Cierre del mes" (issue #118, Contab. familiar G):
 * ritual mensual de revisión de la pareja. Solo lectura: consolida en una
 * pantalla lo que otros módulos ya calculan (aportes al fondo común #113,
 * patrimonio por persona #115, metas #117 si ya está disponible) más un
 * comparativo simple contra el mes anterior. No recalcula la contabilidad.
 */
import { reporteAportesHogar } from './aportes-hogar.js';
import { patrimonioPorPersona, evolucionPatrimonio } from './patrimonio.js';
import { rangoPeriodo } from './finanzas.js';
import { formatCOP } from '../../../app/src/utils/formatters.js';

/** 'YYYY-MM' del mes anterior al de `iso` (acepta 'YYYY-MM-DD' o 'YYYY-MM'). */
export function periodoAnteriorA(iso) {
  const [y, m] = String(iso).slice(0, 7).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Metas (#117) es opcional: si ese módulo todavía no está fusionado en main,
 * se omite con gracia en vez de romper el resto del ritual.
 */
async function intentarMetas() {
  try {
    const mod = await import('./metas.js');
    if (mod && typeof mod.listarMetasConProgreso === 'function') {
      return await mod.listarMetasConProgreso();
    }
  } catch (_) {
    // #117 aún no fusionado en main — el resumen sigue sin esa sección.
  }
  return null;
}

/**
 * Resumen consolidado del mes para la cita financiera mensual: ingresos y
 * aportes al fondo común por persona (con su cuota y % cumplido), patrimonio
 * de cada quien y su variación vs. el mes anterior, avance de metas si está
 * disponible, y el consolidado/Común de la familia.
 * @param {{periodo?: string, fecha?: string, hoy?: Date}} q
 */
export async function cierreDelMes({ periodo, fecha, hoy } = {}) {
  const hoyDate = hoy instanceof Date ? hoy : new Date();
  const { desde, hasta, etiqueta } = rangoPeriodo(periodo, hoyDate);
  const fechaCorte = fecha || hasta;
  const etiquetaAnterior = periodoAnteriorA(desde);

  const [actual, anterior, patrimonio, metas] = await Promise.all([
    reporteAportesHogar({ periodo: periodo || 'mes', hoy: hoyDate }),
    reporteAportesHogar({ periodo: etiquetaAnterior }),
    patrimonioPorPersona({ fecha: fechaCorte }),
    intentarMetas(),
  ]);

  const evoluciones = await Promise.all(
    patrimonio.personas.map((p) => evolucionPatrimonio({ entidad_id: p.entidad_id, meses: 2, fecha: fechaCorte })),
  );

  const por_persona = actual.por_persona.map((c) => {
    const prev = anterior.por_persona.find((p) => p.entidad_id === c.entidad_id) || null;
    const idx = patrimonio.personas.findIndex((p) => p.entidad_id === c.entidad_id);
    const serie = idx >= 0 ? evoluciones[idx] : [];
    const patrimonioNeto = idx >= 0 ? patrimonio.personas[idx].neto : null;
    const patrimonioAnterior = serie.length > 1 ? serie[serie.length - 2].neto : null;
    const variacion = (patrimonioNeto != null && patrimonioAnterior != null)
      ? patrimonioNeto - patrimonioAnterior
      : null;
    return {
      entidad_id: c.entidad_id,
      entidad: c.entidad,
      ingreso: c.ingreso,
      ingreso_fmt: c.ingreso_fmt,
      ingreso_anterior: prev ? prev.ingreso : null,
      aportado: c.aportado,
      aportado_fmt: c.aportado_fmt,
      aportado_anterior: prev ? prev.aportado : null,
      cuota_sugerida: c.cuota_sugerida,
      cuota_sugerida_fmt: c.cuota_sugerida_fmt,
      pct_cumplido: c.pct_cumplido,
      patrimonio_neto: patrimonioNeto,
      patrimonio_neto_fmt: patrimonioNeto != null ? formatCOP(patrimonioNeto) : null,
      patrimonio_neto_anterior: patrimonioAnterior,
      variacion_patrimonio: variacion,
      variacion_patrimonio_fmt: variacion != null ? formatCOP(variacion) : null,
    };
  });

  return {
    ok: true,
    periodo: etiqueta,
    periodo_anterior: etiquetaAnterior,
    desde,
    hasta,
    fecha_corte: fechaCorte,
    por_persona,
    comun: patrimonio.comun,
    consolidado: patrimonio.consolidado,
    metas,
    nota: metas ? null : 'Las metas (issue #117) todavía no están disponibles — se omiten en este resumen.',
  };
}

/** Arma el texto del resumen para WhatsApp (puro, sin red) a partir de `cierreDelMes()`. */
export function armarResumenTexto(cierre) {
  const linea = (p) => `${p.entidad}: ingreso ${p.ingreso_fmt}, aportó ${p.aportado_fmt}`
    + (p.pct_cumplido != null ? ` (${p.pct_cumplido}% de su cuota)` : '')
    + (p.patrimonio_neto_fmt ? `, patrimonio ${p.patrimonio_neto_fmt}` : '');
  const partes = [
    `🗓️ Cierre del mes (${cierre.periodo})`,
    ...cierre.por_persona.map(linea),
  ];
  const listaMetas = Array.isArray(cierre.metas) ? cierre.metas : (cierre.metas && cierre.metas.metas);
  if (Array.isArray(listaMetas) && listaMetas.length) {
    partes.push(`Metas: ${listaMetas.length} en seguimiento.`);
  }
  return partes.join('\n');
}
