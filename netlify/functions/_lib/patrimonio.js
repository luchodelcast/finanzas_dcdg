/**
 * _lib/patrimonio.js — Patrimonio individual (issue #115, Contab. familiar C).
 *
 * Balance General (T7) ya soporta filtrar por `entidad_id`; esto agrega la
 * vista "por persona" (Luis / Carolina / Común / consolidado, usando el dueño
 * de #112) y la serie mensual del neto para la pantalla "Mi patrimonio" —
 * solo lectura sobre asientos existentes, sin esquema nuevo.
 */
import { balanceGeneral } from './estados.js';
import { listEntidades, entidadIdPorNombre, getUsuarioNombrePorEmail } from './repo.js';

/** Neto de un Balance General (activo − pasivo, ya con el resultado del ejercicio en patrimonio). */
function neto(bg) {
  return bg.totalActivo - bg.totalPasivo;
}

/**
 * Balance General por persona + "Común" (asientos sin dueño individual) +
 * consolidado (todo, como ya devuelve `balanceGeneral` sin filtro).
 * @param {{fecha?: string}} q
 */
export async function patrimonioPorPersona({ fecha } = {}, sqlArg) {
  const entidades = await listEntidades(sqlArg);
  const personasEntidad = entidades.filter((e) => e.tipo === 'persona');

  const personas = await Promise.all(personasEntidad.map(async (e) => {
    const bg = await balanceGeneral({ fecha, entidad_id: e.id }, sqlArg);
    return { entidad_id: e.id, entidad: e.nombre, ...bg, neto: neto(bg) };
  }));
  const comun = await balanceGeneral({ fecha, soloSinEntidad: true }, sqlArg);
  const consolidado = await balanceGeneral({ fecha }, sqlArg);

  return {
    personas,
    comun: { ...comun, neto: neto(comun) },
    consolidado: { ...consolidado, neto: neto(consolidado) },
  };
}

/** Fecha (YYYY-MM-DD) del último día del mes que es `mesesAtras` antes del mes de `fecha`. */
function finDeMesHaceMeses(fecha, mesesAtras) {
  const [anio, mes] = fecha.slice(0, 7).split('-').map(Number);
  // día 0 del mes siguiente al buscado = último día del mes buscado.
  const d = new Date(Date.UTC(anio, mes - 1 - mesesAtras + 1, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Serie mensual del patrimonio neto de una entidad (o "Común" si
 * `soloSinEntidad`), de más vieja a más reciente.
 * @param {{entidad_id?: number, soloSinEntidad?: boolean, meses?: number, fecha?: string}} q
 */
export async function evolucionPatrimonio({ entidad_id, soloSinEntidad, meses = 6, fecha } = {}, sqlArg) {
  const hoy = fecha || new Date().toISOString().slice(0, 10);
  const cantidad = Math.max(1, Number(meses) || 6);
  const cortes = Array.from({ length: cantidad }, (_, i) => finDeMesHaceMeses(hoy, cantidad - 1 - i));
  const serie = [];
  for (const corte of cortes) {
    const bg = await balanceGeneral({ fecha: corte, entidad_id, soloSinEntidad }, sqlArg);
    serie.push({ periodo: corte.slice(0, 7), fecha: corte, neto: neto(bg) });
  }
  return serie;
}

/**
 * "Mi patrimonio": resuelve la persona (Luis/Carolina) del email de la sesión
 * vía `usuarios.nombre` y devuelve su neto + evolución mensual. Si el email no
 * está asociado a una persona (p. ej. un rol de contador/tesorería), degrada
 * con gracia al consolidado familiar en vez de fallar.
 * @param {{email: string, meses?: number, fecha?: string}} q
 */
export async function miPatrimonio({ email, meses = 6, fecha } = {}, sqlArg) {
  const nombre = await getUsuarioNombrePorEmail(email, sqlArg);
  const entidad_id = nombre ? await entidadIdPorNombre(nombre, sqlArg) : null;
  const persona = entidad_id ? nombre : null;
  const bg = await balanceGeneral({ fecha, entidad_id: entidad_id || undefined }, sqlArg);
  const evolucion = await evolucionPatrimonio({ entidad_id: entidad_id || undefined, meses, fecha }, sqlArg);
  return {
    persona,
    balance: { ...bg, neto: neto(bg) },
    evolucion,
    nota: persona ? null : 'Tu usuario no está asociado a Luis/Carolina — se muestra el patrimonio consolidado.',
  };
}
