// Panel de avisos del usuario (PZ.inbox): carga, tiempo real, leído, avisos del propio equipo.
// Quién puede leer cada aviso lo decide la base (supabase/tests/notificaciones.sql); acá se prueba lo que
// hace la app con lo que le llega.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadApp } from './helpers/load.mjs';

const row = (id, kind, extra = {}) => ({
  id, org_id: 'org-1', branch_id: 'br-1', kind, title: `título ${id}`, body: 'detalle', data: {}, created_at: new Date(Date.now() - 1000).toISOString(), ...extra,
});

function setup({ rows = [], state = null, userId = 'u-owner' } = {}) {
  const app = loadApp();
  const toasts = [];
  app.PZ.toast = (msg, type) => toasts.push({ msg, type });
  app.PZ.auth.current = { id: userId, name: 'Prueba', role: 'cajero', branchIds: [], orgId: 'org-1' };
  vm.runInContext(fs.readFileSync(new URL('../js/notifs.js', import.meta.url), 'utf8'), app.ctx, { filename: 'js/notifs.js' });
  const calls = { list: [], read: [] };
  const server = { rows: rows.slice(), state };
  Object.assign(app.PZ.cloud, {
    async notifications(org, since) { calls.list.push(since); return server.rows.filter((r) => r.created_at > since); },
    async notificationState() { return server.state; },
    async markNotificationsRead(org, until) { calls.read.push(until); server.state = until; },
  });
  return { ...app, I: app.PZ.inbox, toasts, calls, server };
}

test('al abrir carga lo que la base le deja leer y cuenta lo no leído', async () => {
  const old = new Date(Date.now() - 3600e3).toISOString();
  const { I } = setup({
    rows: [row('a', 'order_new', { created_at: old }), row('b', 'order_paid'), row('c', 'cash_open')],
    state: new Date(Date.now() - 1800e3).toISOString(),
  });
  await I.start('org-1');
  assert.equal(I.items.length, 3);
  assert.equal(I.unreadCount(), 2, 'lo anterior a la última lectura ya está leído');
  assert.deepEqual(I.items.map((x) => x.id).sort(), ['a', 'b', 'c']);
  assert.ok(I.items[0].at >= I.items[2].at, 'el más nuevo primero');
});

test('la primera vez de una persona no se le muestra todo el historial como sin leer', async () => {
  const { I, calls } = setup({ rows: [row('a', 'order_new', { created_at: new Date(Date.now() - 86400e3).toISOString() })], state: null });
  await I.start('org-1');
  assert.equal(I.unreadCount(), 0);
  assert.equal(calls.read.length, 1, 'se deja marcado para sus otros equipos');
});

test('un aviso en vivo se suma una sola vez y suma al contador', async () => {
  const { I } = setup({ state: new Date(Date.now() - 5000).toISOString() });
  await I.start('org-1');
  const p = { eventType: 'INSERT', new: row('n1', 'order_new', { created_at: new Date().toISOString() }) };
  I.onRemote(p);
  I.onRemote(p); // el mismo aviso otra vez (tiempo real + puesta al día)
  assert.equal(I.items.length, 1);
  assert.equal(I.unreadCount(), 1);
});

test('los avisos de otro negocio no entran, y un aviso borrado (más de 30 días) sale', async () => {
  const { I } = setup({ rows: [row('a', 'order_new')] });
  await I.start('org-1');
  I.onRemote({ eventType: 'INSERT', new: row('x', 'order_new', { org_id: 'org-2' }) });
  assert.equal(I.items.length, 1);
  I.onRemote({ eventType: 'DELETE', old: { id: 'a' } });
  assert.equal(I.items.length, 0);
});

test('solo lo importante salta como alerta en pantalla; lo demás solo suma a la campana', async () => {
  const { I, toasts } = setup({ state: new Date(Date.now() - 5000).toISOString() });
  await I.start('org-1');
  const now = () => new Date().toISOString();
  I.onRemote({ eventType: 'INSERT', new: row('1', 'order_new', { created_at: now() }) });
  I.onRemote({ eventType: 'INSERT', new: row('2', 'order_paid', { created_at: now() }) });
  assert.equal(toasts.length, 0, 'pedidos y cobros no interrumpen');
  I.onRemote({ eventType: 'INSERT', new: row('3', 'order_void', { title: '🚫 Pedido #5 anulado', body: 'Delivery · $ 10.000 · motivo: x', created_at: now() }) });
  I.onRemote({ eventType: 'INSERT', new: row('4', 'cash_close', { data: { diff: -500 }, title: '⚠️ Caja cerrada con diferencia', created_at: now() }) });
  I.onRemote({ eventType: 'INSERT', new: row('5', 'cash_close', { data: { diff: 0 }, title: '🔒 Caja cerrada', created_at: now() }) });
  assert.equal(toasts.length, 2, 'anulación y diferencia de caja sí; un cierre sin diferencia no');
  assert.match(toasts[0].msg, /anulado/);
  assert.equal(I.unreadCount(), 5);
});

test('marcar todo como leído guarda hasta el aviso más nuevo y lo recuerda en la nube', async () => {
  const { I, calls, server } = setup({ rows: [row('a', 'order_new'), row('b', 'order_paid', { created_at: new Date(Date.now() - 500).toISOString() })], state: new Date(Date.now() - 60000).toISOString() });
  await I.start('org-1');
  assert.equal(I.unreadCount(), 2);
  const newest = Math.max(...I.items.map((x) => x.at));
  await I.markAllRead();
  assert.equal(I.unreadCount(), 0);
  assert.equal(Date.parse(calls.read.at(-1)), newest);
  assert.equal(Date.parse(server.state), newest);
});

test('la puesta al día trae lo que se perdió sin duplicar lo que ya estaba', async () => {
  const { I, server } = setup({ rows: [row('a', 'order_new')], state: new Date().toISOString() });
  await I.start('org-1');
  server.rows.push(row('b', 'summary_day', { branch_id: null, created_at: new Date().toISOString() })); // llegó mientras no había tiempo real
  await I.refresh();
  assert.deepEqual(I.items.map((x) => x.id).sort(), ['a', 'b']);
  await I.refresh();
  assert.equal(I.items.length, 2);
});

test('avisos del propio equipo: se guardan por persona, se leen aparte y no viajan a la nube', async () => {
  const a = setup({ rows: [], state: new Date().toISOString(), userId: 'u-1' });
  await a.I.start('org-1');
  a.I.notifyLocal('sync_conflict', '⚠️ Cambio rechazado', 'detalle', { action: 'sync' });
  assert.equal(a.I.all().length, 1);
  assert.equal(a.I.unreadCount(), 1);
  assert.equal(a.calls.read.length, 0, 'no se manda nada a la nube');
  await a.I.markAllRead();
  assert.equal(a.I.unreadCount(), 0, 'se marcan leídos');
  assert.ok(a.I.all()[0].local);

  // el mismo equipo, otra persona: no ve los de la anterior
  const stored = a.localStorage.getItem('pz-inbox-local:u-1');
  assert.ok(stored && JSON.parse(stored).length === 1);
  assert.equal(a.localStorage.getItem('pz-inbox-local:u-2'), null);
});

test('al volver a abrir en el mismo equipo reaparecen los avisos del equipo (hasta 7 días)', async () => {
  const a = setup({ state: new Date().toISOString(), userId: 'u-1' });
  a.localStorage.setItem('pz-inbox-local:u-1', JSON.stringify([
    { id: 'l-1', kind: 'sync_cash', title: 'reciente', body: '', data: {}, at: Date.now() - 3600e3, local: true, read: true },
    { id: 'l-2', kind: 'sync_cash', title: 'viejo', body: '', data: {}, at: Date.now() - 9 * 864e5, local: true, read: true },
  ]));
  await a.I.start('org-1');
  assert.deepEqual(a.I.local.map((x) => x.title), ['reciente']);
});

test('categorías: operación, caja, alertas y resúmenes', async () => {
  const { I } = setup();
  const c = I.catOf;
  assert.equal(c('order_new'), 'ops');
  assert.equal(c('bill_requested'), 'ops');
  assert.equal(c('web_order'), 'ops');
  assert.equal(c('cash_close'), 'caja');
  assert.equal(c('discount_big'), 'caja');
  assert.equal(c('stock_low'), 'alerta');
  assert.equal(c('sync_live'), 'alerta');
  assert.equal(c('summary_month'), 'resumen');
});

test('al cerrar sesión se vacía el panel', async () => {
  const { I } = setup({ rows: [row('a', 'order_new')], state: new Date(0).toISOString() });
  await I.start('org-1');
  assert.equal(I.items.length, 1);
  I.stop();
  assert.equal(I.items.length, 0);
  assert.equal(I.unreadCount(), 0);
  // un aviso en vivo después de cerrar no entra
  I.onRemote({ eventType: 'INSERT', new: row('z', 'order_new') });
  assert.equal(I.items.length, 0);
});
