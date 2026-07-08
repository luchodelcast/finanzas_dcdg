import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OWNER_ONLY_SCREENS, esPantallaBloqueada } from '../app/src/config/roles.js';

test('esPantallaBloqueada: owner nunca queda bloqueado', () => {
  for (const pantalla of OWNER_ONLY_SCREENS) {
    assert.equal(esPantallaBloqueada(pantalla, true), false);
  }
});

test('esPantallaBloqueada: no-owner bloqueado en pantallas de captura/edición', () => {
  for (const pantalla of OWNER_ONLY_SCREENS) {
    assert.equal(esPantallaBloqueada(pantalla, false), true);
  }
});

test('esPantallaBloqueada: no-owner NO bloqueado en pantallas de solo lectura', () => {
  for (const pantalla of ['home', 'mayor', 'estados', 'exports', 'aportes', 'dash', 'settings']) {
    assert.equal(esPantallaBloqueada(pantalla, false), false);
  }
});
