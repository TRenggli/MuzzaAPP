// Carga los módulos reales de la app (sin navegador) en un contexto aislado,
// con la nube simulada para poder verificar qué se envía.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function loadApp({ online = true, Notification = undefined } = {}) {
  const mem = new Map();
  const localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  };
  const ctx = {
    console, Intl, Math, Date, JSON, Promise, Map, Set, Array, Object, String, Number, Boolean, Error, RegExp, Symbol,
    setTimeout, clearTimeout, TextEncoder, crypto: globalThis.crypto,
    navigator: { onLine: online, userAgent: 'test' },
    localStorage, sessionStorage: localStorage,
    location: { href: 'http://test/', origin: 'http://test', pathname: '/' },
    addEventListener() {},
    ...(Notification ? { Notification } : {}),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.PZ_CONFIG = { supabaseUrl: 'http://test', supabaseKey: 'x', staffDomain: 'staff.pizzeria.local', version: 'test' };
  vm.createContext(ctx);
  for (const f of ['vendor/qrcode.js', 'js/core.js', 'js/carta-core.js', 'js/seed.js', 'js/store.js', 'js/auth.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  const PZ = ctx.PZ;
  PZ.toast = () => {};

  // Nube simulada: registra lo que la app envía
  const sent = { docs: [], orders: [], deletes: [], settings: [], reserved: [] };
  let nextBlock = 1;
  PZ.cloud = {
    fail: null, // error a lanzar en el próximo envío
    async upsertDocs(rows) { if (PZ.cloud.fail) { const e = PZ.cloud.fail; PZ.cloud.fail = null; throw e; } sent.docs.push(...JSON.parse(JSON.stringify(rows))); },
    async upsertOrders(rows) { if (PZ.cloud.fail) { const e = PZ.cloud.fail; PZ.cloud.fail = null; throw e; } sent.orders.push(...JSON.parse(JSON.stringify(rows))); },
    async deleteDoc(org, col, id) { sent.deletes.push({ col, id }); },
    async saveSettings(branch, settings) { sent.settings.push(JSON.parse(JSON.stringify(settings))); },
    async reserve(branch, kind, n) { const s = nextBlock; nextBlock += n; sent.reserved.push({ kind, n, start: s }); return s; },
    reportError() {},
    subscribe() {},
    unsubscribe() {},
  };

  const S = PZ.store;
  S.cache = () => {}; // sin IndexedDB en las pruebas
  S.ctx.orgId = 'org-1';
  S.ctx.branchId = 'br-1';
  S.ctx.branches = [{ id: 'br-1', name: 'Centro', active: true }];
  S.ctx.members = [];
  S.data = S.emptyData(PZ.seed.settings('Pizzería Test'));
  PZ.auth.current = { id: 'u-owner', name: 'Dueño', role: 'owner', branchIds: [], orgId: 'org-1' };

  const plain = (x) => JSON.parse(JSON.stringify(x));
  const setOnline = (v) => { ctx.navigator.onLine = v; };
  return { PZ, S, U: PZ.util, sent, plain, localStorage, setOnline, ctx };
}

/** Menú mínimo con receta, para probar precios y costos */
export function withMenu(S) {
  S.data.ingredients = [
    { id: 'i-muz', name: 'Muzzarella', unit: 'kg', stock: 10, min: 1, cost: 10000 },
    { id: 'i-car', name: 'Cajas', unit: 'u', stock: 100, min: 10, cost: 500 },
  ];
  S.data.categories = [{ id: 'c-piz', name: 'Pizzas', icon: '🍕', allowHalf: true }];
  const recipe = [{ ingredientId: 'i-muz', qty: 0.3 }, { ingredientId: 'i-car', qty: 1 }];
  S.data.products = [
    { id: 'p-muz', categoryId: 'c-piz', name: 'Muzzarella', active: true, recipe, variants: [{ id: 'grande', name: 'Grande', price: 10000, factor: 1 }, { id: 'chica', name: 'Chica', price: 7000, factor: 0.5 }] },
    { id: 'p-esp', categoryId: 'c-piz', name: 'Especial', active: true, recipe, variants: [{ id: 'grande', name: 'Grande', price: 14000, factor: 1 }, { id: 'chica', name: 'Chica', price: 9000, factor: 0.5 }] },
  ];
  S.data.extras = [{ id: 'e1', name: 'Huevo', price: 1000 }];
  return S.data;
}
