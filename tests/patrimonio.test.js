import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  patrimonioPorPersona, evolucionPatrimonio, miPatrimonio,
} from '../netlify/functions/_lib/patrimonio.js';
import { resetUsuariosSchemaParaTests } from '../netlify/functions/_lib/repo.js';

/**
 * Fake mínimo de Postgres: entidades (Luis=1, Carolina=2), usuarios
 * (luis@iwin.im → Luis) y un plan de cuentas + asientos con/sin `entidad_id`
 * (para simular el bolsillo "Común", #112).
 */
function fakeDb() {
  const entidades = [
    { id: 1, nombre: 'Luis', tipo: 'persona', pais: 'CO', moneda: 'COP' },
    { id: 2, nombre: 'Carolina', tipo: 'persona', pais: 'CO', moneda: 'COP' },
  ];
  const usuarios = [{ email: 'luis@iwin.im', nombre: 'Luis', rol: 'owner', activo: true }];
  const plan = [
    { codigo: '1110', nombre: 'Bancos y billeteras', clase: 1, naturaleza: 'debito' },
    { codigo: '3105', nombre: 'Capital / saldo inicial', clase: 3, naturaleza: 'credito' },
  ];
  // Apertura Luis (entidad_id 1): 1.000.000. Apertura Carolina (entidad_id 2): 500.000.
  // Aporte al fondo común (entidad_id null, bolsillo "Común"): 200.000.
  const lineas = [
    { fecha: '2026-01-01', entidad_id: 1, cuenta: '1110', debito: 1000000, credito: 0 },
    { fecha: '2026-01-01', entidad_id: 1, cuenta: '3105', debito: 0, credito: 1000000 },
    { fecha: '2026-01-01', entidad_id: 2, cuenta: '1110', debito: 500000, credito: 0 },
    { fecha: '2026-01-01', entidad_id: 2, cuenta: '3105', debito: 0, credito: 500000 },
    { fecha: '2026-01-01', entidad_id: null, cuenta: '1110', debito: 200000, credito: 0 },
    { fecha: '2026-01-01', entidad_id: null, cuenta: '3105', debito: 0, credito: 200000 },
  ];

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.startsWith('create table') || t.startsWith('create index') || t.startsWith('insert into usuarios')) return [];
    if (t.includes('from entidades where lower(nombre)')) {
      const nombre = String(params[0] || '').toLowerCase();
      const e = entidades.find((x) => x.nombre.toLowerCase() === nombre);
      return e ? [{ id: e.id }] : [];
    }
    if (t.startsWith('select id, nombre, tipo, pais, moneda from entidades')) {
      return entidades;
    }
    if (t.includes('select nombre from usuarios')) {
      const correo = String(params[0] || '').toLowerCase();
      const u = usuarios.find((x) => x.email.toLowerCase() === correo && x.activo);
      return u ? [{ nombre: u.nombre }] : [];
    }
    if (t.includes('group by p.codigo, p.nombre, p.clase, p.naturaleza')) {
      let filas = lineas;
      let pi = 0;
      if (t.includes('a.fecha >= $')) { const desde = params[pi++]; filas = filas.filter((l) => l.fecha >= desde); }
      if (t.includes('a.fecha <= $')) { const hasta = params[pi++]; filas = filas.filter((l) => l.fecha <= hasta); }
      if (t.includes('a.entidad_id is null')) { filas = filas.filter((l) => l.entidad_id == null); }
      else if (t.includes('a.entidad_id = $')) { const eid = params[pi++]; filas = filas.filter((l) => l.entidad_id === eid); }
      const totales = new Map();
      for (const l of filas) {
        const cur = totales.get(l.cuenta) || { debito: 0, credito: 0 };
        cur.debito += l.debito; cur.credito += l.credito;
        totales.set(l.cuenta, cur);
      }
      return plan.map((p) => ({ ...p, ...(totales.get(p.codigo) || { debito: 0, credito: 0 }) }));
    }
    return [];
  }
  return { query };
}

test('patrimonioPorPersona: Luis, Carolina, Común y consolidado se calculan por separado', async () => {
  const db = fakeDb();
  const r = await patrimonioPorPersona({ fecha: '2026-01-31' }, db);
  const luis = r.personas.find((p) => p.entidad === 'Luis');
  const caro = r.personas.find((p) => p.entidad === 'Carolina');
  assert.equal(luis.neto, 1000000);
  assert.equal(caro.neto, 500000);
  assert.equal(r.comun.neto, 200000);
  assert.equal(r.consolidado.neto, 1700000); // suma de las tres patas
});

test('evolucionPatrimonio: serie mensual del neto de una entidad, de más vieja a más reciente', async () => {
  const db = fakeDb();
  const serie = await evolucionPatrimonio({ entidad_id: 1, meses: 3, fecha: '2026-03-15' }, db);
  assert.equal(serie.length, 3);
  assert.deepEqual(serie.map((s) => s.periodo), ['2026-01', '2026-02', '2026-03']);
  // La apertura de Luis es de enero → el neto ya está completo desde el primer corte.
  assert.ok(serie.every((s) => s.neto === 1000000));
});

test('miPatrimonio: resuelve la persona del email vía usuarios.nombre', async () => {
  resetUsuariosSchemaParaTests();
  const db = fakeDb();
  const r = await miPatrimonio({ email: 'luis@iwin.im', meses: 2, fecha: '2026-01-31' }, db);
  assert.equal(r.persona, 'Luis');
  assert.equal(r.balance.neto, 1000000);
  assert.equal(r.nota, null);
  assert.equal(r.evolucion.length, 2);
  resetUsuariosSchemaParaTests();
});

test('miPatrimonio: email sin persona asociada degrada al consolidado, sin fallar', async () => {
  resetUsuariosSchemaParaTests();
  const db = fakeDb();
  const r = await miPatrimonio({ email: 'santiago@iwin.im', fecha: '2026-01-31' }, db);
  assert.equal(r.persona, null);
  assert.equal(r.balance.neto, 1700000); // consolidado, sin filtrar por entidad
  assert.match(r.nota, /consolidado/);
  resetUsuariosSchemaParaTests();
});
