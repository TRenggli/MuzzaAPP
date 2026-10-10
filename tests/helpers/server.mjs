// Nube simulada COMPARTIDA: varios equipos (varias instancias de loadApp) hablan con el mismo
// "servidor" en memoria. Reproduce las reglas que importan de la base real:
//   · los documentos y pedidos se combinan campo por campo (data || patch) y llevan updated_at
//   · una sola caja abierta por sucursal (error 23505)
//   · una venta cobrada no se puede modificar (error P0001)
//   · un cobro hecho cuando su caja ya estaba cerrada pasa a la abierta o queda lateCash
//   · save_settings_patch combina por claves (hasta 4 niveles)
//   · cada cambio se avisa en tiempo real a los equipos conectados
const LOCKED = ['items', 'subtotal', 'total', 'payments', 'discount', 'discountAmount', 'cashDiscount', 'surcharge',
  'deliveryFee', 'paidAt', 'ticketNumber', 'cashSessionId', 'createdAt', 'number', 'userId', 'paidBy', 'paid'];

const clone = (x) => JSON.parse(JSON.stringify(x));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function mergeDepth(a, b, depth) {
  if (!isObj(b) || !isObj(a)) return b;
  const r = { ...a };
  Object.keys(b).forEach((k) => {
    r[k] = depth > 1 && isObj(b[k]) && isObj(r[k]) ? mergeDepth(r[k], b[k], depth - 1) : b[k];
  });
  return r;
}

export function makeServer({ orgId = 'org-1', branchId = 'br-1' } = {}) {
  let lastTs = 0;
  const srv = {
    orgId,
    branchId,
    /** @type {Map<string, any>} */
    docs: new Map(),
    /** @type {Map<string, any>} */
    orders: new Map(),
    settings: {},
    members: [{ org_id: orgId, user_id: 'u-owner', name: 'Dueño', username: 'dueno', role: 'owner', active: true, branch_ids: [] }],
    counter: 1,
    /** @type {Set<any>} */
    clients: new Set(),
    /** cuántas veces se pidió "lo que cambió" (para ver que la puesta al día no pide de más) */
    pulls: 0,
    ts() { lastTs = Math.max(lastTs + 1, Date.now()); return new Date(lastTs).toISOString(); },

    broadcast(table, row, eventType = 'UPDATE') {
      srv.clients.forEach((c) => { if (c.connected && c.onEvent) c.onEvent(table, { eventType, new: clone(row), old: {} }); });
    },

    upsertDocs(rows) {
      rows.forEach((r) => {
        const key = `${r.col}|${r.id}`;
        const old = srv.docs.get(key);
        const data = { ...(old ? old.data : {}), ...clone(r.data) };
        if (r.col === 'cash_session' && (data.closedAt === null || data.closedAt === undefined)) {
          const other = Array.from(srv.docs.values()).find((d) => d.col === 'cash_session' && d.branch_id === r.branch_id && d.id !== r.id && (d.data.closedAt === null || d.data.closedAt === undefined));
          if (other) throw Object.assign(new Error('Ya hay una caja abierta para esta sucursal'), { code: '23505' });
        }
        const row = { org_id: r.org_id, col: r.col, id: r.id, branch_id: r.branch_id, data, updated_at: srv.ts() };
        srv.docs.set(key, row);
        srv.broadcast('docs', row);
      });
    },

    upsertOrders(rows) {
      rows.forEach((r) => {
        const old = srv.orders.get(r.id);
        const patch = clone(r.data);
        if (old && old.data.paid) {
          for (const k of LOCKED) {
            if (k in patch && JSON.stringify(patch[k]) !== JSON.stringify(old.data[k])) {
              throw Object.assign(new Error(`La venta #${old.data.number} ya está cobrada: no se puede modificar "${k}"`), { code: 'P0001' });
            }
          }
        }
        const data = { ...(old ? old.data : {}), ...patch };
        // cobro tardío: la caja ya estaba cerrada cuando se cobró
        if (data.paid && !(old && old.data.paid) && data.cashSessionId) {
          const sess = srv.docs.get(`cash_session|${r.branch_id}/${data.cashSessionId}`);
          if (sess && sess.data.closedAt && (data.paidAt || 0) > sess.data.closedAt) {
            const open = Array.from(srv.docs.values()).find((d) => d.col === 'cash_session' && d.branch_id === r.branch_id && (d.data.closedAt === null || d.data.closedAt === undefined));
            if (open) data.cashSessionId = open.id.slice(open.id.indexOf('/') + 1);
            else data.lateCash = true;
          }
        }
        const row = { org_id: r.org_id, id: r.id, branch_id: r.branch_id, data, updated_at: srv.ts() };
        srv.orders.set(r.id, row);
        srv.broadcast('orders', row);
      });
    },

    saveSettings(patch) {
      srv.settings = mergeDepth(srv.settings, clone(patch), 4);
      srv.broadcast('branches', { id: srv.branchId, org_id: srv.orgId, settings: srv.settings });
    },

    /**
     * Conecta una instancia de loadApp: sus llamadas a la nube pasan a hablar con este servidor
     * (sin dejar de registrar lo enviado en `sent`).
     */
    attach(PZ) {
      const client = { connected: true, onEvent: null, PZ };
      const C = PZ.cloud;
      const orig = { upsertDocs: C.upsertDocs, upsertOrders: C.upsertOrders, saveSettings: C.saveSettings, reserve: C.reserve };
      Object.assign(C, {
        async upsertDocs(rows) { await orig.upsertDocs(rows); srv.upsertDocs(rows); },
        async upsertOrders(rows) { await orig.upsertOrders(rows); srv.upsertOrders(rows); },
        async saveSettings(branch, patch) { await orig.saveSettings(branch, patch); srv.saveSettings(patch); },
        async reserve(branch, kind, n) { await orig.reserve(branch, kind, n); const s = srv.counter; srv.counter += n; return s; },
        subscribe(org, branch, onEvent) { client.onEvent = onEvent; srv.clients.add(client); },
        unsubscribe() { srv.clients.delete(client); client.onEvent = null; },
        async orgMeta() {
          return {
            org: { id: srv.orgId, name: 'Pizzería Test', features: {} },
            branches: [{ id: srv.branchId, org_id: srv.orgId, name: 'Centro', active: true, settings: clone(srv.settings) }],
            members: clone(srv.members),
          };
        },
        async branchData() {
          return {
            docs: Array.from(srv.docs.values()).filter((d) => d.branch_id === srv.branchId).map(clone),
            orders: Array.from(srv.orders.values()).map((o) => ({ id: o.id, data: clone(o.data), updated_at: o.updated_at })),
            branch: { id: srv.branchId, settings: clone(srv.settings) },
          };
        },
        async changesSince(org, branch, sinceIso) {
          srv.pulls++;
          return {
            orders: Array.from(srv.orders.values()).filter((o) => o.branch_id === branch && o.updated_at > sinceIso).map(clone),
            docs: Array.from(srv.docs.values()).filter((d) => d.updated_at > sinceIso && (!d.branch_id || d.branch_id === branch)).map(clone),
          };
        },
        async orderById(org, id) { const o = srv.orders.get(id); return o ? clone(o) : null; },
        async openCashSession(org, branch) {
          const d = Array.from(srv.docs.values()).find((x) => x.col === 'cash_session' && x.branch_id === branch && (x.data.closedAt === null || x.data.closedAt === undefined));
          return d ? clone(d) : null;
        },
      });
      return client;
    },
  };
  return srv;
}
