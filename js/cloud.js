// @ts-check
/* ==========================================================================
   PZ.cloud — todo lo que habla con Supabase: sesión, lectura, escritura,
   tiempo real, numeración y estadísticas del negocio.
   ========================================================================== */
(function (PZ) {
  const CFG = window.PZ_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pz-auth' },
    realtime: { params: { eventsPerSecond: 20 } },
  });

  const toEmail = (u) => {
    u = String(u || '').trim().toLowerCase();
    return u.includes('@') ? u : `${u}@${CFG.staffDomain}`;
  };

  const C = (PZ.cloud = {
    sb,
    online: navigator.onLine,
    /** @type {any} */
    channel: null,
    /** estado del tiempo real ('SUBSCRIBED', …) @type {string} */
    realtime: '',
    /** errores ya reportados (para no inundar el registro) @type {Map<string, number>} */
    _reported: new Map(),

    /* ---------------- Sesión ---------------- */
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session;
    },

    async signIn(user, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email: toEmail(user), password });
      if (error) {
        if (!navigator.onLine) throw new Error('Sin conexión. Para el primer ingreso hace falta internet.');
        throw new Error(/invalid/i.test(error.message) ? 'Usuario o contraseña incorrectos' : error.message);
      }
      return data.session;
    },

    async signOut() {
      try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* sin conexión: igual se borra local */ }
      C.unsubscribe();
    },

    /** Verifica credenciales de otra persona sin tocar la sesión actual */
    async verifyOther(user, password) {
      const tmp = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'pz-auth-tmp' },
      });
      const { data, error } = await tmp.auth.signInWithPassword({ email: toEmail(user), password });
      if (error) return null;
      const uid = data.user.id;
      const { data: m } = await tmp.from('members').select('role, active, branch_ids, org_id').eq('user_id', uid);
      // La sesión temporal queda abierta para firmar la acción autorizada;
      // se cierra con PZ.auth.release().
      return { client: tmp, members: m || [] };
    },

    async updateMyPassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw new Error(error.message);
    },

    /** Canje de código de sucursal (público). check=true solo valida. */
    async join(payload) {
      const res = await fetch(`${CFG.supabaseUrl}/functions/v1/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: `Bearer ${CFG.supabaseKey}` },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'No se pudo usar el código');
      return out;
    },

    async invoke(fn, body) {
      const { data, error } = await sb.functions.invoke(fn, { body });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); if (j.error) msg = j.error; } catch (e) { /* noop */ }
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    },

    staff(action, body) { return C.invoke('staff', { action, org_id: PZ.store.ctx.orgId, ...body }); },
    platform(action, body) { return C.invoke('platform', { action, ...body }); },

    async isPlatformAdmin() {
      const s = await C.session();
      if (!s) return false;
      const { data } = await sb.from('platform_admins').select('user_id').eq('user_id', s.user.id).maybeSingle();
      return !!data;
    },

    async platformOrgs() {
      const { data, error } = await sb.rpc('platform_orgs');
      if (error) throw error;
      return data || [];
    },

    async updateOrg(orgId, patch) {
      const { error } = await sb.from('organizations').update(patch).eq('id', orgId);
      if (error) throw error;
    },

    /* ---------------- Invitaciones ---------------- */
    async createInvite(branchId, role, days = 7, note = '') {
      const { data, error } = await sb.rpc('create_invite', { p_branch: branchId, p_role: role, p_days: days, p_note: note });
      if (error) throw error;
      return data;
    },
    async invites(orgId) {
      const { data, error } = await sb.from('invites').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data || [];
    },
    async revokeInvite(code) {
      const { error } = await sb.from('invites').update({ revoked: true }).eq('code', code);
      if (error) throw error;
    },

    /* ---------------- Menú modelo y menú de sucursales ---------------- */
    async menuModel(orgId) {
      const { data } = await sb.from('docs').select('data').eq('org_id', orgId).eq('col', 'menu_model').eq('id', 'model').maybeSingle();
      return data ? data.data : null;
    },
    async saveMenuModel(orgId, model) {
      await C.upsertDocs([{ org_id: orgId, col: 'menu_model', id: 'model', branch_id: '', data: { ...model, updatedAt: Date.now() } }]);
    },
    async branchMenu(orgId, branchId) {
      const { data, error } = await sb.from('docs').select('col, id, data').eq('org_id', orgId).eq('branch_id', branchId).in('col', ['category', 'product', 'extra']);
      if (error) throw error;
      /** @type {Record<string, any[]>} */
      const out = { categories: [], products: [], extras: [] };
      const key = { category: 'categories', product: 'products', extra: 'extras' };
      (data || []).forEach((r) => out[key[r.col]].push({ ...r.data, id: r.id.slice(r.id.indexOf('/') + 1) }));
      Object.values(out).forEach((a) => a.sort((x, y) => (x._i ?? 0) - (y._i ?? 0)));
      return out;
    },
    /** Escribe un menú completo en una sucursal. replace=true borra lo que no esté en el menú nuevo. */
    async writeBranchMenu(orgId, branchId, menu, { replace = false } = {}) {
      const rows = [];
      const push = (col, arr) => arr.forEach((x, i) => rows.push({ org_id: orgId, col, id: `${branchId}/${x.id}`, branch_id: branchId, data: { ...x, _i: i } }));
      push('category', menu.categories || []);
      push('product', menu.products || []);
      push('extra', menu.extras || []);
      if (replace) {
        const cur = await C.branchMenu(orgId, branchId);
        const keep = new Set(rows.map((r) => r.col + ':' + r.id));
        const colOf = { categories: 'category', products: 'product', extras: 'extra' };
        for (const [k, arr] of Object.entries(cur)) {
          for (const x of arr) {
            if (!keep.has(colOf[k] + ':' + `${branchId}/${x.id}`)) await C.deleteDoc(orgId, colOf[k], `${branchId}/${x.id}`);
          }
        }
      }
      await C.upsertDocs(rows);
    },

    async finance(orgId, from, to) {
      const { data, error } = await sb.rpc('org_finance', { p_org: orgId, p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
      if (error) throw error;
      return data;
    },

    /* ---------------- Perfiles ---------------- */
    async myProfile() {
      const s = await C.session();
      if (!s) return null;
      const { data } = await sb.from('profiles').select('*').eq('user_id', s.user.id).maybeSingle();
      return data || { user_id: s.user.id };
    },
    async profiles(userIds) {
      if (!userIds.length) return {};
      const { data, error } = await sb.from('profiles').select('*').in('user_id', userIds);
      if (error) throw error;
      return Object.fromEntries((data || []).map((p) => [p.user_id, p]));
    },
    async saveProfile(patch) {
      const s = await C.session();
      const { error } = await sb.from('profiles').upsert({ user_id: s.user.id, ...patch, updated_at: new Date().toISOString() });
      if (error) throw new Error(/cuil/i.test(error.message) ? 'CUIL inválido' : error.message);
    },
    /** Sube la foto (ya reducida) y devuelve la URL pública */
    async uploadAvatar(blob) {
      const s = await C.session();
      const path = `${s.user.id}/avatar-${Date.now()}.jpg`;
      const { error } = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;
      return sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    },
    changeEmail(email) { return C.invoke('profile', { action: 'change_email', email }); },

    /* ---------------- Carta online y Sucursales ---------------- */
    /** Actualiza datos de una sucursal (nombre, slug, settings, active) */
    async updateBranch(branchId, patch) {
      const { data, error } = await sb.from('branches').update(patch).eq('id', branchId).select().single();
      if (error) throw error;
      return data;
    },
    /** Borra una sucursal y todos sus datos relacionados (solo dueño/admin, si no es la única) */
    async deleteBranch(branchId) {
      const { error } = await sb.rpc('delete_branch', { p_branch: branchId });
      if (error) throw error;
      return true;
    },
    /** Dirección pública de la sucursal (carta.html?l=slug). null la quita. */
    async setSlug(branchId, slug) {
      const { error } = await sb.from('branches').update({ slug: slug || null }).eq('id', branchId);
      if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Esa dirección ya la usa otro local, probá con otra' : /slug_chk|check/i.test(error.message) ? 'Usá solo letras minúsculas, números y guiones (3 a 40)' : error.message);
    },
    /**
     * Sube una foto del menú (producto, logo o portada) y devuelve la URL pública.
     * Cada archivo tiene nombre único, así que el celular del cliente puede
     * guardarlo un año sin volver a bajarlo.
     */
    async uploadMenuImage(blob, name) {
      const { orgId, branchId } = PZ.store.ctx;
      const path = `${orgId}/${branchId}/${String(name).replace(/[^a-z0-9-]/gi, '')}-${Date.now()}.jpg`;
      const { error } = await sb.storage.from('menu').upload(path, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' });
      if (error) throw new Error(error.message);
      return sb.storage.from('menu').getPublicUrl(path).data.publicUrl;
    },
    /** ¿La foto está guardada en nuestro almacenamiento? (las de otros sitios no se tocan) */
    isMenuImage(url) {
      return !!url && String(url).startsWith(sb.storage.from('menu').getPublicUrl('').data.publicUrl);
    },
    /** De estas fotos, las que ya no usa ningún producto, menú modelo ni sucursal del negocio */
    async unusedMenuImages(urls) {
      const { data, error } = await sb.rpc('menu_images_unused', { p_org: PZ.store.ctx.orgId, p_urls: urls });
      if (error) throw error;
      return /** @type {string[]} */ (data || []);
    },
    /** Borra fotos propias del almacenamiento */
    async deleteMenuImages(urls) {
      const base = sb.storage.from('menu').getPublicUrl('').data.publicUrl;
      const paths = urls.filter((u) => C.isMenuImage(u)).map((u) => decodeURIComponent(u.slice(base.length).split('?')[0]));
      if (!paths.length) return;
      const { error } = await sb.storage.from('menu').remove(paths);
      if (error) throw error;
    },
    /** Pedidos web: los que esperan confirmación y los de las últimas horas */
    async webOrders(branchId) {
      const since = new Date(Date.now() - 12 * 36e5).toISOString();
      const { data, error } = await sb.from('online_orders').select('*').eq('branch_id', branchId)
        .or(`status.eq.nuevo,created_at.gte."${since}"`).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data || [];
    },
    /** Aceptar o rechazar. Solo cambia si nadie lo atendió antes (devuelve null si ya estaba atendido). */
    async handleWebOrder(id, patch) {
      const { data, error } = await sb.from('online_orders').update(patch).eq('id', id).eq('status', 'nuevo').select().maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    /** Aceptación idempotente: el servidor crea la comanda en la misma transacción. */
    async acceptWebOrder(id, orderId) {
      const { data, error } = await sb.rpc('accept_online_order', { p_id: id, p_order_id: orderId });
      if (error) throw new Error(error.message);
      return data;
    },

    /* ---------------- Mercado Pago ---------------- */
    mp(action, body = {}) {
      return C.invoke('mp', { action, org_id: PZ.store.ctx.orgId, branch_id: PZ.store.ctx.branchId, ...body });
    },

    /* ---------------- Ventas ---------------- */
    /** Anula en el servidor (solo dueño o encargado). client = sesión del encargado que autorizó. */
    async voidOrder(orgId, id, reason, client) {
      const { data, error } = await (client || sb).rpc('void_order', { p_org: orgId, p_id: id, p_reason: reason });
      if (error) throw new Error(error.message);
      return data;
    },
    /** Ventas de un período que no está en el equipo (historial viejo) */
    async ordersRange(branchId, from, to) {
      let out = [];
      const since = new Date(from - 864e5).toISOString();
      const until = new Date(to + 864e5).toISOString();
      for (let i = 0; ; i += 1000) {
        const { data, error } = await sb.from('orders').select('id, data').eq('branch_id', branchId)
          .gte('created_at', since).lte('created_at', until)
          .order('created_at').range(i, i + 999);
        if (error) throw error;
        out = out.concat(data.map((r) => ({ ...r.data, id: r.id })));
        if (data.length < 1000) break;
      }
      return out;
    },

    /* ---------------- Registro de errores ---------------- */
    async reportError(message, { stack = '', context = '' } = {}) {
      const key = String(message).slice(0, 200);
      const n = C._reported.get(key) || 0;
      if (n >= 2 || C._reported.size > 25) return; // no inundar
      C._reported.set(key, n + 1);
      const row = {
        message: String(message).slice(0, 1000), stack: String(stack || '').slice(0, 4000), context: String(context || '').slice(0, 500),
        url: location.href.slice(0, 500), user_agent: navigator.userAgent.slice(0, 300), version: CFG.version,
        org_id: PZ.store && PZ.store.ctx.orgId, branch_id: PZ.store && PZ.store.ctx.branchId,
      };
      try { await sb.from('client_errors').insert(row); } catch (e) { /* sin conexión: se pierde, no importa */ }
    },
    async errors(limit = 150) {
      const { data, error } = await sb.from('client_errors').select('*').order('at', { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    },

    /** Tiempo real a nivel negocio (panel del dueño) */
    subscribeOrg(orgId, onEvent) {
      C.unsubscribe();
      C.channel = sb.channel(`org-panel-${orgId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `org_id=eq.${orgId}` }, () => onEvent('orders'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'branches', filter: `org_id=eq.${orgId}` }, () => onEvent('branches'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `org_id=eq.${orgId}` }, () => onEvent('members'))
        .subscribe((status) => { C.realtime = status; PZ.store && PZ.store.emitStatus(); });
    },

    /* ---------------- Lectura ---------------- */
    async memberships() {
      const s = await C.session();
      if (!s) return [];
      const { data, error } = await sb.from('members').select('*, organizations(id, name, owner_id, status, features)').eq('user_id', s.user.id).eq('active', true);
      if (error) throw error;
      return (data || []).filter((m) => m.organizations);
    },

    async orgMeta(orgId) {
      const [br, mem, org] = await Promise.all([
        sb.from('branches').select('*').eq('org_id', orgId).order('created_at'),
        sb.from('members').select('*').eq('org_id', orgId).order('created_at'),
        sb.from('organizations').select('*').eq('id', orgId).single(),
      ]);
      if (br.error) throw br.error;
      if (mem.error) throw mem.error;
      return { branches: br.data, members: mem.data, org: org.data };
    },

    /** Trae todo lo que necesita una sucursal para operar */
    async branchData(orgId, branchId, days = 120) {
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const all = async (q) => {
        // pagina de a 1000 (límite de la API)
        let out = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await q().range(from, from + 999);
          if (error) throw error;
          out = out.concat(data);
          if (data.length < 1000) break;
        }
        return out;
      };
      const [docs, orders, active, branch] = await Promise.all([
        all(() => sb.from('docs').select('col, id, branch_id, data').eq('org_id', orgId).eq('branch_id', branchId).order('col').order('id')),
        all(() => sb.from('orders').select('id, data').eq('branch_id', branchId).gte('created_at', since).order('created_at')),
        sb.from('orders').select('id, data').eq('branch_id', branchId).lt('created_at', since).not('status', 'in', '(entregado,cancelado)').eq('voided', false),
        sb.from('branches').select('*').eq('id', branchId).single(),
      ]);
      if (branch.error) throw branch.error;
      return { docs, orders: orders.concat(active.data || []), branch: branch.data };
    },

    async reserve(branchId, kind, count) {
      const { data, error } = await sb.rpc('reserve_numbers', { p_branch: branchId, p_kind: kind, p_count: count });
      if (error) throw error;
      return Number(data);
    },

    async report(orgId, from, to) {
      const { data, error } = await sb.rpc('org_report', { p_org: orgId, p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
      if (error) throw error;
      return data;
    },

    async live(orgId) {
      const { data, error } = await sb.rpc('branches_live', { p_org: orgId });
      if (error) throw error;
      return data;
    },

    /* ---------------- Escritura ---------------- */
    async upsertDocs(rows) {
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await sb.rpc('upsert_docs', { p_rows: rows.slice(i, i + 200) });
        if (error) throw error;
      }
    },
    async upsertOrders(rows) {
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await sb.rpc('upsert_orders', { p_rows: rows.slice(i, i + 200) });
        if (error) throw error;
      }
    },
    async deleteDoc(orgId, col, id) {
      const { error } = await sb.rpc('delete_doc', { p_org: orgId, p_col: col, p_id: id });
      if (error) throw error;
    },
    async saveSettings(branchId, settings) {
      const { error } = await sb.from('branches').update({ settings }).eq('id', branchId);
      if (error) throw error;
    },

    /* ---------------- Tiempo real ---------------- */
    subscribe(orgId, branchId, onEvent) {
      C.unsubscribe();
      C.channel = sb.channel(`org-${orgId}-${branchId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: `org_id=eq.${orgId}` }, (p) => onEvent('docs', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, (p) => onEvent('orders', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'branches', filter: `org_id=eq.${orgId}` }, (p) => onEvent('branches', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `org_id=eq.${orgId}` }, (p) => onEvent('members', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'online_orders', filter: `branch_id=eq.${branchId}` }, (p) => PZ.web && PZ.web.onRemote(p))
        .subscribe((status) => { C.realtime = status; PZ.store && PZ.store.emitStatus(); });
    },
    unsubscribe() {
      if (C.channel) { sb.removeChannel(C.channel); C.channel = null; }
    },
  });

  // Errores no controlados de la app → registro para el panel de plataforma
  window.addEventListener('error', (e) => {
    if (!e.message || /ResizeObserver|Script error/i.test(e.message)) return;
    C.reportError(e.message, { stack: e.error && e.error.stack, context: `${e.filename || ''}:${e.lineno || ''}` });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason || {};
    const msg = r.message || String(r);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return; // cortes de internet: no son errores de la app
    C.reportError(msg, { stack: r.stack, context: 'promesa sin manejar' });
  });

  window.addEventListener('online', () => {
    C.online = true;
    if (PZ.store) PZ.store.onOnline();
    if (PZ.web && PZ.store && PZ.store.ctx.branchId) PZ.web.load();
  });
  window.addEventListener('offline', () => { C.online = false; PZ.store && PZ.store.emitStatus(); });
})(window.PZ);
