/* ==========================================================================
   PZ.store — datos de la sucursal activa + sincronización con la nube.

   Cómo funciona:
   · Las pantallas leen y modifican S.data directamente y llaman S.save().
   · save() compara cada registro con su última versión conocida ("shadow"),
     arma parches solo con los campos que cambiaron y los pone en una cola
     (outbox) que se guarda en el dispositivo.
   · La cola se envía a Supabase apenas hay conexión. Si no hay internet,
     el sistema sigue funcionando y sincroniza después.
   · Los cambios de otros dispositivos llegan en tiempo real y se aplican
     sobre los mismos objetos (respetando lo que todavía no se envió).
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;

  /** Colecciones sincronizadas. Todo es propio de cada sucursal. */
  const COLS = {
    categories: { col: 'category', scope: 'branch', ordered: true },
    products: { col: 'product', scope: 'branch', ordered: true },
    extras: { col: 'extra', scope: 'branch', ordered: true },
    customers: { col: 'customer', scope: 'branch' },
    expenses: { col: 'expense', scope: 'branch', sort: (a, b) => b.at - a.at },
    ingredients: { col: 'ingredient', scope: 'branch', ordered: true },
    stockMoves: { col: 'stock_move', scope: 'branch', appendOnly: true, sort: (a, b) => b.at - a.at },
    cashSessions: { col: 'cash_session', scope: 'branch', sort: (a, b) => a.openedAt - b.openedAt },
    cashMoves: { col: 'cash_move', scope: 'branch', sort: (a, b) => a.at - b.at },
    audit: { col: 'audit', scope: 'branch', appendOnly: true, sort: (a, b) => b.at - a.at },
    orders: { table: 'orders', scope: 'branch', appendOnly: true, sort: (a, b) => a.createdAt - b.createdAt },
  };
  const COL_TO_NAME = Object.fromEntries(Object.entries(COLS).filter(([, c]) => c.col).map(([n, c]) => [c.col, n]));

  /* ---------------- Caché local (IndexedDB) ---------------- */
  const idb = {
    db: null,
    async open() {
      if (this.db) return;
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('pizzeria-cloud', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    get(k) {
      return new Promise((res) => {
        const t = this.db.transaction('kv', 'readonly').objectStore('kv').get(k);
        t.onsuccess = () => res(t.result);
        t.onerror = () => res(null);
      });
    },
    set(k, v) {
      return new Promise((res) => {
        const tx = this.db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => res();
        tx.onerror = () => res();
      });
    },
  };

  let shadow = new Map();   // key → JSON del último estado conocido
  let outbox = new Map();   // key → { name, id, patch } | { name, id, del: true } | { name: 'settings' }
  let syncTimer = null;
  let cacheTimer = null;
  let flushing = false;
  let retryDelay = 3000;
  let retryTimer = null;
  const listeners = new Set();
  const statusListeners = new Set();

  const keyOf = (name, id) => `${name}:${id}`;
  // Días de ventas que guarda cada equipo. Lo anterior se consulta a la nube.
  const LOCAL_DAYS = 45;
  // Los registros por sucursal llevan la sucursal en el id remoto (así el
  // insumo "i-muz" existe una vez por sucursal con su propio stock).
  const remoteId = (name, id) => (COLS[name].scope === 'branch' && COLS[name].col ? `${S.ctx.branchId}/${id}` : id);
  const localId = (id) => (id.includes('/') ? id.slice(id.indexOf('/') + 1) : id);

  const S = (PZ.store = {
    data: null,
    ctx: { orgId: null, branchId: null, org: null, branches: [], members: [], role: null },
    LOCAL_DAYS,
    /** Desde cuándo hay ventas guardadas en este equipo */
    localSince: () => U.startOfDay(Date.now() - (LOCAL_DAYS - 1) * 864e5).getTime(),
    status: { pending: 0, state: 'idle', lastSync: null, error: '' },

    /* =================== Abrir sucursal =================== */
    emptyData(settings) {
      return {
        settings: settings || PZ.seed.settings(),
        users: [], categories: [], products: [], extras: [], customers: [], orders: [],
        cashSessions: [], cashMoves: [], ingredients: [], stockMoves: [], audit: [], expenses: [],
        demo: false,
      };
    },

    /**
     * Carga la sucursal: primero desde la caché (instantáneo y sirve sin
     * internet) y después trae lo último de la nube.
     */
    async open(orgId, branchId) {
      await idb.open();
      S.ctx.orgId = orgId;
      S.ctx.branchId = branchId;
      shadow = new Map();
      outbox = new Map();
      const cached = await idb.get(`branch:${branchId}`);
      if (cached && cached.data) {
        S.data = cached.data;
        S.ctx.org = cached.org || S.ctx.org;
        S.ctx.branches = cached.branches || S.ctx.branches;
        S.ctx.members = cached.members || S.ctx.members;
        outbox = new Map(cached.outbox || []);
        S.rebuildShadow();
        S.afterLoad();
      }
      if (navigator.onLine) {
        try {
          await S.refresh();
        } catch (e) {
          console.error(e);
          if (!S.data) throw e;
          PZ.toast('Trabajando sin conexión con los datos guardados', 'warn', 4000);
        }
      } else if (!S.data) {
        throw new Error('Sin conexión y sin datos guardados en este dispositivo. Conectate a internet para el primer ingreso.');
      }
      PZ.cloud.subscribe(orgId, branchId, S.onRemote);
      S.ensurePools();
      S.flush();
    },

    /** Trae todo de la nube y lo combina con lo que falta enviar */
    async refresh() {
      const { orgId, branchId } = S.ctx;
      const [meta, bd] = await Promise.all([PZ.cloud.orgMeta(orgId), PZ.cloud.branchData(orgId, branchId, LOCAL_DAYS)]);
      S.ctx.org = meta.org;
      S.ctx.branches = meta.branches;
      S.ctx.members = meta.members;

      const d = S.emptyData();
      const pendingSettings = outbox.get('settings');
      d.settings = pendingSettings && S.data ? S.data.settings : deepMerge(PZ.seed.settings(meta.org ? meta.org.name : ''), bd.branch.settings || {});

      const grouped = {};
      bd.docs.forEach((r) => {
        const name = COL_TO_NAME[r.col];
        if (!name) return;
        if (COLS[name].scope === 'branch' && r.branch_id !== branchId) return;
        (grouped[name] = grouped[name] || []).push({ ...r.data, id: localId(r.id) });
      });
      grouped.orders = bd.orders.map((r) => ({ ...r.data, id: r.id }));

      for (const name of Object.keys(COLS)) {
        const remote = grouped[name] || [];
        const byId = new Map(remote.map((r) => [r.id, r]));
        // aplicar lo pendiente de envío
        outbox.forEach((op) => {
          if (op.name !== name) return;
          if (op.del) byId.delete(op.id);
          else if (byId.has(op.id)) byId.set(op.id, { ...byId.get(op.id), ...op.patch });
          else {
            const local = S.data && (S.data[name] || []).find((x) => x.id === op.id);
            byId.set(op.id, local ? { ...local, ...op.patch } : { ...op.patch, id: op.id });
          }
        });
        d[name] = sortCol(name, Array.from(byId.values()));
      }
      S.data = d;
      S.rebuildShadow();
      S.afterLoad();
      S.status.lastSync = Date.now();
      S.cache();
      S.emit();
    },

    afterLoad() {
      const d = S.data;
      d.users = S.ctx.members.map((m) => ({ id: m.user_id, name: m.name, username: m.username, role: m.role, active: m.active, branchIds: m.branch_ids || [], lastLogin: m.last_login }));
      d.demo = d.orders.some((o) => o.demo);
      d.settings.business = d.settings.business || {};
    },

    rebuildShadow() {
      shadow = new Map();
      for (const name of Object.keys(COLS)) {
        // lo que falta enviar ya está en la cola: el shadow es el estado local
        (S.data[name] || []).forEach((r, i) => {
          if (COLS[name].ordered) r._i = i;
          shadow.set(keyOf(name, r.id), JSON.stringify(r));
        });
      }
      shadow.set('settings', JSON.stringify(S.data.settings));
    },

    /* =================== Guardar =================== */
    save() {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => { S.diff(); S.flush(); }, 250);
      listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    emit() { listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); },
    emitStatus() {
      S.status.pending = outbox.size;
      S.status.online = navigator.onLine;
      statusListeners.forEach((fn) => { try { fn(S.status); } catch (e) { console.error(e); } });
    },

    /** Detecta qué cambió y lo agrega a la cola */
    diff() {
      if (!S.data) return;
      for (const [name, cfg] of Object.entries(COLS)) {
        const arr = S.data[name] || [];
        const seen = new Set();
        arr.forEach((r, i) => {
          if (!r.id) r.id = U.uid(cfg.col ? cfg.col.slice(0, 3) + '-' : 'o-');
          if (cfg.ordered) r._i = i;
          const key = keyOf(name, r.id);
          seen.add(key);
          const now = JSON.stringify(r);
          const before = shadow.get(key);
          if (before === now) return;
          let patch;
          if (!before) patch = JSON.parse(now);
          else {
            const old = JSON.parse(before);
            patch = {};
            Object.keys(r).forEach((k) => { if (JSON.stringify(r[k]) !== JSON.stringify(old[k])) patch[k] = r[k] === undefined ? null : r[k]; });
            Object.keys(old).forEach((k) => { if (!(k in r)) patch[k] = null; });
            patch = JSON.parse(JSON.stringify(patch));
          }
          queue(key, { name, id: r.id, patch });
          shadow.set(key, now);
        });
        if (!cfg.appendOnly) {
          for (const key of Array.from(shadow.keys())) {
            if (key.startsWith(name + ':') && !seen.has(key)) {
              queue(key, { name, id: key.slice(name.length + 1), del: true });
              shadow.delete(key);
            }
          }
        }
      }
      const st = JSON.stringify(S.data.settings);
      if (shadow.get('settings') !== st) {
        queue('settings', { name: 'settings' });
        shadow.set('settings', st);
      }
      S.cache();
      S.emitStatus();
    },

    /** Envía la cola a la nube */
    async flush() {
      if (flushing || !outbox.size || !navigator.onLine || !S.ctx.branchId) { S.emitStatus(); return; }
      flushing = true;
      S.status.state = 'syncing';
      S.emitStatus();
      const batch = outbox;
      outbox = new Map();
      const { orgId, branchId } = S.ctx;
      const docs = [];
      const orders = [];
      const dels = [];
      let settings = false;
      batch.forEach((op) => {
        if (op.name === 'settings') { settings = true; return; }
        const cfg = COLS[op.name];
        if (op.del) { if (cfg.col) dels.push(op); return; }
        if (cfg.table === 'orders') orders.push({ org_id: orgId, id: op.id, branch_id: branchId, data: op.patch });
        else docs.push({ org_id: orgId, col: cfg.col, id: remoteId(op.name, op.id), branch_id: cfg.scope === 'branch' ? branchId : '', data: op.patch });
      });
      try {
        if (docs.length) await PZ.cloud.upsertDocs(docs);
        if (orders.length) await PZ.cloud.upsertOrders(orders);
        for (const op of dels) await PZ.cloud.deleteDoc(orgId, COLS[op.name].col, remoteId(op.name, op.id));
        if (settings) await PZ.cloud.saveSettings(branchId, S.data.settings);
        S.status.state = 'ok';
        S.status.error = '';
        S.status.lastSync = Date.now();
        retryDelay = 3000;
      } catch (e) {
        console.error('sync', e);
        const permanent = e && e.code && /^(42|23|22|P0)/.test(e.code);
        if (permanent) {
          S.status.state = 'error';
          S.status.error = e.message;
          PZ.toast('La nube rechazó un cambio: ' + (e.message || ''), 'err', 7000);
          PZ.cloud.reportError('Sync rechazado: ' + e.message, { context: e.code });
          // volver a traer lo que dice el servidor para no quedar desalineados
          setTimeout(() => S.refresh().then(() => S.emit()).catch(() => {}), 1500);
        } else {
          // devolver a la cola sin pisar cambios más nuevos
          batch.forEach((op, key) => {
            const newer = outbox.get(key);
            if (!newer) outbox.set(key, op);
            else if (!newer.del && !op.del && newer.patch && op.patch) newer.patch = { ...op.patch, ...newer.patch };
          });
          S.status.state = 'retry';
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => S.flush(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 60000);
        }
      } finally {
        flushing = false;
        S.cache();
        S.emitStatus();
        if (outbox.size && S.status.state === 'ok') S.flush();
      }
    },

    onOnline() {
      retryDelay = 3000;
      S.flush();
      S.ensurePools();
      S.emitStatus();
    },

    cache() {
      clearTimeout(cacheTimer);
      cacheTimer = setTimeout(() => {
        if (!S.ctx.branchId || !S.data) return;
        idb.set(`branch:${S.ctx.branchId}`, {
          data: S.data, outbox: Array.from(outbox.entries()), savedAt: Date.now(),
          org: S.ctx.org, branches: S.ctx.branches, members: S.ctx.members,
        });
      }, 400);
    },

    /* =================== Cambios que llegan de otros equipos =================== */
    onRemote(table, p) {
      if (!S.data) return;
      const row = p.new && Object.keys(p.new).length ? p.new : null;
      const old = p.old || {};
      if (table === 'members') {
        const m = row || old;
        const i = S.ctx.members.findIndex((x) => x.user_id === m.user_id);
        if (p.eventType === 'DELETE') { if (i >= 0) S.ctx.members.splice(i, 1); }
        else if (i >= 0) S.ctx.members[i] = row; else S.ctx.members.push(row);
        S.afterLoad();
        return S.emit();
      }
      if (table === 'branches') {
        const b = row || old;
        const i = S.ctx.branches.findIndex((x) => x.id === b.id);
        if (p.eventType === 'DELETE') { if (i >= 0) S.ctx.branches.splice(i, 1); }
        else if (i >= 0) S.ctx.branches[i] = row; else S.ctx.branches.push(row);
        if (row && row.id === S.ctx.branchId && !outbox.has('settings')) {
          const next = deepMerge(PZ.seed.settings(), row.settings || {});
          replaceInPlace(S.data.settings, next);
          shadow.set('settings', JSON.stringify(S.data.settings));
        }
        return S.emit();
      }
      let name;
      let id;
      if (table === 'orders') {
        name = 'orders';
        id = (row || old).id;
        if (row && row.branch_id !== S.ctx.branchId) return;
      } else {
        const r = row || old;
        name = COL_TO_NAME[r.col];
        if (!name) return;
        if (row && COLS[name].scope === 'branch' && row.branch_id !== S.ctx.branchId) return;
        if (!row && COLS[name].scope === 'branch' && !String(r.id).startsWith(S.ctx.branchId + '/')) return;
        id = localId(r.id);
      }
      const key = keyOf(name, id);
      const arr = S.data[name];
      const idx = arr.findIndex((x) => x.id === id);
      if (p.eventType === 'DELETE') {
        if (idx >= 0) arr.splice(idx, 1);
        shadow.delete(key);
        outbox.delete(key);
      } else {
        const pending = outbox.get(key);
        const merged = { ...row.data, id, ...(pending && pending.patch ? pending.patch : {}) };
        if (idx >= 0) replaceInPlace(arr[idx], merged);
        else arr.push(merged);
        if (COLS[name].sort || COLS[name].ordered) S.data[name] = sortCol(name, arr);
        shadow.set(key, JSON.stringify(idx >= 0 ? arr.find((x) => x.id === id) : merged));
      }
      if (name === 'orders') S.data.demo = S.data.orders.some((o) => o.demo);
      S.cache();
      clearTimeout(S._remoteTimer);
      S._remoteTimer = setTimeout(() => S.emit(), 120);
      if (S.onRemoteHook) S.onRemoteHook(name, id, p.eventType);
    },

    /* =================== Numeración =================== */
    // Cada equipo reserva bloques de números en la base. Así se puede
    // vender sin internet sin que dos cajas repitan número.
    pools() {
      try { return JSON.parse(localStorage.getItem(`pz-pool-${S.ctx.branchId}`)) || {}; } catch (e) { return {}; }
    },
    savePools(p) { localStorage.setItem(`pz-pool-${S.ctx.branchId}`, JSON.stringify(p)); },
    poolLeft(kind) { return (S.pools()[kind] || []).reduce((a, [s, e]) => a + (e - s + 1), 0); },

    async ensurePools() {
      if (!navigator.onLine || !S.ctx.branchId) return;
      for (const kind of ['order', 'ticket']) {
        if (S.poolLeft(kind) >= 10) continue;
        try {
          const n = 30;
          const start = await PZ.cloud.reserve(S.ctx.branchId, kind, n);
          const p = S.pools();
          p[kind] = (p[kind] || []).concat([[start, start + n - 1]]);
          S.savePools(p);
        } catch (e) { console.warn('reserve', e); }
      }
    },

    nextNumber(kind) {
      const p = S.pools();
      const blocks = p[kind] || [];
      let n;
      if (blocks.length) {
        n = blocks[0][0];
        blocks[0][0]++;
        if (blocks[0][0] > blocks[0][1]) blocks.shift();
        p[kind] = blocks;
        S.savePools(p);
      } else {
        // sin números reservados y sin internet: número provisorio único
        n = 900000 + (Math.floor(Date.now() / 1000) % 100000);
      }
      if (S.poolLeft(kind) < 10) S.ensurePools();
      return n;
    },

    /* =================== Helpers de catálogo =================== */
    category: (id) => S.data.categories.find((c) => c.id === id),
    product: (id) => S.data.products.find((p) => p.id === id),
    user: (id) => S.data.users.find((u) => u.id === id),
    customer: (id) => S.data.customers.find((c) => c.id === id),
    zone: (id) => S.data.settings.zones.find((z) => z.id === id),
    branch: (id) => S.ctx.branches.find((b) => b.id === (id || S.ctx.branchId)),
    branchName: (id) => { const b = S.branch(id); return b ? b.name : ''; },

    /** Construye una línea de pedido con precio calculado */
    makeItem({ product, variant, half = null, extras = [], qty = 1, notes = '' }) {
      let unit = variant.price;
      if (half) {
        const p2 = half.variant.price;
        unit = S.data.settings.halfPricing === 'avg' ? Math.round((unit + p2) / 2) : Math.max(unit, p2);
      }
      unit += extras.reduce((a, e) => a + (Number(e.price) || 0), 0);
      // costo teórico de mercadería según receta (para calcular ganancias)
      const cost = half
        ? Math.round((S.recipeCost(product, variant) + S.recipeCost(half.product, half.variant)) / 2)
        : S.recipeCost(product, variant);
      return {
        id: U.uid('it-'),
        productId: product.id,
        variantId: variant.id,
        variantName: product.variants.length > 1 ? variant.name : '',
        half: half ? { productId: half.product.id, name: half.product.name } : null,
        name: half ? `½ ${product.name} + ½ ${half.product.name}` : product.name,
        extras: extras.map((e) => ({ id: e.id, name: e.name, price: Number(e.price) || 0 })),
        qty,
        unitPrice: unit,
        total: unit * qty,
        cost,
        notes,
      };
    },

    /** Costo de mercadería de una unidad según la receta y el costo de los insumos */
    recipeCost(product, variant) {
      if (!product || !product.recipe || !product.recipe.length) return 0;
      const factor = (variant && variant.factor) || 1;
      return Math.round(product.recipe.reduce((a, r) => {
        const ing = S.data.ingredients.find((i) => i.id === r.ingredientId);
        if (!ing || !ing.cost) return a;
        return a + ing.cost * r.qty * (ing.unit === 'u' ? 1 : factor);
      }, 0));
    },

    /* =================== Pedidos =================== */
    computeTotals(o) {
      o.subtotal = o.items.reduce((a, it) => a + it.unitPrice * it.qty, 0);
      let disc = 0;
      if (o.discount && o.discount.value) {
        disc = o.discount.type === '%' ? Math.round((o.subtotal * o.discount.value) / 100) : Number(o.discount.value);
      }
      o.discountAmount = Math.min(disc, o.subtotal);
      o.deliveryFee = o.type === 'delivery' ? Number(o.deliveryFee) || 0 : 0;
      o.total = Math.max(0, o.subtotal - o.discountAmount + o.deliveryFee);
      return o;
    },

    /** Costo de mercadería de una línea que viene armada (pedido web) */
    itemCost(it) {
      const p = S.product(it.productId);
      const v = p && (p.variants.find((x) => x.id === it.variantId) || p.variants[0]);
      if (!it.half) return S.recipeCost(p, v);
      const p2 = S.product(it.half.productId);
      const v2 = p2 && (p2.variants.find((x) => x.id === it.variantId) || p2.variants[0]);
      return Math.round((S.recipeCost(p, v) + S.recipeCost(p2, v2)) / 2);
    },

    createOrder(draft, { paid = false, payments = [], adjust = {} } = {}) {
      const now = Date.now();
      const o = {
        id: draft.id || U.uid('o-'),
        number: S.nextNumber('order'),
        ticketNumber: null,
        createdAt: now,
        paidAt: null,
        userId: PZ.auth.current ? PZ.auth.current.id : null,
        type: draft.type || 'mostrador',
        table: draft.table || '',
        customerId: draft.customerId || null,
        customerName: draft.customerName || '',
        phone: draft.phone || '',
        address: draft.address || '',
        zoneId: draft.zoneId || null,
        items: draft.items.map((x) => ({ ...x })),
        discount: draft.discount || null,
        surcharge: 0,
        cashDiscount: 0,
        deliveryFee: draft.deliveryFee || 0,
        payments: [],
        paid: false,
        status: 'pendiente',
        statusTimes: { pendiente: now },
        driver: draft.driver || '',
        cashSessionId: null,
        notes: draft.notes || '',
        eta: draft.eta || '',
        voided: false,
        ...(draft.web ? { web: draft.web } : {}),
      };
      S.computeTotals(o);
      if (!o.customerId && (o.phone || (o.customerName && o.type === 'delivery'))) {
        const c = S.upsertCustomer({ name: o.customerName, phone: o.phone, address: o.address, zoneId: o.zoneId });
        o.customerId = c.id;
      } else if (o.customerId && o.address) {
        const c = S.customer(o.customerId);
        if (c && !c.address) c.address = o.address;
      }
      S.data.orders.push(o);
      S.applyStock(o, -1);
      if (paid) S.payOrder(o.id, payments, { silent: true, ...adjust });
      S.save();
      return o;
    },

    /** Registra el cobro (con descuento por efectivo o recargo por tarjeta si corresponde) */
    payOrder(orderId, payments, { silent = false, cashDiscount = 0, surcharge = 0 } = {}) {
      const o = S.order(orderId);
      if (!o) return null;
      const sess = S.currentSession();
      S.computeTotals(o);
      o.cashDiscount = Math.round(cashDiscount) || 0;
      o.surcharge = Math.round(surcharge) || 0;
      o.total = Math.max(0, o.total - o.cashDiscount + o.surcharge);
      o.payments = payments.map((p) => ({ ...p }));
      o.paid = true;
      o.paidAt = Date.now();
      o.ticketNumber = S.nextNumber('ticket');
      o.cashSessionId = sess ? sess.id : null;
      o.paidBy = PZ.auth.current ? PZ.auth.current.id : null;
      if (!silent) S.save();
      return o;
    },

    order: (id) => S.data.orders.find((o) => o.id === id),

    setStatus(orderId, status) {
      const o = S.order(orderId);
      if (!o) return;
      o.status = status;
      o.statusTimes = { ...(o.statusTimes || {}), [status]: Date.now() };
      S.save();
    },

    /**
     * Anula una venta. Lo hace el servidor (solo dueño o encargado), así
     * nadie puede anular editando datos. `authClient` es la sesión del
     * encargado que autorizó cuando quien opera es un cajero.
     */
    async voidOrder(orderId, reason, authClient = null) {
      const o = S.order(orderId);
      if (!o || o.voided) return o;
      if (!navigator.onLine) throw new Error('Para anular hace falta conexión a internet');
      if (!String(reason || '').trim()) throw new Error('Indicá el motivo de la anulación');
      S.diff();
      await S.flush();
      if (outbox.has(keyOf('orders', o.id))) throw new Error('La venta todavía no se sincronizó, probá en unos segundos');
      const data = await PZ.cloud.voidOrder(S.ctx.orgId, o.id, reason, authClient);
      replaceInPlace(o, { ...data, id: o.id });
      shadow.set(keyOf('orders', o.id), JSON.stringify(o));
      S.applyStock(o, +1);
      S.log('anulación', `Pedido #${o.number} anulado: ${reason}`);
      S.save();
      return o;
    },

    /**
     * Ventas de un período. Si el período es más viejo que lo guardado en el
     * equipo, las trae de la nube (sin guardarlas localmente).
     */
    async ordersInRange(from, to) {
      if (from >= S.localSince() || !navigator.onLine) return S.data.orders.filter((o) => o.createdAt >= from && o.createdAt <= to);
      const remote = await PZ.cloud.ordersRange(S.ctx.branchId, from, to);
      const byId = new Map(remote.map((o) => [o.id, o]));
      S.data.orders.forEach((o) => { if (o.createdAt >= from && o.createdAt <= to) byId.set(o.id, o); });
      return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);
    },

    log(action, detail) {
      if (!S.data) return;
      S.data.audit.unshift({ id: U.uid('lg-'), at: Date.now(), userId: PZ.auth.current ? PZ.auth.current.id : null, action, detail });
      if (S.data.audit.length > 300) S.data.audit.length = 300;
    },

    /* =================== Clientes (compartidos por todas las sucursales) =================== */
    upsertCustomer({ id, name, phone, address, zoneId, notes }) {
      const clean = (s) => String(s || '').replace(/\D/g, '');
      let c = id ? S.customer(id) : phone ? S.data.customers.find((x) => clean(x.phone) && clean(x.phone) === clean(phone)) : null;
      if (!c) {
        c = { id: U.uid('cl-'), name: name || 'Cliente', phone: phone || '', address: address || '', zoneId: zoneId || null, notes: notes || '', createdAt: Date.now(), branchId: S.ctx.branchId };
        S.data.customers.push(c);
      } else {
        if (name) c.name = name;
        if (phone) c.phone = phone;
        if (address) c.address = address;
        if (zoneId) c.zoneId = zoneId;
        if (notes !== undefined) c.notes = notes;
      }
      return c;
    },

    customerStats(cid) {
      const os = S.data.orders.filter((o) => o.customerId === cid && !o.voided);
      const total = os.reduce((a, o) => a + (o.paid ? o.total : 0), 0);
      const last = os.reduce((a, o) => Math.max(a, o.createdAt), 0);
      const fav = {};
      os.forEach((o) => o.items.forEach((it) => { fav[it.name] = (fav[it.name] || 0) + it.qty; }));
      const favName = Object.entries(fav).sort((a, b) => b[1] - a[1])[0];
      return { count: os.length, total, last, fav: favName ? favName[0] : '' };
    },

    /* =================== Caja =================== */
    currentSession: () => S.data.cashSessions.find((s) => !s.closedAt) || null,

    openSession(amount, notes = '') {
      if (S.currentSession()) return S.currentSession();
      const s = { id: U.uid('cs-'), openedAt: Date.now(), openedBy: PZ.auth.current.id, openingAmount: Number(amount) || 0, closedAt: null, notes };
      S.data.cashSessions.push(s);
      S.log('caja', `Apertura de caja con ${U.money(s.openingAmount)}`);
      S.save();
      return s;
    },

    sessionSummary(s) {
      const orders = S.data.orders.filter((o) => o.cashSessionId === s.id && o.paid);
      const valid = orders.filter((o) => !o.voided);
      const byMethod = { efectivo: 0, transferencia: 0, qr: 0, tarjeta: 0 };
      valid.forEach((o) => o.payments.forEach((p) => { byMethod[p.method] = (byMethod[p.method] || 0) + p.amount; }));
      const moves = S.data.cashMoves.filter((m) => m.sessionId === s.id);
      const ingresos = moves.filter((m) => m.type === 'ingreso').reduce((a, m) => a + m.amount, 0);
      const egresos = moves.filter((m) => m.type === 'egreso').reduce((a, m) => a + m.amount, 0);
      const sales = valid.reduce((a, o) => a + o.total, 0);
      const expectedCash = s.openingAmount + byMethod.efectivo + ingresos - egresos;
      return {
        orders: valid, voided: orders.filter((o) => o.voided), byMethod, moves, ingresos, egresos, sales, expectedCash,
        tickets: valid.length, avg: valid.length ? sales / valid.length : 0,
        discounts: valid.reduce((a, o) => a + (o.discountAmount || 0) + (o.cashDiscount || 0), 0),
        delivery: valid.reduce((a, o) => a + (o.deliveryFee || 0), 0),
      };
    },

    closeSession(counted, notes = '') {
      const s = S.currentSession();
      if (!s) return null;
      const sum = S.sessionSummary(s);
      s.closedAt = Date.now();
      s.closedBy = PZ.auth.current.id;
      s.expectedCash = sum.expectedCash;
      s.countedCash = Number(counted) || 0;
      s.diff = s.countedCash - s.expectedCash;
      s.closeNotes = notes;
      S.log('caja', `Cierre de caja. Esperado ${U.money(s.expectedCash)}, contado ${U.money(s.countedCash)}`);
      S.save();
      return s;
    },

    /** Ingreso o retiro de efectivo. Si es un gasto, además queda en Gastos. */
    addCashMove(type, amount, reason, category = '') {
      const s = S.currentSession();
      if (!s) return null;
      const m = { id: U.uid('cm-'), sessionId: s.id, type, amount: Number(amount) || 0, reason, category, at: Date.now(), userId: PZ.auth.current.id };
      S.data.cashMoves.push(m);
      if (type === 'egreso' && category) {
        S.addExpense({ category, description: reason, amount: m.amount, method: 'efectivo', source: 'caja', cashMoveId: m.id }, { silent: true });
      }
      S.save();
      return m;
    },

    /* =================== Gastos =================== */
    EXPENSE_CATEGORIES: ['Mercadería', 'Sueldos', 'Alquiler', 'Servicios', 'Impuestos', 'Delivery', 'Mantenimiento', 'Publicidad', 'Comisiones', 'Otros'],

    addExpense(e, { silent = false } = {}) {
      const x = {
        id: U.uid('gx-'), at: e.at || Date.now(), category: e.category || 'Otros', description: e.description || '',
        amount: Math.round(Number(e.amount) || 0), method: e.method || 'efectivo', supplier: e.supplier || '',
        employeeId: e.employeeId || '', source: e.source || 'manual', cashMoveId: e.cashMoveId || '',
        userId: PZ.auth.current ? PZ.auth.current.id : null, demo: !!e.demo,
      };
      S.data.expenses.unshift(x);
      if (!silent) S.save();
      return x;
    },

    /** Ingresos, costo de mercadería, gastos y resultado de la sucursal en un período */
    profit(from, to) {
      const orders = S.data.orders.filter((o) => o.paid && !o.voided && o.paidAt >= from && o.paidAt <= to);
      const sales = orders.reduce((a, o) => a + o.total, 0);
      const cogs = orders.reduce((a, o) => a + o.items.reduce((x, i) => x + (i.cost || 0) * i.qty, 0), 0);
      const exps = S.data.expenses.filter((e) => e.at >= from && e.at <= to);
      const byCat = {};
      exps.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
      const expenses = exps.reduce((a, e) => a + e.amount, 0);
      return { orders, sales, cogs, expenses, byCat, exps, result: sales - expenses, margin: sales ? (sales - expenses) / sales : 0 };
    },

    /** Rendimiento de cada persona de la sucursal en un período */
    employeeStats(from, to) {
      const map = {};
      const get = (id) => (map[id] = map[id] || { id, sales: 0, tickets: 0, discounts: 0, voids: 0, voidAmount: 0, closes: 0, absDiff: 0, diff: 0, salary: 0 });
      S.data.orders.forEach((o) => {
        if (o.paid && !o.voided && o.paidAt >= from && o.paidAt <= to) {
          const r = get(o.paidBy || o.userId);
          r.sales += o.total; r.tickets++; r.discounts += (o.discountAmount || 0) + (o.cashDiscount || 0);
        }
        if (o.voided && o.voidedAt >= from && o.voidedAt <= to && o.voidedBy) { const r = get(o.voidedBy); r.voids++; r.voidAmount += o.total; }
      });
      S.data.cashSessions.forEach((s) => {
        if (s.closedAt && s.closedAt >= from && s.closedAt <= to && s.closedBy) { const r = get(s.closedBy); r.closes++; r.absDiff += Math.abs(s.diff || 0); r.diff += s.diff || 0; }
      });
      S.data.expenses.forEach((e) => { if (e.category === 'Sueldos' && e.employeeId && e.at >= from && e.at <= to) get(e.employeeId).salary += e.amount; });
      return map;
    },

    /* =================== Stock (por sucursal) =================== */
    applyStock(o, sign) {
      o.items.forEach((it) => {
        const parts = it.half ? [[it.productId, 0.5, false], [it.half.productId, 0.5, true]] : [[it.productId, 1, false]];
        parts.forEach(([pid, share, second]) => {
          const p = S.product(pid);
          if (!p || !p.recipe || !p.recipe.length) return;
          const v = p.variants.find((x) => x.id === it.variantId) || p.variants[0];
          const factor = (v && v.factor) || 1;
          p.recipe.forEach((r) => {
            const ing = S.data.ingredients.find((i) => i.id === r.ingredientId);
            if (!ing) return;
            // las unidades (cajas) no se dividen en mitades ni por tamaño
            const q = ing.unit === 'u' ? (second ? 0 : r.qty * it.qty) : r.qty * factor * share * it.qty;
            ing.stock = Math.round((ing.stock + sign * q) * 1000) / 1000;
          });
        });
      });
    },

    stockMove(ingredientId, delta, reason) {
      const ing = S.data.ingredients.find((i) => i.id === ingredientId);
      if (!ing) return;
      ing.stock = Math.round((ing.stock + Number(delta)) * 1000) / 1000;
      S.data.stockMoves.unshift({ id: U.uid('sm-'), ingredientId, delta: Number(delta), reason, at: Date.now(), userId: PZ.auth.current.id });
      if (S.data.stockMoves.length > 500) S.data.stockMoves.length = 500;
      S.save();
    },

    lowStock: () => S.data.ingredients.filter((i) => i.stock <= i.min),

    /* =================== Datos iniciales y demo =================== */
    /**
     * Sucursal sin menú: copia el menú modelo del negocio; si no hay modelo,
     * carga el de ejemplo y lo guarda como modelo.
     */
    async seedIfEmpty({ customers = false, example = true } = {}) {
      let changed = false;
      if (!S.data.categories.length && PZ.auth.isAdmin()) {
        let model = null;
        try { model = await PZ.cloud.menuModel(S.ctx.orgId); } catch (e) { /* sin conexión */ }
        if ((!model || !(model.categories || []).length) && !example) return false;
        const c = model && model.categories && model.categories.length ? JSON.parse(JSON.stringify(model)) : PZ.seed.catalog();
        S.data.categories = c.categories;
        S.data.products = c.products;
        S.data.extras = c.extras;
        if (!(model && (model.categories || []).length) && PZ.auth.isOwner()) PZ.cloud.saveMenuModel(S.ctx.orgId, c).catch(() => {});
        if (customers && !S.data.customers.length) S.data.customers = PZ.seed.customers();
        changed = true;
      }
      if (!S.data.ingredients.length && PZ.auth.isAdmin()) {
        S.data.ingredients = PZ.seed.ingredients(true);
        changed = true;
      }
      if (changed) S.save();
      return changed;
    },

    async clearDemo() {
      S.diff();
      await S.flush();
      const { error } = await PZ.cloud.sb.rpc('clear_demo', { p_branch: S.ctx.branchId });
      if (error) throw error;
      S.data.orders = S.data.orders.filter((o) => !o.demo);
      S.data.cashSessions = S.data.cashSessions.filter((s) => !s.demo);
      S.data.cashMoves = S.data.cashMoves.filter((m) => !m.demo);
      S.data.expenses = S.data.expenses.filter((x) => !x.demo);
      S.rebuildShadow();
      S.data.demo = false;
      S.log('sistema', 'Se borraron las ventas de demostración');
      S.save();
    },

    /** Respaldo descargable de la sucursal (además de lo que ya está en la nube) */
    exportBackup() {
      return JSON.stringify({ exportedAt: new Date().toISOString(), org: S.ctx.org, branch: S.branch(), data: S.data });
    },

    deepMerge: (a, b) => deepMerge(a, b),
  });

  function queue(key, op) {
    const prev = outbox.get(key);
    if (!prev || op.del || prev.del || op.name === 'settings') outbox.set(key, op);
    else prev.patch = { ...prev.patch, ...op.patch };
  }

  function sortCol(name, arr) {
    const cfg = COLS[name];
    if (cfg.ordered) return arr.sort((a, b) => (a._i ?? 1e9) - (b._i ?? 1e9));
    if (cfg.sort) return arr.sort(cfg.sort);
    return arr;
  }

  function replaceInPlace(target, next) {
    Object.keys(target).forEach((k) => { if (!(k in next)) delete target[k]; });
    Object.assign(target, next);
  }

  function deepMerge(base, over) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const k of Object.keys(over || {})) {
      const bv = base ? base[k] : undefined;
      const ov = over[k];
      out[k] = bv && typeof bv === 'object' && !Array.isArray(bv) && ov && typeof ov === 'object' && !Array.isArray(ov) ? deepMerge(bv, ov) : ov;
    }
    return out;
  }
})(window.PZ);
