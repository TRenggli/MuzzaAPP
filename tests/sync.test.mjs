// Motor de sincronización: qué se manda a la nube y cómo se combinan cambios
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/load.mjs';
import { withMenu } from './helpers/load.mjs';

function setup() {
  const app = loadApp();
  app.S.rebuildShadow();
  return app;
}

test('un registro nuevo se envía completo, con el id remoto de la sucursal', async () => {
  const { S, sent } = setup();
  S.data.customers.push({ id: 'cl-1', name: 'María', phone: '11 4455-6677' });
  S.diff();
  await S.flush();
  assert.equal(sent.docs.length, 1);
  assert.equal(sent.docs[0].col, 'customer');
  assert.equal(sent.docs[0].id, 'br-1/cl-1', 'los datos de sucursal llevan la sucursal en el id');
  assert.equal(sent.docs[0].data.name, 'María');
});

test('al modificar se envía solo el campo que cambió', async () => {
  const { S, sent } = setup();
  S.data.customers.push({ id: 'cl-1', name: 'María', phone: '111', notes: '' });
  S.diff();
  await S.flush();
  sent.docs.length = 0;
  S.data.customers[0].notes = 'Timbre no anda';
  S.diff();
  await S.flush();
  assert.equal(sent.docs.length, 1);
  assert.deepEqual(Object.keys(sent.docs[0].data), ['notes']);
});

test('varios cambios antes de enviar se juntan en uno', async () => {
  const { S, sent } = setup();
  S.data.customers.push({ id: 'cl-1', name: 'María' });
  S.diff();
  S.data.customers[0].phone = '222';
  S.diff();
  await S.flush();
  assert.equal(sent.docs.length, 1);
  assert.equal(sent.docs[0].data.name, 'María');
  assert.equal(sent.docs[0].data.phone, '222');
});

test('borrar un cliente borra en la nube; las ventas nunca se borran', async () => {
  const { S, sent } = setup();
  S.data.customers.push({ id: 'cl-1', name: 'María' });
  S.data.orders.push({ id: 'o-1', createdAt: Date.now(), items: [], total: 0 });
  S.diff();
  await S.flush();
  S.data.customers = [];
  S.data.orders = [];
  S.diff();
  await S.flush();
  assert.deepEqual(sent.deletes, [{ col: 'customer', id: 'br-1/cl-1' }]);
});

test('cambios de configuración van a la sucursal', async () => {
  const { S, sent } = setup();
  S.data.settings.ticket.width = 58;
  S.diff();
  await S.flush();
  assert.equal(sent.settings.length, 1);
  assert.equal(sent.settings[0].ticket.width, 58);
});

test('sin internet los cambios quedan en cola y se envían después', async () => {
  const { S, sent, setOnline } = setup();
  setOnline(false);
  S.data.customers.push({ id: 'cl-1', name: 'María' });
  S.diff();
  await S.flush();
  assert.equal(sent.docs.length, 0);
  assert.equal(S.status.pending, 1);
  setOnline(true);
  await S.flush();
  assert.equal(sent.docs.length, 1);
  assert.equal(S.status.pending, 0);
});

test('un corte a mitad del envío no pierde datos (se reintenta)', async () => {
  const { S, PZ, sent } = setup();
  S.data.customers.push({ id: 'cl-1', name: 'María' });
  S.diff();
  PZ.cloud.fail = new TypeError('Failed to fetch');
  await S.flush();
  assert.equal(S.status.pending, 1, 'sigue en la cola');
  assert.equal(S.status.state, 'retry');
  await S.flush();
  assert.equal(sent.docs.length, 1);
  assert.equal(S.status.pending, 0);
});

test('un rechazo permanente queda recuperable y no descarta otra operación del lote', async () => {
  const { S, PZ, sent } = setup();
  S.refresh = async () => {};
  S.data.customers.push({ id: 'cl-1', name: 'María' });
  S.data.orders.push({ id: 'o-1', createdAt: Date.now(), items: [], total: 0 });
  S.diff();
  PZ.cloud.fail = Object.assign(new Error('La venta ya está cobrada'), { code: 'P0001' });
  await S.flush();
  assert.equal(S.status.pending, 0);
  assert.equal(S.status.state, 'error');
  assert.equal(S.conflicts().length, 1, 'el cambio rechazado se conserva para revisión');
  assert.equal(sent.orders.length, 1, 'la venta válida del mismo lote sí llegó al servidor');
});

test('un cambio de otro equipo se aplica sin pisar lo que falta enviar', async () => {
  const { S, setOnline } = setup();
  // el pedido ya está en la nube
  S.data.orders.push({ id: 'o-1', createdAt: 1, status: 'pendiente', paid: false, items: [] });
  S.diff();
  await S.flush();
  // se corta internet y en esta caja se agrega una nota (queda sin enviar)
  setOnline(false);
  const o = S.data.orders[0];
  o.notes = 'sin sal';
  S.diff();
  // mientras tanto la cocina lo pasó al horno desde otra tablet
  S.onRemote('orders', { eventType: 'UPDATE', new: { id: 'o-1', branch_id: 'br-1', data: { id: 'o-1', createdAt: 1, status: 'horno', paid: false, items: [] } }, old: {} });
  assert.equal(o.status, 'horno', 'llegó el cambio de la cocina');
  assert.equal(o.notes, 'sin sal', 'se conservó la nota local');
  assert.equal(S.data.orders.length, 1, 'se actualizó el mismo objeto, no se duplicó');
  assert.equal(S.status.pending, 1, 'la nota sigue esperando para enviarse');
});

test('los cambios de otra sucursal se ignoran', () => {
  const { S } = setup();
  S.onRemote('orders', { eventType: 'INSERT', new: { id: 'o-9', branch_id: 'br-OTRA', data: { id: 'o-9', createdAt: 1 } }, old: {} });
  assert.equal(S.data.orders.length, 0);
});

test('el consumo de stock se manda como movimiento idempotente, no como saldo sobrescrito', async () => {
  const { S, sent } = setup();
  withMenu(S);
  S.rebuildShadow();
  const p = S.product('p-muz');
  S.createOrder({ type: 'mostrador', items: [S.makeItem({ product: p, variant: p.variants[0] })] });
  S.diff();
  await S.flush();
  assert.ok(sent.docs.some((r) => r.col === 'stock_move' && r.data.delta === -0.3));
  const ingredientWrites = sent.docs.filter((r) => r.col === 'ingredient');
  assert.ok(ingredientWrites.every((r) => !Object.hasOwn(r.data, 'stock')), 'el cliente no reescribe el saldo remoto');
});
