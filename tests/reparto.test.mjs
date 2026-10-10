// Repartidores con usuario: qué ve cada rol en Pedidos y cómo se asigna un delivery
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, withMenu } from './helpers/load.mjs';

function setup(role = 'delivery') {
  const app = loadApp();
  withMenu(app.S);
  app.S.ctx.members = [
    { user_id: 'u-lucas', name: 'Lucas', username: 'del.lucas', role: 'delivery', active: true, branch_ids: ['br-1'] },
    { user_id: 'u-ana', name: 'Ana', username: 'del.ana', role: 'delivery', active: true, branch_ids: [] },
    { user_id: 'u-otra', name: 'Otra', username: 'del.otra', role: 'delivery', active: true, branch_ids: ['br-9'] },
    { user_id: 'u-baja', name: 'Baja', username: 'del.baja', role: 'delivery', active: false, branch_ids: [] },
    { user_id: 'u-caja', name: 'Caja', username: 'caja', role: 'cajero', active: true, branch_ids: [] },
  ];
  app.S.afterLoad();
  app.PZ.auth.current = { id: 'u-lucas', name: 'Lucas', username: 'del.lucas', role, branchIds: ['br-1'], orgId: 'org-1' };
  return app;
}
const o = (extra) => ({ type: 'delivery', ...extra });

test('los repartidores de la sucursal son los empleados activos con rol Delivery', () => {
  const { S } = setup();
  assert.deepEqual(S.drivers().map((d) => d.name), ['Lucas', 'Ana']);
});

test('el repartidor ve sus entregas y las sin asignar, y no las de otro', () => {
  const { PZ } = setup();
  const A = PZ.auth;
  assert.ok(A.sees(o({ driverId: 'u-lucas' })), 'asignado a él');
  assert.ok(A.sees(o({})), 'sin asignar');
  assert.ok(A.sees(o({ driver: 'lucas' })), 'pedido viejo con su nombre');
  assert.ok(!A.sees(o({ driverId: 'u-ana', driver: 'Ana' })), 'de otro repartidor');
  assert.ok(!A.sees(o({ driver: 'Ana' })), 'viejo con el nombre de otro');
  assert.ok(!A.sees({ type: 'mostrador' }), 'no es delivery');
  assert.ok(!A.sees({ type: 'mesa' }), 'no es delivery');
});

test('el mozo ve solo las mesas y los demás roles ven todo', () => {
  const mozo = setup('mozo').PZ.auth;
  assert.ok(mozo.sees({ type: 'mesa' }));
  assert.ok(!mozo.sees(o({})));
  const caja = setup('cajero').PZ.auth;
  assert.ok(caja.sees(o({ driverId: 'u-ana' })) && caja.sees({ type: 'mesa' }));
});

test('un delivery se crea con el repartidor asignado (id y nombre)', () => {
  const { S } = setup('cajero');
  const item = S.makeItem({ product: S.product('p-muz'), variant: S.product('p-muz').variants[0] });
  const asignado = S.createOrder({ type: 'delivery', items: [item], address: 'X 1', driverId: 'u-ana', driver: 'Ana' });
  assert.equal(asignado.driverId, 'u-ana');
  assert.equal(asignado.driver, 'Ana');
  const libre = S.createOrder({ type: 'delivery', items: [item], address: 'X 2' });
  assert.equal('driverId' in libre, false, 'sin asignar no agrega el campo');
  assert.equal(libre.driver, '');
});
