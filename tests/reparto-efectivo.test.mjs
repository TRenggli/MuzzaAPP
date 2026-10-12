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
const retiro = (S, extra = {}) => ({ type: 'retiro', items: [item(S)], customerName: 'Pedro', phone: '3415551111', ...extra });

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

test('los pedidos para retirar en el local muestran A COBRAR en el ticket y no PAGADO', () => {
  const { S, T, U } = setup();
  // Pedido para retirar que queda a cobrar en efectivo
  const o = S.createOrder(retiro(S, { collect: { method: 'efectivo', amount: 10000, tendered: 20000 } }));
  assert.equal(o.paid, false, 'no figura pagado hasta que el cliente retire y abone');
  assert.equal(o.type, 'retiro');
  const cash = T.collectOf(o);
  assert.equal(cash.amount, 10000);
  assert.equal(cash.change, 10000);

  const html = T.customerHTML(o);
  assert.match(html, /A COBRAR/, 'el sello del ticket debe decir A COBRAR');
  assert.doesNotMatch(html, /PAGADO/, 'no debe decir PAGADO');
  assert.match(html, /COBRAR EN EFECTIVO/);
  assert.ok(html.includes(U.money(20000)), 'monto con el que paga');
  assert.match(html, /TENER DE VUELTO/);
  assert.ok(html.includes(U.money(10000)), 'vuelto a tener listo');
  assert.match(html, /Para retirar/);
});

test('cuando el cliente retira el pedido y paga, el ticket pasa a PAGADO', () => {
  const { S, T } = setup();
  S.openSession(0);
  const o = S.createOrder(retiro(S, { collect: { method: 'efectivo', amount: 10000, tendered: 10000 } }));
  assert.equal(o.paid, false);
  assert.match(T.customerHTML(o), /A COBRAR/);

  // El cliente retira y paga
  S.payOrder(o.id, [{ method: 'efectivo', amount: 10000, tendered: 10000, change: 0 }]);
  assert.equal(o.paid, true);
  assert.equal(T.collectOf(o), null, 'ya no está a cobrar');

  const html = T.customerHTML(o);
  assert.match(html, /PAGADO/);
  assert.doesNotMatch(html, /A COBRAR/);
  assert.doesNotMatch(html, /COBRAR EN EFECTIVO/);
});

test('el buffer térmico ESC/POS para pedidos a cobrar de retiro incluye A COBRAR y TENER DE VUELTO', async () => {
  const { S, T } = setup();
  const o = S.createOrder(retiro(S, { collect: { method: 'efectivo', amount: 10000, tendered: 20000 } }));
  const bytes = await T.escpos.customer(o);
  const text = new TextDecoder('latin1').decode(bytes);
  assert.match(text, /COMPROBANTE DE PEDIDO/);
  assert.match(text, /COBRAR EN EFECTIVO/);
  assert.match(text, /TENER DE VUELTO/);
  assert.match(text, /A COBRAR/);
  // Comando de corte de papel al final
  assert.equal(bytes[bytes.length - 4], 0x1d);
  assert.equal(bytes[bytes.length - 3], 0x56);
  assert.equal(bytes[bytes.length - 2], 0x42);
});

test('un pedido web para retirar en efectivo al ser aceptado queda a cobrar con vuelto', async () => {
  const app = setup();
  const { S, T, ctx } = app;
  vm.runInContext(fs.readFileSync(new URL('../js/online.js', import.meta.url), 'utf8'), ctx, { filename: 'js/online.js' });
  ctx.PZ.modal = () => ({ el: { querySelector: () => ({ onclick: null }) }, close() {} });
  const item1 = item(S);
  ctx.PZ.cloud.acceptWebOrder = async (webId, orderId) => ({
    id: orderId, number: 201, createdAt: new Date().toISOString(), type: 'retiro',
    items: [item1], subtotal: 10000, total: 10000, customerName: 'Valen', phone: '1155551234',
    payments: [], paid: false,
  });
  const webOrder = {
    id: 'w-1', number: 1,
    data: { type: 'retiro', name: 'Valen', phone: '1155551234', payment: 'efectivo', cashWith: 15000, items: [] }
  };
  const o = await ctx.PZ.web.accept(webOrder);
  assert.equal(o.paid, false);
  assert.equal(o.type, 'retiro');
  assert.deepEqual({ ...o.collect }, { method: 'efectivo', amount: 10000, tendered: 15000 });
  const html = T.customerHTML(o);
  assert.match(html, /A COBRAR/);
  assert.match(html, /TENER DE VUELTO/);
});

test('un pedido para retirar puede quedar a cobrar con tarjeta / posnet', async () => {
  const { S, T } = setup();
  S.openSession(0);
  const o = S.createOrder(retiro(S, { collect: { method: 'tarjeta', cardType: 'débito', amount: 10000 } }));
  assert.equal(o.paid, false);
  assert.equal(T.collectOf(o).method, 'tarjeta');
  const html = T.customerHTML(o);
  assert.match(html, /A COBRAR/);
  assert.match(html, /COBRAR CON DÉBITO/);
  assert.doesNotMatch(html, /PAGADO/);

  // Buffer ESC/POS
  const bytes = await T.escpos.customer(o);
  const text = new TextDecoder('latin1').decode(bytes);
  assert.match(text, /A COBRAR/);
  assert.match(text, /COBRAR CON DEBITO/);

  // Cobro posterior cuando el cliente retira y pasa la tarjeta
  S.payOrder(o.id, [{ method: 'tarjeta', cardType: 'débito', amount: 10000 }]);
  assert.equal(o.paid, true);
  assert.equal(T.collectOf(o), null);
  assert.match(T.customerHTML(o), /PAGADO/);
});

test('un pedido para retirar puede quedar a cobrar por transferencia mostrando los datos bancarios', async () => {
  const { S, T } = setup();
  const o = S.createOrder(retiro(S, { collect: { method: 'transferencia', amount: 10000 } }));
  assert.equal(o.paid, false);
  const html = T.customerHTML(o);
  assert.match(html, /A COBRAR/);
  assert.match(html, /COBRAR POR TRANSFERENCIA/);
  assert.match(html, /Podés pagar por transferencia/);
  assert.match(html, /pizzeria\.test/);
});

