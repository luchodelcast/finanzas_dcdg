import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metodoDeCuenta, movimientoGastoDesdeTx, capturarCorreo } from '../netlify/functions/_lib/captura-correo.js';

const banco = (body) => ({ from: 'alertasynotificaciones@an.notificacionesbancolombia.com', subject: 'Alertas y Notificaciones', body });

test('metodoDeCuenta: mapea últimos 4 a etiqueta legible', () => {
  assert.match(metodoDeCuenta('0965'), /0965.*Luis/);
  assert.match(metodoDeCuenta('5688'), /5688.*Carolina/);
  assert.equal(metodoDeCuenta('9999'), 'Bcol *9999'); // desconocida
  assert.equal(metodoDeCuenta(null), 'Bancolombia');
});

test('movimientoGastoDesdeTx: arma el gasto con idempotencia por message-id', () => {
  const tx = { clase: 'gasto', monto: 100000, moneda: 'COP', comercio: 'EDS LA CASTELLANA', cuenta: '4550', dueno: 'Carolina', fecha: '2026-07-18' };
  const mov = movimientoGastoDesdeTx(tx, 'ABC123');
  assert.equal(mov.tipo, 'gasto');
  assert.equal(mov.monto, 100000);
  assert.equal(mov.descripcion, 'EDS LA CASTELLANA');
  assert.equal(mov.quien_pago, 'Carolina');
  assert.equal(mov.fecha, '2026-07-18');
  assert.equal(mov.idempotency_key, 'email:ABC123');
  assert.match(mov.metodo_pago, /4550/);
  assert.equal(mov.origen, 'CorreoBanco');
  assert.equal(mov.categoria, undefined); // sin hint → registrarMovimiento clasifica
});

test('movimientoGastoDesdeTx: respeta categoría/subcategoría si se pasan', () => {
  const tx = { clase: 'gasto', monto: 17000, comercio: 'NARCOBOLLO', cuenta: '2331', dueno: 'Luis', fecha: '2026-07-12' };
  const mov = movimientoGastoDesdeTx(tx, 'M2', { categoria: 'Alimentación', subcategoria: 'Restaurante' });
  assert.equal(mov.categoria, 'Alimentación');
  assert.equal(mov.subcategoria, 'Restaurante');
});

test('capturarCorreo: ruido/seguridad → no registra (skip)', async () => {
  const r = await capturarCorreo({ message_id: 'X1', ...banco('Bancolombia te comparte el codigo OTP 408558 para completar tu accion.') });
  assert.equal(r.registrado, false);
  assert.equal(r.skip, 'ruido/seguridad');
});

test('capturarCorreo: PSE de iWin (5401) → no registra (skip iWin)', async () => {
  const r = await capturarCorreo({ message_id: 'X2', ...banco('Pagaste $37804000.00 por PSE a DIAN PSE desde tu producto *5401 el 21/07/2026 a las 09:38.') });
  assert.equal(r.registrado, false);
  assert.match(r.skip, /iWin/);
});

test('capturarCorreo: ingreso → queda pendiente para la rutina (Ahinoa/ruteo)', async () => {
  const r = await capturarCorreo({ message_id: 'X3', ...banco('Carolina, recibiste una transferencia de CINDY LORENA CHAVARRIA PEREZ por $730000.00 en tu cuenta *5688 conectada a la llave @granados5675 el 14/07/2026') });
  assert.equal(r.registrado, false);
  assert.equal(r.pendiente, 'ingreso');
  assert.equal(r.tx.ahinoa, true);
});

test('capturarCorreo: transferencia → pendiente (colapso/ruteo lo hace la rutina)', async () => {
  const r = await capturarCorreo({ message_id: 'X4', ...banco('Transferiste $33200.00 desde tu cuenta 0965 a la cuenta *3004694463 el 15/07/2026 a las 11:47.') });
  assert.equal(r.registrado, false);
  assert.equal(r.pendiente, 'transferencia');
});

test('capturarCorreo: exige message_id (idempotencia)', async () => {
  await assert.rejects(() => capturarCorreo({ ...banco('Compraste $10.000 en X con tu T.Deb *2331, el 01/07/2026 a las 10:00.') }), /message_id/);
});
