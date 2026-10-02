// Salón: una mesa es UNA cuenta (varias tandas a la cocina, un solo cobro),
// en vivo entre varios equipos (mozos, caja) sin perder ni duplicar nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, withMenu } from './helpers/load.mjs';

function setup() {
  const app = loadApp();
  withMenu(app.S);
  app.localStorage.setItem('pz-pool-br-1', JSON.stringify({ order: [[100, 199]], ticket: [[500, 599]] }));
  app.S.ensureDining();
  app.S.rebuildShadow();
  return app;
}
const item = (S, id = 'p-muz', v = 'grande', qty = 1) => S.makeItem({ product: S.product(id), variant: S.product(id).variants.find((x) => x.id === v), qty });

/** Lo mismo que valida la base (orders_guard) al guardar una venta cobrada */
function guardOk(o) {
  const sub = o.items.reduce((a, i) => a + i.unitPrice * i.qty, 0);
  const total = sub - (o.discountAmount || 0) - (o.cashDiscount || 0) + (o.deliveryFee || 0) + (o.surcharge || 0);
  const pays = (o.payments || []).reduce((a, p) => a + p.amount, 0);
  return Math.abs(sub - o.subtotal) <= 1 && Math.abs(Math.max(total, 0) - o.total) <= 1 && (!o.paid || Math.abs(pays - o.total) <= 1);
}

test('dos tandas de la misma mesa son una sola cuenta y se cobran juntas con un solo comprobante', () => {
  const { S } = setup();
  S.openSession(0);
  const s = S.openTable('table-1', { guests: 2 });
  const muzza = S.addTableBatch(s.id, [item(S)]);
  const empanadas = S.addTableBatch(s.id, [item(S, 'p-esp', 'chica', 3)]);
  assert.equal(muzza.batchNumber, 1);
  assert.equal(empanadas.batchNumber, 2);
  assert.equal(muzza.tableSessionId, s.id);
  assert.equal(S.activeTableSession('table-1').id, s.id, 'la mesa sigue con la misma cuenta');
  assert.equal(S.tableBalance(s), 10000 + 27000);

  // pre-cuenta: todavía no es comprobante de pago
  const pre = S.tableBillOrder(s);
  assert.equal(pre.paid, false);
  assert.equal(pre.total, 37000);

  const bill = S.payTable(s.id, [{ method: 'efectivo', amount: 37000, tendered: 40000, change: 3000 }]);
  assert.equal(bill.paid, true, 'el comprobante de la mesa sale PAGADO');
  assert.equal(bill.total, 37000);
  assert.equal(bill.items.length, 2);
  assert.equal(bill.payments[0].tendered, 40000, 'el vuelto se calcula sobre el pago real');
  assert.ok(muzza.paid && empanadas.paid);
  assert.equal(muzza.ticketNumber, empanadas.ticketNumber, 'un solo número de comprobante');
  assert.ok([muzza, empanadas].every(guardOk), 'cada tanda cumple la regla del servidor');
  assert.equal(S.tableBalance(s), 0);
  assert.equal(S.activeTableSession('table-1'), null, 'la mesa queda libre');
  const sum = S.sessionSummary(S.currentSession());
  assert.equal(sum.tickets, 1, 'en la caja cuenta como un ticket');
  assert.equal(sum.sales, 37000);
  assert.equal(sum.byMethod.efectivo, 37000);
});

test('iguales de distintas tandas se suman en una línea del comprobante', () => {
  const { S } = setup();
  const s = S.openTable('table-2');
  S.addTableBatch(s.id, [item(S)]);
  S.addTableBatch(s.id, [item(S, 'p-muz', 'grande', 2)]);
  const pre = S.tableBillOrder(s);
  assert.equal(pre.items.length, 1);
  assert.equal(pre.items[0].qty, 3);
  assert.equal(pre.items[0].total, 30000);
});

test('descuento por efectivo y pago mixto se reparten entre las tandas sin romper los totales', () => {
  const { S } = setup();
  S.openSession(0);
  const s = S.openTable('table-3');
  const a = S.addTableBatch(s.id, [item(S)]);                       // 10.000
  const b = S.addTableBatch(s.id, [item(S, 'p-esp', 'grande')]);    // 14.000
  const c = S.addTableBatch(s.id, [item(S, 'p-esp', 'chica')]);     //  9.000
  // 10% de descuento por efectivo sobre 33.000 = 3.300 → paga 29.700 en dos medios
  S.payTable(s.id, [{ method: 'efectivo', amount: 9700, tendered: 10000 }, { method: 'transferencia', amount: 20000 }], { cashDiscount: 3300 });
  const orders = [a, b, c];
  assert.ok(orders.every(guardOk), 'subtotal, descuentos y pagos cierran en cada tanda');
  assert.equal(orders.reduce((x, o) => x + o.cashDiscount, 0), 3300);
  assert.equal(orders.reduce((x, o) => x + o.total, 0), 29700);
  const byMethod = S.sessionSummary(S.currentSession()).byMethod;
  assert.equal(byMethod.efectivo, 9700);
  assert.equal(byMethod.transferencia, 20000);
});

test('si los pagos no coinciden con el saldo no se cobra nada', () => {
  const { S } = setup();
  const s = S.openTable('table-4');
  const a = S.addTableBatch(s.id, [item(S)]);
  assert.throws(() => S.payTable(s.id, [{ method: 'efectivo', amount: 5000 }]), /no coinciden/);
  assert.equal(a.paid, false);
  assert.equal(S.tableBalance(s), 10000);
});

test('una tanda que entra mientras la caja cobra queda pendiente (no se cobra sin querer)', () => {
  const { S } = setup();
  const s = S.openTable('table-5');
  S.addTableBatch(s.id, [item(S)]);
  const seen = S.tablePending(s).map((o) => o.id); // lo que vio la caja al abrir el cobro
  const late = S.addTableBatch(s.id, [item(S, 'p-esp', 'grande')]); // el mozo manda postre
  S.payTable(s.id, [{ method: 'qr', amount: 10000 }], {}, seen);
  assert.equal(late.paid, false);
  assert.equal(S.tableBalance(s), 14000);
  assert.equal(S.activeTableSession('table-5').id, s.id, 'la mesa sigue ocupada con el saldo nuevo');
  // la segunda cobranza tiene su propio comprobante
  const bill2 = S.payTable(s.id, [{ method: 'efectivo', amount: 14000 }]);
  assert.equal(bill2.items.length, 1);
  assert.equal(bill2.total, 14000);
  assert.equal(S.activeTableSession('table-5'), null);
});

test('una tanda que llega después de cerrar la mesa reabre la cuenta (no se pierde)', () => {
  const { S } = setup();
  const s = S.openTable('table-6');
  S.addTableBatch(s.id, [item(S)]);
  S.payTable(s.id, [{ method: 'efectivo', amount: 10000 }]);
  assert.equal(S.sessionActive(s), false);
  // otro equipo (sin enterarse del cierre) manda una tanda a esa cuenta
  const o = S.createOrder({ type: 'mesa', table: '6', tableSessionId: s.id, batchNumber: 2, items: [item(S)] });
  assert.equal(S.sessionActive(s), true);
  assert.equal(S.activeTableSession('table-6').id, s.id);
  S.reconcileTables();
  assert.equal(s.state, 'ocupada');
  assert.equal(S.tableBalance(s), o.total);
  // mandar otra tanda desde una cuenta ya cerrada abre una nueva en la misma mesa
  S.payTable(s.id, [{ method: 'efectivo', amount: o.total }]);
  const o2 = S.addTableBatch(s.id, [item(S)]);
  assert.notEqual(o2.tableSessionId, s.id);
  assert.equal(S.activeTableSession('table-6').id, o2.tableSessionId);
});

test('dos equipos abren la misma mesa a la vez: las cuentas se unifican igual en los dos', () => {
  const A = setup();
  const B = setup();
  const sA = A.S.openTable('table-7', { guests: 2 });
  const sB = B.S.openTable('table-7', { guests: 4 });
  sA.openedAt = 1000;
  sB.openedAt = 1000; // mismo instante: desempata el id, igual en todos los equipos
  const oA = A.S.addTableBatch(sA.id, [item(A.S)]);
  const oB = B.S.addTableBatch(sB.id, [item(B.S, 'p-esp', 'chica', 3)]);
  // cada equipo recibe lo del otro (tiempo real)
  const relay = (to, s, o) => {
    to.S.onRemote('docs', { eventType: 'INSERT', new: { col: 'table_session', id: 'br-1/' + s.id, branch_id: 'br-1', data: JSON.parse(JSON.stringify(s)) }, old: {} });
    to.S.onRemote('orders', { eventType: 'INSERT', new: { id: o.id, branch_id: 'br-1', data: JSON.parse(JSON.stringify(o)) }, old: {} });
  };
  relay(B, sA, oA);
  relay(A, sB, oB);
  A.S.reconcileTables();
  B.S.reconcileTables();
  const keepA = A.S.activeTableSession('table-7');
  const keepB = B.S.activeTableSession('table-7');
  assert.equal(keepA.id, keepB.id, 'los dos equipos eligen la misma cuenta');
  assert.equal(A.S.tableOrders(keepA).length, 2);
  assert.equal(B.S.tableOrders(keepB).length, 2);
  assert.equal(A.S.tableBalance(keepA), 10000 + 27000);
  assert.equal(keepA.guests, 4, 'se conserva la mayor cantidad de personas');
  // una tanda mandada a la cuenta unificada termina en la que quedó
  const dupId = keepA.id === sA.id ? sB.id : sA.id;
  const late = A.S.addTableBatch(dupId, [item(A.S)]);
  assert.equal(late.tableSessionId, keepA.id);
  // cada equipo numeró su tanda como la 1: la siguiente sigue la numeración (en la cuenta se listan en orden)
  assert.equal(late.batchNumber, 2);
  assert.equal(A.S.tableOrders(keepA).pop().id, late.id, 'la última de la cuenta es la recién mandada');
});

test('cambiar de mesa lleva la cuenta y no pisa una mesa ocupada', () => {
  const { S } = setup();
  const s = S.openTable('table-8');
  const o = S.addTableBatch(s.id, [item(S)]);
  S.openTable('table-9');
  assert.equal(S.moveTableSession(s.id, 'table-9'), false, 'la mesa 9 está ocupada');
  assert.equal(S.moveTableSession(s.id, 'table-10'), true);
  assert.equal(o.table, '10', 'la comanda muestra la mesa nueva');
  assert.equal(S.activeTableSession('table-8'), null);
  assert.equal(S.activeTableSession('table-10').id, s.id);
});

test('lo que se manda a la nube al cobrar una mesa cumple las reglas del servidor', async () => {
  const { S, sent } = setup();
  const s = S.openTable('table-11');
  S.addTableBatch(s.id, [item(S)]);
  S.addTableBatch(s.id, [item(S, 'p-esp', 'grande')]);
  S.diff();
  await S.flush();
  sent.orders.length = 0;
  sent.docs.length = 0;
  S.payTable(s.id, [{ method: 'tarjeta', amount: 25200, cardType: 'débito' }], { surcharge: 1200 });
  S.diff();
  await S.flush();
  assert.equal(sent.orders.length, 2);
  for (const row of sent.orders) {
    const o = S.order(row.id);
    assert.ok(guardOk(o));
    assert.equal(row.data.paid, true);
    assert.ok(row.data.tableBill && row.data.tableBill.ticketNumber === o.ticketNumber);
  }
  const doc = sent.docs.filter((d) => d.col === 'table_session' && d.id === 'br-1/' + s.id).pop();
  assert.ok(doc && doc.data.state === 'cerrada', 'la cuenta cerrada viaja a los demás equipos');
});

test('rol mozo: atiende el salón y el tablero, pero no cobra', () => {
  const { PZ } = setup();
  PZ.auth.current = { id: 'u-mozo', name: 'Mozo', role: 'mozo', branchIds: [], orgId: 'org-1' };
  assert.equal(PZ.auth.can('salon'), true);
  assert.equal(PZ.auth.can('pedidos'), true);
  assert.equal(PZ.auth.can('vender'), false);
  assert.equal(PZ.auth.can('caja'), false);
  assert.equal(PZ.auth.canCharge(), false);
  assert.equal(PZ.auth.isWaiter(), true);
});

test('mitad y mitad por pizza: solo entera, solo con algunas y la regla vale para las dos', () => {
  const { PZ, S } = setup();
  const C = PZ.carta;
  const cat = (id) => S.category(id);
  S.data.products.push(
    { id: 'p-haw', categoryId: 'c-piz', name: 'Hawaiana', active: true, halfWith: ['p-muz'], variants: [{ id: 'grande', name: 'Grande', price: 15000 }] },
    { id: 'p-jym', categoryId: 'c-piz', name: 'Jamón y morrones', active: true, variants: [{ id: 'grande', name: 'Grande', price: 13000 }] },
    { id: 'p-cal', categoryId: 'c-piz', name: 'Calzone', active: true, allowHalf: false, variants: [{ id: 'grande', name: 'Grande', price: 16000 }] },
  );
  const p = (id) => S.product(id);
  assert.equal(C.halfMode(p('p-haw')), 'some');
  assert.equal(C.halfMode(p('p-cal')), 'none');
  assert.equal(C.halfMode(p('p-muz')), 'all');
  assert.equal(C.canPairHalf(p('p-haw'), p('p-jym'), cat), false, 'hawaiana no va con jamón y morrones');
  assert.equal(C.canPairHalf(p('p-jym'), p('p-haw'), cat), false, 'tampoco al revés');
  assert.equal(C.canPairHalf(p('p-haw'), p('p-muz'), cat), true);
  assert.equal(C.canPairHalf(p('p-muz'), p('p-cal'), cat), false, 'calzone es solo entera');
  assert.equal(C.canPairHalf(p('p-muz'), p('p-muz'), cat), false, 'no se combina consigo misma');
  const partners = C.halfPartners(p('p-jym'), S.data.products, cat).map((x) => x.id).sort();
  assert.deepEqual(partners, ['p-esp', 'p-muz']);
  // la carta online no deja colar una combinación prohibida
  const m = { categories: S.data.categories, products: S.data.products, extras: S.data.extras, settings: { halfPricing: 'max' } };
  const bad = C.priceLine(m, { productId: 'p-haw', variantId: 'grande', halfId: 'p-jym', extras: [], qty: 1 });
  assert.equal(bad.half, null);
  const ok = C.priceLine(m, { productId: 'p-haw', variantId: 'grande', halfId: 'p-muz', extras: [], qty: 1 });
  assert.equal(ok.half && ok.half.id, 'p-muz');
});
