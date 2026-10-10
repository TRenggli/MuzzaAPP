// Delivery en efectivo que cobra el repartidor: el pedido queda "a cobrar" y el
// comprobante le dice cuánto cobrar y qué vuelto llevar, sin datos de transferencia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadApp, withMenu } from './helpers/load.mjs';

function setup() {
  const app = loadApp();
  withMenu(app.S);
  app.localStorage.setItem('pz-pool-br-1', JSON.stringify({ order: [[100, 199]], ticket: [[500, 599]] }));
  // el módulo de comprobantes (sin navegador: solo necesita poder agregar sus estilos)
  app.ctx.document = { createElement: () => ({}), head: { appendChild() {} } };
  vm.runInContext(fs.readFileSync(new URL('../js/ticket.js', import.meta.url), 'utf8'), app.ctx, { filename: 'js/ticket.js' });
  Object.assign(app.S.data.settings.payments, { alias: 'pizzeria.test', cbu: '0000003100000000000001', holder: 'Pizzería Test' });
  app.S.data.settings.ticket.showLogo = false;
  app.S.rebuildShadow();
  return { ...app, T: app.PZ.ticket };
}
const item = (S, id = 'p-muz', v = 'grande', qty = 1) => S.makeItem({ product: S.product(id), variant: S.product(id).variants.find((x) => x.id === v), qty });
const delivery = (S, extra = {}) => ({ type: 'delivery', items: [item(S)], customerName: 'Juan', phone: '3415550000', address: 'San Martín 123', deliveryFee: 500, ...extra });

test('el delivery que cobra el repartidor queda a cobrar, con el monto y el vuelto anotados', () => {
  const { S, T } = setup();
  const o = S.createOrder(delivery(S, { collect: { method: 'efectivo', amount: 10500, tendered: 20000 } }));
  assert.equal(o.paid, false, 'no entra a la caja hasta que el repartidor rinde');
  assert.equal(o.total, 10500);
  assert.deepEqual({ ...o.collect }, { method: 'efectivo', amount: 10500, tendered: 20000 });
  const cash = T.collectOf(o);
  assert.equal(cash.amount, 10500);
  assert.equal(cash.change, 9500);
  assert.equal(cash.discount, 0);
});

test('el comprobante del repartidor dice cuánto cobrar y el vuelto, sin datos de transferencia', () => {
  const { S, T, U } = setup();
  const o = S.createOrder(delivery(S, { collect: { method: 'efectivo', amount: 10500, tendered: 20000 } }));
  const html = T.customerHTML(o);
  assert.match(html, /A COBRAR/);
  assert.match(html, /COBRAR EN EFECTIVO/);
  assert.ok(html.includes(U.money(20000)), 'con cuánto paga');
  assert.match(html, /LLEVAR DE VUELTO/);
  assert.ok(html.includes(U.money(9500)), 'el vuelto que lleva');
  assert.doesNotMatch(html, /Podés pagar por transferencia/);
  assert.doesNotMatch(html, /pizzeria\.test/, 'no muestra el alias');

  const text = T.plainText(o);
  assert.match(text, /efectivo al recibir/);
  assert.doesNotMatch(text, /alias/);
  assert.match(T.kitchenHTML(o), /EN EFECTIVO/);
});

test('un pedido a cobrar sin repartidor sigue mostrando los datos de transferencia', () => {
  const { S, T } = setup();
  const o = S.createOrder(delivery(S));
  assert.equal(T.collectOf(o), null);
  assert.match(T.customerHTML(o), /Podés pagar por transferencia/);
});

test('si paga justo no hay vuelto, y el descuento por efectivo se ve en el papel', () => {
  const { S, T, U } = setup();
  const justo = S.createOrder(delivery(S, { collect: { method: 'efectivo', amount: 10500, tendered: 10500 } }));
  assert.match(T.customerHTML(justo), /Paga justo, sin vuelto/);
  assert.doesNotMatch(T.customerHTML(justo), /LLEVAR DE VUELTO/);

  // 10% de descuento pagando en efectivo: el repartidor cobra 9.450
  const conDesc = S.createOrder(delivery(S, { collect: { method: 'efectivo', amount: 9450, tendered: 10000 } }));
  const cash = T.collectOf(conDesc);
  assert.equal(cash.discount, 1050);
  assert.equal(cash.change, 550);
  const html = T.customerHTML(conDesc);
  assert.match(html, /Desc\. pago en efectivo/);
  assert.ok(html.includes(U.money(9450)));
});

test('cuando el repartidor rinde la plata, se cobra y sale PAGADO', () => {
  const { S, T } = setup();
  S.openSession(0);
  const o = S.createOrder(delivery(S, { collect: { method: 'efectivo', amount: 10500, tendered: 20000 } }));
  S.payOrder(o.id, [{ method: 'efectivo', amount: 10500, tendered: 20000, change: 9500 }]);
  assert.equal(o.paid, true);
  assert.equal(T.collectOf(o), null, 'ya no está a cobrar');
  const html = T.customerHTML(o);
  assert.match(html, /PAGADO/);
  assert.doesNotMatch(html, /COBRAR EN EFECTIVO/);
  assert.equal(S.sessionSummary(S.currentSession()).byMethod.efectivo, 10500, 'entra a la caja recién ahora');
});

test('el pedido viaja a la nube con el dato de quién cobra', async () => {
  const { S, sent } = setup();
  const o = S.createOrder(delivery(S, { collect: { method: 'efectivo', amount: 10500, tendered: 20000 } }));
  S.diff();
  await S.flush();
  const row = sent.orders.filter((r) => r.id === o.id).pop();
  assert.ok(row, 'se envió el pedido');
  assert.deepEqual(row.data.collect, { method: 'efectivo', amount: 10500, tendered: 20000 });

  // desde Pedidos: un pedido que se guardó sin cobrar pasa a "lo cobra el repartidor"
  const later = S.createOrder(delivery(S));
  S.diff();
  await S.flush();
  later.collect = { method: 'efectivo', amount: 10500, tendered: 0 };
  S.diff();
  await S.flush();
  const row2 = sent.orders.filter((r) => r.id === later.id).pop();
  assert.deepEqual(row2.data.collect, { method: 'efectivo', amount: 10500, tendered: 0 });
});
