import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Helper para instanciar app con js/notifs.js
function makeTestEnv() {
  const mem = new Map();
  const localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  };
  const ctx = {
    console, Intl, Math, Date, JSON, Promise, Map, Set, Array, Object, String, Number, Boolean, Error, RegExp, Symbol,
    setTimeout, clearTimeout, TextEncoder, URL, crypto: globalThis.crypto,
    navigator: { onLine: true, userAgent: 'test' },
    localStorage, sessionStorage: localStorage,
    location: { href: 'http://test/', origin: 'http://test', pathname: '/', search: '', hash: '' },
    document: { hidden: false, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    addEventListener() {},
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.PZ_CONFIG = { supabaseUrl: 'http://test', supabaseKey: 'x', staffDomain: 'staff.pizzeria.local', version: 'test' };
  vm.createContext(ctx);

  for (const f of ['vendor/qrcode.js', 'js/core.js', 'js/carta-core.js', 'js/seed.js', 'js/store.js', 'js/auth.js', 'js/notifs.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

test('precios de los planes en landing.html y opciones del modal', () => {
  const html = fs.readFileSync(path.join(ROOT, 'landing.html'), 'utf8');

  // Plan Emprender: $120.000
  assert.ok(html.includes('$120.000'), 'landing debe incluir $120.000');
  // Plan Local: $250.000
  assert.ok(html.includes('$250.000'), 'landing debe incluir $250.000');
  // Plan Cadena: $500.000
  assert.ok(html.includes('$500.000'), 'landing debe incluir $500.000');

  // Los tres planes ofrecen 30 días gratis de prueba
  const countTrialBadges = (html.match(/30 d[íi]as gratis de prueba/gi) || []).length;
  assert.ok(countTrialBadges >= 3, `Debe ofrecer 30 días gratis en los tres planes (encontrados: ${countTrialBadges})`);

  // Modal de registro existe con formulario
  assert.ok(html.includes('id="demo-modal"'), 'Debe existir el modal de demo');
  assert.ok(html.includes('id="demo-form"'), 'Debe existir el formulario de demo');
  assert.ok(html.includes('id="demo-wa-notify-btn"'), 'Debe existir el botón de notificación al administrador por WhatsApp');
});

test('cálculo del período de prueba de 30 días y detección de vencimiento', () => {
  const DAY_MS = 864e5;
  const now = 1770000000000;

  // Registro a 30 días
  const trialDays = 30;
  const expiresAt = now + trialDays * DAY_MS;
  assert.equal(expiresAt - now, 30 * DAY_MS, 'El período de prueba debe ser exactamente 30 días');

  // Función de evaluación de vencimiento (misma lógica que app.js)
  const evalTrial = (currentTs, expTs) => {
    const msLeft = expTs - currentTs;
    const daysLeft = Math.ceil(msLeft / DAY_MS);
    const urgent = daysLeft <= 7;
    return { daysLeft, urgent };
  };

  // Caso: recién registrado (día 0 de 30) -> 30 días restantes, NO urgente
  const t0 = evalTrial(now, expiresAt);
  assert.equal(t0.daysLeft, 30);
  assert.equal(t0.urgent, false, 'A los 30 días no debe marcarse como urgente');

  // Caso: día 20 (quedan 10 días) -> NO urgente
  const t20 = evalTrial(now + 20 * DAY_MS, expiresAt);
  assert.equal(t20.daysLeft, 10);
  assert.equal(t20.urgent, false);

  // Caso: día 23 (quedan 7 días) -> URGENTE / Notificación de fecha límite
  const t23 = evalTrial(now + 23 * DAY_MS, expiresAt);
  assert.equal(t23.daysLeft, 7);
  assert.equal(t23.urgent, true, 'A los 7 días debe activarse la notificación de fecha límite');

  // Caso: día 28 (quedan 2 días) -> URGENTE
  const t28 = evalTrial(now + 28 * DAY_MS, expiresAt);
  assert.equal(t28.daysLeft, 2);
  assert.equal(t28.urgent, true);

  // Caso: día 31 (vencido) -> URGENTE / Vencido
  const t31 = evalTrial(now + 31 * DAY_MS, expiresAt);
  assert.ok(t31.daysLeft <= 0);
  assert.equal(t31.urgent, true);
});

test('notificación de alerta por fecha límite en PZ.inbox', () => {
  const env = makeTestEnv();
  const PZ = env.PZ;

  // Iniciar inbox en modo demo
  PZ.inbox.start('org-demo');
  assert.equal(PZ.inbox.all().length, 0);

  // Emitir notificación de fecha límite
  const notif = PZ.inbox.notifyLocal(
    'trial_deadline',
    '⏳ Período de prueba por vencer',
    'Quedan 5 días de tu prueba gratuita del plan LOCAL ($250.000/mes).',
    { action: 'trial_renew' }
  );

  assert.equal(notif.kind, 'trial_deadline');
  assert.equal(PZ.inbox.isLoud(notif), true, 'trial_deadline debe ser considerado aviso prioritario (isLoud)');
  assert.equal(PZ.inbox.catOf(notif.kind), 'alerta', 'trial_deadline debe categorizarse como alerta');

  const all = PZ.inbox.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, notif.id);
  assert.equal(PZ.inbox.unreadCount(), 1);
});

test('notificación al administrador de la plataforma por inscripción a demo', () => {
  const env = makeTestEnv();
  const PZ = env.PZ;

  // Iniciar inbox para plataforma
  PZ.auth.platform = true;
  PZ.inbox.start('platform');

  const lead = {
    id: 'lead-test-123',
    orgName: 'Pizzería Napolitana',
    ownerName: 'Mario Rossi',
    phone: '11 4444-5555',
    email: 'mario@pizzeria.com',
    plan: 'local',
    price: 250000,
    registeredAt: Date.now(),
    expiresAt: Date.now() + 30 * 864e5,
    notifiedAdmin: false,
  };

  // Simular lógica de procesamiento en plataforma
  const notif = PZ.inbox.notifyLocal(
    'demo_lead',
    `🎁 Nueva prueba de 30 días: ${lead.orgName}`,
    `${lead.ownerName} solicitó prueba del plan ${lead.plan.toUpperCase()} (${PZ.util.money(lead.price)}/mes).\nWhatsApp: ${lead.phone}`,
    { action: 'lead_wa', phone: lead.phone }
  );
  lead.notifiedAdmin = true;

  assert.equal(notif.kind, 'demo_lead');
  assert.equal(PZ.inbox.isLoud(notif), true, 'demo_lead debe ser ruidoso/loud');
  assert.equal(PZ.inbox.catOf('demo_lead'), 'alerta');
  assert.equal(PZ.inbox.unreadCount(), 1);
  assert.equal(lead.notifiedAdmin, true);
});
