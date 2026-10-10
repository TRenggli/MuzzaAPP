// Sincronización en vivo confiable: dos equipos de la misma sucursal contra una nube compartida
// (ver tests/helpers/server.mjs). Cubre ponerse al día tras un corte, cobros en carrera, una sola
// caja abierta y configuración sin pisarse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, withMenu } from './helpers/load.mjs';
import { makeServer } from './helpers/server.mjs';

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Dos equipos (caja 1 y caja 2) de la misma sucursal, ya al día con la nube */
async function twoDevices(opts = {}) {
  const server = makeServer();
  server.members.push(
    { org_id: 'org-1', user_id: 'u-caja1', name: 'Caja Uno', username: 'caja1', role: 'cajero', active: true, branch_ids: [] },
    { org_id: 'org-1', user_id: 'u-caja2', name: 'Caja Dos', username: 'caja2', role: 'cajero', active: true, branch_ids: [] },
  );
  const mk = async (id, name) => {
    const app = loadApp({ server, document: true, ...opts });
    app.S.ctx.members = JSON.parse(JSON.stringify(server.members));
    app.PZ.auth.current = { id, name, role: 'cajero', branchIds: [], orgId: 'org-1' };
    app.localStorage.setItem('pz-pool-br-1', JSON.stringify({ order: [[1, 99]], ticket: [[1, 99]] }));
    await app.S.refresh();
    withMenu(app.S);                                       // el menú es local: la nube de la prueba no lo guarda
    app.S.rebuildShadow();
    app.PZ.cloud.subscribe('org-1', 'br-1', app.S.onRemote); // tiempo real
    return app;
  };
  const A = await mk('u-caja1', 'Caja Uno');
  const B = await mk('u-caja2', 'Caja Dos');
  return { server, A, B };
}
const item = (S) => S.makeItem({ product: S.product('p-muz'), variant: S.product('p-muz').variants[0] });
const flush = async (app) => { app.S.diff(); await app.S.flush(); };

test('un equipo sin tiempo real se pone al día: trae lo que cambió sin pisar lo que le falta enviar', async () => {
  const { A, B, server } = await twoDevices();
  B.client.connected = false; // B pierde los avisos en vivo

  // A vende y cobra; la cocina de A lo pasa al horno
  A.S.openSession(1000);
  const o = A.S.createOrder({ type: 'mostrador', items: [item(A.S)] }, { paid: true, payments: [{ method: 'efectivo', amount: 10000, tendered: 10000 }] });
  A.S.setStatus(o.id, 'horno');
  await flush(A);
  assert.equal(B.S.data.orders.length, 0, 'B no recibió nada (estaba sin avisos)');

  // B se pone al día
  const n = await B.S.catchUp('prueba');
  assert.ok(n > 0, 'aplicó cambios');
  assert.equal(B.S.data.orders.length, 1);
  assert.equal(B.S.order(o.id).status, 'horno');
  assert.ok(B.S.data.cashSessions.some((s) => !s.closedAt), 'también vio la caja abierta por A');
  assert.equal(B.S.order(o.id).paidBy, 'u-caja1');

  // sin cambios nuevos no aplica nada (y no redibuja)
  assert.equal(await B.S.catchUp('de nuevo'), 0);
});

test('al ponerse al día se respeta lo que este equipo todavía no envió', async () => {
  const { A, B } = await twoDevices();
  const o = A.S.createOrder({ type: 'mostrador', items: [item(A.S)] });
  await flush(A);
  await B.S.catchUp();
  // B queda sin internet y anota algo; mientras A avanza el pedido
  B.setOnline(false);
  B.S.order(o.id).notes = 'sin cebolla';
  B.S.diff();
  A.S.setStatus(o.id, 'listo');
  await flush(A);
  B.setOnline(true);
  B.client.connected = false;
  const mine = B.S.order(o.id);
  await B.S.catchUp();
  assert.equal(mine.status, 'listo', 'llegó lo de A');
  assert.equal(mine.notes, 'sin cebolla', 'se conservó la nota local');
  assert.equal(B.S.data.orders.length, 1, 'es el mismo pedido, no un duplicado');
});

test('la puesta al día no se hace sin internet y no pisa nada si no hay cambios', async () => {
  const { B, server } = await twoDevices();
  B.setOnline(false);
  const before = server.pulls;
  assert.equal(await B.S.catchUp(), 0);
  assert.equal(server.pulls, before, 'sin internet no consulta la nube');
});

test('al volver a la pantalla solo se revisa si estuvo oculta 15 segundos o más', async () => {
  const { A, B, server } = await twoDevices();
  B.client.connected = false;
  A.S.createOrder({ type: 'mostrador', items: [item(A.S)] });
  await flush(A);

  const t0 = server.pulls;
  B.S.onVisibility(true);
  B.S.hiddenAt = Date.now() - 5000;          // estuvo oculta 5 s
  B.S.onVisibility(false);
  await wait(5);
  assert.equal(server.pulls, t0, 'menos de 15 s: no revisa');
  assert.equal(B.S.data.orders.length, 0);

  B.S.onVisibility(true);
  B.S.hiddenAt = Date.now() - 20000;         // estuvo oculta 20 s
  B.S.onVisibility(false);
  await wait(20);
  assert.equal(server.pulls, t0 + 1, 'más de 15 s: revisa');
  assert.equal(B.S.data.orders.length, 1, 'y se puso al día');
});

test('al volver internet primero se envía lo pendiente y después se trae lo que pasó', async () => {
  const { A, B } = await twoDevices();
  B.client.connected = false;
  B.setOnline(false);
  const mine = B.S.createOrder({ type: 'mostrador', items: [item(B.S)] }); // vende sin internet
  B.S.diff();
  const theirs = A.S.createOrder({ type: 'mostrador', items: [item(A.S)] });
  await flush(A);
  B.setOnline(true);
  B.S.onOnline();
  await wait(30);
  assert.ok(B.S.order(theirs.id), 'trajo la venta de A');
  assert.equal(B.S.status.pending, 0, 'y envió la suya');
});

test('si el corte fue de más de 6 horas trae todo de nuevo, salvo que haya una ventana abierta', async () => {
  const { A, B } = await twoDevices();
  B.client.connected = false;
  A.S.createOrder({ type: 'mostrador', items: [item(A.S)] });
  await flush(A);
  let refreshes = 0;
  const real = B.S.refresh;
  B.S.refresh = async () => { refreshes++; return real.call(B.S); };

  const nowReal = Date.now;
  Date.now = () => nowReal() + 7 * 3600e3; // pasaron 7 horas
  try {
    B.page.modal = true;
    assert.equal(await B.S.catchUp(), 0, 'con una ventana abierta se posterga');
    assert.equal(refreshes, 0);
    B.page.modal = false;
    assert.equal(await B.S.catchUp(), -1, 'sin ventana, trae todo');
    assert.equal(refreshes, 1);
    assert.equal(B.S.data.orders.length, 1);
  } finally { Date.now = nowReal; }
});

/* ---------------- Cobros en carrera ---------------- */
test('antes de cobrar se mira la nube: si otra caja ya lo cobró, esta copia se actualiza', async () => {
  const { A, B } = await twoDevices();
  const o = A.S.createOrder({ type: 'mostrador', items: [item(A.S)] });
  await flush(A);
  await B.S.catchUp();
  const copy = B.S.order(o.id);
  assert.equal(copy.paid, false);

  // A lo cobra; B no se entera (sin avisos)
  B.client.connected = false;
  A.S.openSession(0);
  A.S.payOrder(o.id, [{ method: 'efectivo', amount: copy.total, tendered: copy.total }]);
  await flush(A);
  assert.equal(copy.paid, false, 'B todavía cree que está sin cobrar');

  const same = await B.S.syncOrder(o.id);
  assert.equal(same, copy, 'mismo objeto actualizado en el lugar');
  assert.equal(copy.paid, true);
  assert.equal(B.S.paidByName(copy), 'Caja Uno');
});

test('si el servidor rechaza para siempre un pedido, esta copia se reemplaza por la del servidor y queda en Conflictos', async () => {
  const { A, B } = await twoDevices();
  const o = A.S.createOrder({ type: 'mostrador', items: [item(A.S)] });
  await flush(A);
  await B.S.catchUp();
  const copy = B.S.order(o.id);
  B.client.connected = false;

  // A lo cobra y B, sin saberlo, también lo cobra (offline)
  A.S.openSession(0);
  A.S.payOrder(o.id, [{ method: 'efectivo', amount: copy.total, tendered: copy.total }]);
  await flush(A);
  B.S.openSession(0);
  B.S.payOrder(o.id, [{ method: 'transferencia', amount: copy.total }]);
  await flush(B);

  assert.equal(B.S.conflicts().some((c) => c.name === 'orders'), true, 'quedó registrado para revisar');
  assert.equal(B.S.status.state, 'error');
  assert.equal(copy.paid, true);
  assert.equal(copy.payments[0].method, 'efectivo', 'B ahora tiene el cobro real (el de A)');
  assert.equal(copy.paidBy, 'u-caja1');
});

/* ---------------- Una sola caja ---------------- */
test('dos equipos abren caja a la vez: el segundo adopta la que ya existe y le pasa sus ventas', async () => {
  const { A, B, server } = await twoDevices();
  B.client.connected = false;
  A.client.connected = false;
  // los dos abren caja y venden sin saber del otro
  const sa = A.S.openSession(1000);
  const sb = B.S.openSession(500);
  const ob = B.S.createOrder({ type: 'mostrador', items: [item(B.S)] }, { paid: true, payments: [{ method: 'efectivo', amount: 10000, tendered: 10000 }] });
  B.S.addCashMove('ingreso', 200, 'cambio');
  await flush(A);               // A llega primero
  await flush(B);               // B es rechazada por el servidor

  const open = Array.from(server.docs.values()).filter((d) => d.col === 'cash_session' && d.data.closedAt === null);
  assert.equal(open.length, 1, 'quedó una sola caja abierta');
  assert.equal(open[0].id, `br-1/${sa.id}`);
  assert.equal(B.S.data.cashSessions.filter((s) => !s.closedAt).length, 1, 'B tiene una sola caja abierta');
  assert.equal(B.S.currentSession().id, sa.id, 'y es la de A');
  assert.ok(!B.S.data.cashSessions.some((s) => s.id === sb.id), 'la propia se descartó');
  assert.equal(B.S.order(ob.id).cashSessionId, sa.id, 'la venta de B pasó a la caja de A');
  assert.equal(server.orders.get(ob.id).data.cashSessionId, sa.id, 'y así llegó al servidor');
  assert.equal(B.S.data.cashMoves[0].sessionId, sa.id, 'el movimiento también');
  assert.equal(B.S.conflicts().length, 0, 'no es un conflicto: se resolvió solo');
  assert.equal(B.S.status.state, 'ok');
});

test('cerrar la caja primero se pone al día con lo que cobraron otros equipos', async () => {
  const { A, B } = await twoDevices();
  A.S.openSession(1000);
  await flush(A);
  await B.S.catchUp();
  B.client.connected = false;
  const o = A.S.createOrder({ type: 'mostrador', items: [item(A.S)] }, { paid: true, payments: [{ method: 'efectivo', amount: 10000, tendered: 10000 }] });
  await flush(A);
  assert.equal(B.S.sessionSummary(B.S.currentSession()).sales, 0, 'B todavía no vio la venta');
  const closed = await B.S.closeSession(11000);
  assert.equal(closed.expectedCash, 11000, 'el cierre incluye la venta de A: fondo 1000 + 10000');
  assert.equal(closed.diff, 0);
  assert.ok(B.S.order(o.id));
});

/* ---------------- Configuración sin pisarse ---------------- */
test('la configuración viaja como parche: solo lo que cambió', async () => {
  const { A, server } = await twoDevices();
  A.S.data.settings.ticket.width = 58;
  A.S.diff();
  await A.S.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(A.sent.settings.at(-1))), { ticket: { width: 58 } });
  A.S.data.settings.business.phone = '555';
  A.S.data.settings.ticket.footer = 'Gracias!';
  A.S.diff();
  await A.S.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(A.sent.settings.at(-1))), { business: { phone: '555' }, ticket: { footer: 'Gracias!' } });
  assert.equal(server.settings.ticket.width, 58);
  assert.equal(server.settings.ticket.footer, 'Gracias!');
});

test('dos encargados que editan cosas distintas de la configuración no se pisan', async () => {
  const { A, B, server } = await twoDevices();
  A.client.connected = false;
  B.client.connected = false;
  A.S.data.settings.business.phone = '111';
  B.S.data.settings.ticket.footer = 'Hasta pronto';
  A.S.diff(); B.S.diff();
  await A.S.flush();
  await B.S.flush();
  assert.equal(server.settings.business.phone, '111', 'lo de A sigue');
  assert.equal(server.settings.ticket.footer, 'Hasta pronto', 'y lo de B también');
});

test('un cambio de configuración de otro equipo llega sin borrar lo que se está editando acá', async () => {
  const { A, B } = await twoDevices();
  B.setOnline(false);
  B.S.data.settings.ticket.footer = 'mi pie';
  B.S.diff();                                   // queda en cola, sin enviar
  A.S.data.settings.business.phone = '999';
  A.S.diff();
  await A.S.flush();                            // A guarda; B recibe el aviso en vivo
  assert.equal(B.S.data.settings.business.phone, '999', 'llegó lo de A');
  assert.equal(B.S.data.settings.ticket.footer, 'mi pie', 'se conservó lo de B');
  B.setOnline(true);
  await B.S.flush();
  assert.equal(B.S.status.pending, 0);
});

test('varios cambios seguidos de configuración se juntan en un solo parche', async () => {
  const { A } = await twoDevices();
  A.setOnline(false);
  A.S.data.settings.ticket.width = 58;
  A.S.diff();
  A.S.data.settings.ticket.copies = 2;
  A.S.data.settings.business.phone = '777';
  A.S.diff();
  assert.equal(A.S.status.pending, 1);
  A.setOnline(true);
  await A.S.flush();
  assert.equal(A.sent.settings.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(A.sent.settings[0])), { ticket: { width: 58, copies: 2 }, business: { phone: '777' } });
});

/* ---------------- Indicador de conexión en vivo (cloud.js real) ---------------- */
import fs from 'node:fs';
import vm from 'node:vm';

test('cloud: cada vez que el canal vuelve a conectar se pone al día, y avisa si pasan 10 s sin tiempo real', () => {
  const app = loadApp();
  let statusCb = null;
  const channel = { on() { return channel; }, subscribe(cb) { statusCb = cb; return channel; } };
  app.ctx.supabase = { createClient: () => ({ channel: () => channel, removeChannel() {}, auth: {} }) };
  app.ctx.document = { addEventListener() {} };
  const keep = app.PZ.cloud; // se reemplaza la nube simulada por la real de cloud.js
  vm.runInContext(fs.readFileSync(new URL('../js/cloud.js', import.meta.url), 'utf8'), app.ctx, { filename: 'js/cloud.js' });
  const C = app.PZ.cloud;
  assert.notEqual(C, keep);
  const calls = [];
  app.PZ.store.catchUp = (why) => { calls.push(why); return Promise.resolve(0); };
  app.PZ.store.emitStatus = () => {};

  C.subscribe('org-1', 'br-1', () => {});
  statusCb('SUBSCRIBED');
  assert.deepEqual(calls, ['reconexión'], 'al conectar trae lo que se pudo perder');
  assert.equal(C.liveDown(), false);

  statusCb('CLOSED');
  assert.equal(C.liveDown(), false, 'hasta 10 s no se avisa');
  C.realtimeSince = Date.now() - 11000;
  assert.equal(C.liveDown(), true, 'pasados 10 s sin conexión en vivo, se avisa');

  statusCb('SUBSCRIBED');
  assert.equal(calls.length, 2, 'al reconectar se pone al día otra vez');
  assert.equal(C.liveDown(), false);
});
