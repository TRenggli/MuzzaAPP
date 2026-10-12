// @ts-check
/* ==========================================================================
   PZ.inbox — panel de avisos en tiempo real de cada usuario

   · Los avisos del negocio los crea el SERVIDOR (disparadores de la base) y cada uno lleva a qué roles
     o a qué persona va. Quién puede leer qué lo decide la base (RLS) con el rol y las sucursales de la
     persona: un cajero nunca recibe el resumen de facturación del dueño ni las diferencias de caja,
     ni por la consulta ni por el tiempo real. Esta pantalla solo muestra lo que llega.
   · Los avisos del propio equipo (cambio rechazado, caja a la que se sumó, sin conexión en vivo…) se
     guardan en este equipo y no viajan a ningún lado.
   · El historial es de 30 días y lo leído se recuerda por persona (en la nube).
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const DAYS = 30;
  const LOCAL_KEEP = 40;
  const LOCAL_DAYS = 7;

  /** categoría de cada tipo de aviso (para filtrar) */
  const catOf = (kind) => {
    if (/^summary_/.test(kind)) return 'resumen';
    if (/^cash_|^discount_/.test(kind)) return 'caja';
    if (/^sync_|^stock_|^trial_|^demo_/.test(kind)) return 'alerta';
    return 'ops';
  };
  const CATS = [['all', 'Todos'], ['ops', 'Operación'], ['caja', 'Caja'], ['alerta', 'Alertas'], ['resumen', 'Resúmenes']];

  /** ¿Merece una alerta en pantalla apenas llega? (lo demás solo suma al contador) */
  const isLoud = (it) => ['order_void', 'cash_late', 'discount_big', 'trial_deadline', 'demo_lead'].includes(it.kind) || (it.kind === 'cash_close' && Number(it.data && it.data.diff) !== 0);

  /** @param {any} r fila de la tabla notifications */
  const fromRow = (r) => ({
    id: r.id, branchId: r.branch_id || null, kind: r.kind, title: r.title, body: r.body || '', data: r.data || {},
    at: Date.parse(r.created_at), local: false, read: false,
  });

  /** @type {any} */
  const I = (PZ.inbox = {
    orgId: /** @type {string | null} */ (null),
    /** avisos del negocio que llegaron de la nube (más nuevo primero) @type {any[]} */
    items: [],
    /** avisos de este equipo @type {any[]} */
    local: [],
    /** hasta cuándo leyó esta persona (ms) */
    readUntil: 0,
    loaded: false,
    filter: 'all',
    /** @type {Set<() => void>} */
    _fns: new Set(),
    /** @type {Promise<void> | null} */
    _loading: null,

    CATS, catOf, isLoud,

    onChange(fn) { I._fns.add(fn); return () => I._fns.delete(fn); },
    emit() {
      I._fns.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
      I.paintBell();
    },

    /* ------------------------------------------------------------ carga */
    /** Abre el panel de esta persona para un negocio (se llama al entrar a una sucursal o al panel del negocio) */
    start(orgId) {
      if (I.orgId === orgId && (I.loaded || I._loading)) return I._loading || I.refresh();
      I.stop();
      I.orgId = orgId;
      I.local = readLocal();
      if (orgId && (orgId.startsWith('org-demo') || orgId === 'platform')) {
        I.items = [];
        I.loaded = true;
        I.emit();
        return Promise.resolve();
      }
      I._loading = (async () => {
        try {
          const [rows, state] = await Promise.all([
            PZ.cloud.notifications(orgId, new Date(Date.now() - DAYS * 864e5).toISOString()),
            PZ.cloud.notificationState(orgId),
          ]);
          I.items = rows.map(fromRow).sort((a, b) => b.at - a.at);
          if (state) I.readUntil = Date.parse(state);
          else {
            // primera vez de esta persona: no se le muestra todo el historial como "sin leer"
            I.readUntil = Date.now();
            PZ.cloud.markNotificationsRead(orgId, new Date(I.readUntil).toISOString()).catch(() => {});
          }
          I.loaded = true;
        } catch (e) {
          console.warn('avisos', e);
        } finally { I._loading = null; I.emit(); }
      })();
      return I._loading;
    },

    stop() {
      I.orgId = null; I.items = []; I.local = []; I.readUntil = 0; I.loaded = false; I._loading = null;
      I.emit();
    },

    /** Pide lo que llegó mientras no estaba el tiempo real (corte, pantalla oculta, resúmenes de la mañana) */
    async refresh() {
      if (!I.orgId || !I.loaded || !navigator.onLine) return;
      const newest = I.items.reduce((m, x) => Math.max(m, x.at), 0);
      try {
        const rows = await PZ.cloud.notifications(I.orgId, new Date(Math.max(0, newest - 60000)).toISOString());
        let fresh = 0;
        rows.forEach((r) => { if (I._add(fromRow(r), true)) fresh++; });
        if (fresh) I.emit();
      } catch (e) { /* sin conexión: queda para la próxima */ }
    },

    /** Un aviso nuevo llegó en vivo (o se borró uno viejo) @param {{ eventType: string, new?: any, old?: any }} p */
    onRemote(p) {
      if (!I.loaded) return;
      if (p.eventType === 'DELETE') {
        const id = p.old && p.old.id;
        if (id) { I.items = I.items.filter((x) => x.id !== id); I.emit(); }
        return;
      }
      if (!p.new || !p.new.id || p.new.org_id !== I.orgId) return;
      const it = fromRow(p.new);
      if (I._add(it, false)) { I.emit(); I._arrived(it); }
    },

    /** @returns {boolean} true si era nuevo */
    _add(it, quiet) {
      if (I.items.some((x) => x.id === it.id)) return false;
      I.items.push(it);
      I.items.sort((a, b) => b.at - a.at);
      if (quiet && it.at > I.readUntil && isLoud(it) && Date.now() - it.at < 120000) I._arrived(it);
      return true;
    },

    /** Alerta en pantalla de lo importante (el resto solo suma al contador de la campana) */
    _arrived(it) {
      if (!isLoud(it) || it.at <= I.readUntil) return;
      const first = String(it.body).split('\n')[0];
      PZ.toast(`${it.title}${first ? ' · ' + first : ''}`, 'warn', 7000);
      if (typeof document !== 'undefined' && document.hidden && PZ.notify) PZ.notify(it.title, { body: first, tag: 'pz-inbox-' + it.id });
    },

    /* ------------------------------------------------------------ avisos de este equipo */
    /**
     * Anota un aviso del propio equipo (no viaja a la nube).
     * @param {string} kind sync_conflict | sync_cash | sync_live | sync_catchup | sync_race
     * @param {{ action?: string, view?: string }} [data]
     */
    notifyLocal(kind, title, body = '', data = {}) {
      const it = { id: 'l-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), branchId: null, kind, title, body, data, at: Date.now(), local: true, read: false };
      I.local.unshift(it);
      I.local = I.local.slice(0, LOCAL_KEEP);
      saveLocal();
      I.emit();
      return it;
    },

    /* ------------------------------------------------------------ lectura */
    all() { return I.items.concat(I.local).sort((a, b) => b.at - a.at); },
    isUnread(it) { return it.local ? !it.read : it.at > I.readUntil; },
    unreadCount() { return I.all().filter((it) => I.isUnread(it)).length; },

    async markAllRead() {
      const newest = I.items.reduce((m, x) => Math.max(m, x.at), 0);
      if (newest > I.readUntil) {
        I.readUntil = newest;
        if (I.orgId) PZ.cloud.markNotificationsRead(I.orgId, new Date(newest).toISOString()).catch((e) => console.warn('avisos leídos', e));
      }
      I.local.forEach((x) => { x.read = true; });
      saveLocal();
      I.emit();
    },

    /* ------------------------------------------------------------ pantalla */
    paintBell() {
      if (typeof document === 'undefined') return;
      const n = I.unreadCount();
      document.querySelectorAll('.bell-count').forEach((el) => {
        el.textContent = n > 99 ? '99+' : String(n);
        el.classList.toggle('hidden', !n);
      });
    },

    /** Lleva a la pantalla de lo que habla el aviso */
    async go(it) {
      const A = PZ.auth;
      const app = PZ.app;
      if (it.data && it.data.action === 'trial_renew') {
        const text = `Hola, mi demo de MuzzaAPP vence pronto y quiero coordinar el pago de mi plan para mantener mi sistema activo.`;
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
        return;
      }
      if (it.data && it.data.action === 'lead_wa' && it.data.phone) {
        const text = `Hola, te escribo de MuzzaAPP por tu solicitud de prueba de 30 días. ¿Cómo estás?`;
        window.open('https://wa.me/' + U.phoneForWa(it.data.phone) + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
        return;
      }
      if (it.data && it.data.action === 'sync') return app.syncInfo();
      const v = it.data && it.data.view;
      if (!v || !PZ.views[v]) return;
      if (v.startsWith('n-')) { if (A.isOwner()) location.hash = '#/' + v; return; }
      const mine = it.branchId && app.allowedBranches().some((b) => b.id === it.branchId);
      if (mine && (app.mode !== 'branch' || it.branchId !== PZ.store.ctx.branchId)) await app.openBranch(it.branchId);
      if (A.can(v)) location.hash = '#/' + v;
    },

    /** Abre el panel */
    open() {
      const S = PZ.store;
      const day = (at) => {
        const d = U.dayKey(at);
        if (d === U.dayKey(Date.now())) return 'Hoy';
        if (d === U.dayKey(Date.now() - 864e5)) return 'Ayer';
        return U.date(at);
      };
      const ago = (at) => {
        const m = Math.floor((Date.now() - at) / 60000);
        return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 360 ? `hace ${Math.floor(m / 60)} h` : U.time(at);
      };
      const m = PZ.modal({
        title: '🔔 Avisos',
        size: 'md',
        body: '<div class="nt-wrap"></div>',
        footer: '<button class="btn ghost" data-a="read">Marcar todo como leído</button><button class="btn primary" data-a="x">Cerrar</button>',
        onClose: () => off(),
      });
      const box = /** @type {HTMLElement} */ (m.el.querySelector('.nt-wrap'));
      const draw = () => {
        const scroller = /** @type {HTMLElement | null} */ (m.el.querySelector('.modal-body'));
        const scroll = scroller ? scroller.scrollTop : 0;
        const all = I.all();
        const counts = Object.fromEntries(CATS.map(([id]) => [id, id === 'all' ? all.length : all.filter((x) => catOf(x.kind) === id).length]));
        if (I.filter !== 'all' && !counts[I.filter]) I.filter = 'all';
        const list = all.filter((x) => I.filter === 'all' || catOf(x.kind) === I.filter);
        const multi = S.ctx.branches.length > 1;
        let last = '';
        box.innerHTML = `
          <div class="seg nt-cats">${CATS.filter(([id]) => id === 'all' || counts[id]).map(([id, label]) => `<button data-c="${id}" class="${I.filter === id ? 'on' : ''}">${label}</button>`).join('')}</div>
          ${list.length ? list.map((it) => {
            const head = day(it.at);
            const h = head !== last ? `<div class="nt-day">${U.esc(head)}</div>` : '';
            last = head;
            const where = it.local ? '<span class="nt-chip">💻 Este equipo</span>'
              : it.branchId ? (multi ? `<span class="nt-chip">🏪 ${U.esc(S.branchName(it.branchId) || '')}</span>` : '')
              : '<span class="nt-chip">🏢 Todo el negocio</span>';
            return `${h}<button class="nt-item ${I.isUnread(it) ? 'unread' : ''}" data-id="${U.esc(it.id)}">
              <div class="nt-top"><b class="nt-title">${U.esc(it.title)}</b><span class="nt-time">${ago(it.at)}</span></div>
              ${it.body ? `<div class="nt-body">${U.esc(it.body).replace(/\n/g, '<br>')}</div>` : ''}${where}
            </button>`;
          }).join('') : '<div class="empty"><span class="e-ico">🍃</span>No hay avisos para vos todavía</div>'}
          <p class="small muted" style="margin:10px 0 0">Solo ves los avisos que corresponden a tu rol. Se guardan 30 días.</p>`;
        box.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { I.filter = /** @type {HTMLElement} */ (b).dataset.c || 'all'; draw(); }));
        box.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => {
          const it = I.all().find((x) => x.id === /** @type {HTMLElement} */ (b).dataset.id);
          if (!it) return;
          m.close();
          I.go(it);
        }));
        if (scroller) scroller.scrollTop = scroll;
      };
      const off = I.onChange(draw);
      /** @type {HTMLElement} */ (m.el.querySelector('[data-a=x]')).onclick = () => m.close();
      /** @type {HTMLElement} */ (m.el.querySelector('[data-a=read]')).onclick = () => I.markAllRead();
      draw();
      // abrir el panel cuenta como "visto" lo que ya está en pantalla
      setTimeout(() => { if (document.body.contains(m.el)) I.markAllRead(); }, 4000);
    },
  });

  /* ---------------- avisos de este equipo: guardados por persona ---------------- */
  const localKey = () => `pz-inbox-local:${(PZ.auth && PZ.auth.current && PZ.auth.current.id) || (PZ.auth && PZ.auth.platform ? 'platform' : 'anon')}`;
  function readLocal() {
    try {
      const all = JSON.parse(localStorage.getItem(localKey()) || '[]');
      return all.filter((x) => x && Date.now() - x.at < LOCAL_DAYS * 864e5).slice(0, LOCAL_KEEP);
    } catch (e) { return []; }
  }
  function saveLocal() {
    try { localStorage.setItem(localKey(), JSON.stringify(I.local)); } catch (e) { /* sin almacenamiento */ }
  }
})(window.PZ);
