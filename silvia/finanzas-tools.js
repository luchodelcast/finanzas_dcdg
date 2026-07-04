/**
 * silvia/finanzas-tools.js — Tools DELGADAS para pegar en SilvIA (repo sl-crm-live).
 *
 * ⚠️ Este archivo NO corre en este repo. Es el snippet de referencia (Opción B del
 *    doc de integración) que se agrega a `netlify/functions/_lib/assistant.js` de
 *    SilvIA, dentro de `buildTools(...)`, gateado por `isFinanceUser`.
 *
 * La lógica financiera vive en dcdg-finanzas (este repo) detrás de su API. Estas
 * tools solo hacen HTTP con el token de servicio. Requiere en el env de SilvIA:
 *   - DCDG_API_URL    (p.ej. https://dcdg-finanzas.netlify.app)
 *   - DCDG_API_TOKEN  (igual al de dcdg-finanzas)
 *   - FINANZAS_USERS  (luis@iwin.im,carodz2@gmail.com)
 *
 * Uso dentro de buildTools(who, ...):
 *   import { buildFinanzasTools } from './finanzas-tools.js'; // adaptar ruta
 *   ...(isFinanceUser(who.username) ? buildFinanzasTools({ who, betaZodTool, z }) : [])
 */

/**
 * @param {Object} deps
 * @param {{ username: string, name?: string }} deps.who  usuario resuelto por teléfono
 * @param {Function} deps.betaZodTool  helper de SilvIA (client.beta ... zod tool)
 * @param {Object} deps.z              zod importado en SilvIA
 */
export function buildFinanzasTools({ who, betaZodTool, z }) {
  const API = String(process.env.DCDG_API_URL || '').replace(/\/$/, '');
  const TOKEN = process.env.DCDG_API_TOKEN || '';

  async function call(path, { method = 'POST', body, query } = {}) {
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const res = await fetch(`${API}${path}${qs}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-dcdg-user': who.username, // el backend valida contra FINANZAS_USERS
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `DCDG API ${res.status}`);
    return data;
  }

  const movimientoSchema = z.object({
    monto: z.union([z.number(), z.string()]),
    descripcion: z.string(),
    quien_pago: z.enum(['Luis', 'Carolina']).optional(),
    metodo_pago: z.string().optional(),
    fecha: z.string().optional(),
    categoria: z.string().optional(),
    subcategoria: z.string().optional(),
    tarjeta_ultimos4: z.string().optional(),
    notas: z.string().optional(),
  });

  return [
    betaZodTool({
      name: 'registrar_gasto',
      description:
        'Registra un GASTO familiar DCDG. Úsalo cuando Luis o Carolina digan "gasté X en Y", ' +
        '"pagué el mercado", "anota…". Clasifica con reglas DCDG. Confirma categoría, monto y cuenta.',
      inputSchema: movimientoSchema,
      run: async (a) => call('/api/registrar-gasto', { body: a }),
    }),
    betaZodTool({
      name: 'registrar_pago',
      description:
        'Registra el PAGO de una obligación (servicios públicos, tarjeta de crédito, cuota, arriendo). ' +
        'Úsalo cuando digan "pagué la luz", "aboné a la tarjeta", "pagué la cuota del carro".',
      inputSchema: movimientoSchema,
      run: async (a) => call('/api/registrar-pago', { body: a }),
    }),
    betaZodTool({
      name: 'registrar_factura',
      description:
        'Registra una FACTURA recibida / cuenta por pagar. Úsalo cuando digan ' +
        '"llegó la factura de X por Y", "me facturaron…".',
      inputSchema: movimientoSchema,
      run: async (a) => call('/api/registrar-factura', { body: a }),
    }),
    betaZodTool({
      name: 'consultar_finanzas',
      description:
        'Responde "¿cuánto llevamos gastado este mes?", "¿en qué se nos fue la plata?", ' +
        '"gastos de mercado de julio". Devuelve totales y desglose por categoría.',
      inputSchema: z.object({
        periodo: z.string().optional(), // mes | semana | YYYY-MM | YYYY-MM-DD..YYYY-MM-DD
        categoria: z.string().optional(),
        quien: z.string().optional(),
      }),
      run: async (a) => call('/api/resumen', { method: 'POST', body: a }),
    }),
  ];
}
