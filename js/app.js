// @ts-check
/* ==========================================================================
   PZ.app — ingreso, niveles y navegación

   Tres niveles, todos con la misma sesión (sin cerrar e iniciar):
     platform → el creador del sistema: todos los negocios
     org      → el dueño: panel del negocio (todas sus sucursales)
     branch   → operación de UNA sucursal (lo que usan encargados y empleados)
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  const A = PZ.auth;

  PZ.themes = [
    { id: 'margherita', name: 'Margherita', desc: 'Tomate, muzza y albahaca', sw: ['#d7263d', '#ffd166', '#2d6a4f'] },
    { id: 'pepperoni', name: 'Pepperoni', desc: 'Picante y ahumado', sw: ['#b3261e', '#ff8c42', '#f9c74f'] },
    { id: 'fugazzeta', name: 'Fugazzeta', desc: 'Cebolla dorada al horno', sw: ['#c98a1b', '#f6e7b4', '#7a8b3a'] },
    { id: 'cuatroquesos', name: 'Cuatro quesos', desc: 'Muzza, roquefort, provolone', sw: ['#d9a300', '#6c8ebf', '#fff6d6'] },
    { id: 'rucula', name: 'Rúcula y crudo', desc: 'Fresca y verde', sw: ['#3f7d20', '#e56b6f', '#f1e3b3'] },
    { id: 'napolitana', name: 'Napolitana', desc: 'Tomate, ajo y perejil', sw: ['#e63946', '#f1faee', '#1d3557'] },
    { id: 'horno', name: 'Horno de barro', desc: 'Modo oscuro, brasas', sw: ['#17110e', '#ff6b35', '#ffb347'] },
  ];

  const NAV = {
    branch: [
      { id: 'inicio', label: 'Inicio', icon: '🏠' },
      { id: 'vender', label: 'Vender', icon: '🍕' },
      { id: 'salon', label: 'Salón y mesas', icon: '🍽️' },
      { id: 'pedidos', label: 'Pedidos', icon: '🔥' },
      { id: 'caja', label: 'Caja', icon: '💰' },
      { id: 'historial', label: 'Ventas', icon: '🧾' },
      { id: 'clientes', label: 'Clientes', icon: '👥' },
      { id: 'menu', label: 'Menú y precios', icon: '📋' },
      { id: 'online', label: 'Carta online', icon: '📲' },
      { id: 'stock', label: 'Stock', icon: '📦' },
      { id: 'gastos', label: 'Gastos y ganancias', icon: '💸' },
      { id: 'equipo', label: 'Equipo', icon: '🧑‍🍳' },
      { id: 'reportes', label: 'Reportes', icon: '📈' },
      { id: 'config', label: 'Configuración', icon: '⚙️' },
    ],
    org: [
      { id: 'n-resumen', label: 'Resumen', icon: '📊' },
      { id: 'n-sucursales', label: 'Sucursales', icon: '🏪' },
      { id: 'n-finanzas', label: 'Finanzas', icon: '💹' },
      { id: 'n-equipo', label: 'Equipo', icon: '🧑‍🍳' },
      { id: 'n-menu', label: 'Menú modelo', icon: '📋' },
      { id: 'n-config', label: 'Negocio', icon: '⚙️' },
    ],
    platform: [
      { id: 'p-negocios', label: 'Negocios', icon: '🛠️' },
      { id: 'p-errores', label: 'Errores de la app', icon: '🐞' },
    ],
  };
  const BOTTOM = {
    branch: ['inicio', 'vender', 'pedidos', 'caja'],
    org: ['n-resumen', 'n-sucursales', 'n-finanzas', 'n-equipo'],
    platform: ['p-negocios', 'p-errores'],
  };
  const modeOf = (id) => (id.startsWith('p-') ? 'platform' : id.startsWith('n-') ? 'org' : 'branch');

  /** @type {(() => void) | null} */
  let cleanup = null;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let clockTimer;
  const root = () => /** @type {HTMLElement} */ (document.getElementById('app'));
  /**
   * Elemento recién dibujado por la misma pantalla (siempre existe).
   * @param {ParentNode} scope @param {string} sel @returns {HTMLElement}
   */
  const q = (scope, sel) => /** @type {HTMLElement} */ (scope.querySelector(sel));
  /** @param {ParentNode} scope @param {string} sel @returns {HTMLElement[]} */
  const qa = (scope, sel) => /** @type {HTMLElement[]} */ (Array.from(scope.querySelectorAll(sel)));
  const flavorDots = (current) => PZ.themes.map((t) => `<button type="button" class="flavor-dot ${t.id === current ? 'on' : ''}" data-t="${t.id}" title="${t.name}" aria-label="Tema ${t.name}" style="background:conic-gradient(${t.sw[0]} 0 50%, ${t.sw[1]} 50% 80%, ${t.sw[2]} 80%)"></button>`).join('');

  const App = (PZ.app = {
    /** @type {'platform' | 'org' | 'branch' | null} */
    mode: null,
    /** @type {string | null} */
    currentView: null,

    /* ===================== Tema (por equipo) ===================== */
    theme: () => localStorage.getItem('pz-theme') || 'margherita',
    isDark: () => (App.theme() === 'horno'),
    toggleDark() {
      if (App.isDark()) {
        const prevLight = localStorage.getItem('pz-theme-light') || 'margherita';
        App.setTheme(prevLight);
      } else {
        localStorage.setItem('pz-theme-light', App.theme() === 'horno' ? 'margherita' : App.theme());
        App.setTheme('horno');
      }
    },
    applyTheme(id) {
      const t = id || App.theme();
      document.documentElement.dataset.theme = t;
      document.documentElement.dataset.motion = localStorage.getItem('pz-motion') === 'off' ? 'off' : 'on';
      const meta = /** @type {HTMLMetaElement | null} */ (document.querySelector('meta[name=theme-color]'));
      const col = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
      if (meta && col) meta.content = col;
      const btn = /** @type {HTMLElement | null} */ (document.querySelector('.topbar [data-a=theme]'));
      if (btn) btn.textContent = App.isDark() ? '☀️' : '🌙';
    },
    setTheme(id) { localStorage.setItem('pz-theme', id); App.applyTheme(id); },
    bindFlavors(el) {
      el.querySelectorAll('.flavor-dot').forEach((b) => b.addEventListener('click', () => {
        App.setTheme(b.dataset.t);
        el.querySelectorAll('.flavor-dot').forEach((x) => x.classList.toggle('on', x === b));
      }));
    },

    go(route) { location.hash = '#/' + route; },

    loading(msg = 'Preparando la masa…') {
      clearInterval(clockTimer);
      root().innerHTML = `<div class="login"><div class="loading-card"><div class="spin-pizza">${PZ.brandLogo(90)}</div><p>${U.esc(msg)}</p></div></div>`;
    },

    floaters() {
      return Array.from({ length: 20 }, (_, i) => {
        const kinds = ['pep', 'basil', 'olive', 'cheese', 'tomato'];
        const size = 14 + Math.random() * 26;
        return `<i class="${kinds[i % 5]}" style="left:${Math.random() * 100}%;width:${size}px;height:${size}px;animation-duration:${12 + Math.random() * 14}s;animation-delay:-${Math.random() * 20}s"></i>`;
      }).join('');
    },

    /* ===================== INGRESO ===================== */
    renderLogin(errMsg = '') {
      clearInterval(clockTimer);
      // no dejar ventanas abiertas de la sesión anterior
      document.querySelectorAll('.modal-back').forEach((m) => m.remove());
      root().innerHTML = `
        <div class="login">
          <div class="floaters">${App.floaters()}</div>
          <form class="login-card" autocomplete="on" novalidate>
            <div class="login-logo">${PZ.brandLogo(96)}</div>
            <h1>Pizzería</h1>
            <p class="tag">Sistema de gestión · ¡a hornear!</p>
            <div class="err-msg ${errMsg ? '' : 'hidden'}">${U.esc(errMsg)}</div>
            <label class="field"><span>Usuario o email</span><input name="user" autocomplete="username" autocapitalize="off" required autofocus></label>
            <label class="field"><span>Contraseña</span><input name="pass" type="password" autocomplete="current-password" required></label>
            <button class="btn primary lg block mt" type="submit">Ingresar 🍕</button>
            <button class="btn ghost block mt" type="button" data-a="code">🔑 Tengo un código de sucursal</button>
            <div class="flavor-dots" title="Elegí el sabor del sistema">${flavorDots(App.theme())}</div>
            ${navigator.onLine ? '' : '<div class="demo-hint">📴 Sin conexión. Si ya ingresaste antes en este equipo, tu sesión sigue activa.</div>'}
          </form>
        </div>`;
      const form = /** @type {HTMLFormElement} */ (q(root(), 'form'));
      const f = /** @type {any} */ (form.elements);
      const err = q(form, '.err-msg');
      App.bindFlavors(form);
      q(form, '[data-a=code]').onclick = () => App.renderJoin();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.classList.add('hidden');
        const btn = /** @type {HTMLButtonElement} */ (q(form, 'button[type=submit]'));
        btn.disabled = true;
        btn.textContent = 'Un momento…';
        try {
          await A.login(f.user.value, f.pass.value);
          localStorage.setItem('pz-memberships', JSON.stringify(A.memberships));
          localStorage.setItem('pz-platform', A.platform ? '1' : '');
          await App.enter();
        } catch (ex) {
          console.error(ex);
          err.textContent = ex.message || 'No se pudo ingresar';
          err.classList.remove('hidden');
          btn.disabled = false;
          btn.textContent = 'Ingresar 🍕';
        }
      });
    },

    /** Alta con código: el encargado o empleado se suma solo */
    renderJoin(prefill = '') {
      root().innerHTML = `
        <div class="login"><div class="floaters">${App.floaters()}</div>
          <form class="login-card" novalidate>
            <div class="login-logo">${PZ.brandLogo(96)}</div>
            <h1 style="font-size:1.6em">Sumarme a una sucursal</h1>
            <p class="tag">Ingresá el código que te pasó el dueño o el encargado</p>
            <div class="err-msg hidden"></div>
            <div class="step1">
              <label class="field"><span>Código</span><input name="code" class="code-input" placeholder="ABCD-1234" autocapitalize="characters" autocomplete="off" maxlength="9" autofocus></label>
              <button class="btn primary lg block" type="submit">Continuar →</button>
            </div>
            <div class="step2 hidden">
              <div class="join-ok"></div>
              <label class="field"><span>Tu nombre</span><input name="name" autocomplete="name"></label>
              <label class="field"><span>Elegí un usuario (para ingresar)</span><input name="username" autocapitalize="off" autocomplete="username" placeholder="ej: lucas.palermo"></label>
              <label class="field"><span>Contraseña (mínimo 6)</span><input name="pass" type="password" autocomplete="new-password"></label>
              <button class="btn primary lg block" type="submit">Crear mi usuario 🍕</button>
            </div>
            <p class="center small mt"><a href="#" data-a="back">← Volver al ingreso</a></p>
          </form></div>`;
      const form = /** @type {HTMLFormElement} */ (q(root(), 'form'));
      const err = q(form, '.err-msg');
      const f = /** @type {any} */ (form.elements);
      let step = 1;
      f.code.addEventListener('input', () => {
        let v = f.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        if (v.length > 4) v = v.slice(0, 4) + '-' + v.slice(4);
        f.code.value = v;
      });
      q(form, '[data-a=back]').onclick = async (e) => {
        e.preventDefault();
        if (await PZ.cloud.session()) return App.enter().catch((x) => App.renderLogin(x.message));
        App.renderLogin();
      };
      if (prefill) {
        f.code.value = prefill;
        f.code.dispatchEvent(new Event('input'));
        setTimeout(() => form.requestSubmit(), 50);
      }
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.classList.add('hidden');
        const btn = /** @type {HTMLButtonElement} */ (q(form, step === 1 ? '.step1 button' : '.step2 button'));
        btn.disabled = true;
        try {
          if (step === 1) {
            const info = await PZ.cloud.join({ code: f.code.value, check: true });
            q(form, '.join-ok').innerHTML = `<div class="alert-row">✅ Te vas a sumar a <b>${U.esc(info.org)}</b> · sucursal <b>${U.esc(info.branch)}</b> como <b>${U.esc(A.ROLES[info.role].label)}</b></div>`;
            q(form, '.step1').classList.add('hidden');
            q(form, '.step2').classList.remove('hidden');
            f.code.readOnly = true;
            step = 2;
            setTimeout(() => f.name.focus(), 50);
          } else {
            await PZ.cloud.join({ code: f.code.value, name: f.name.value, username: f.username.value, password: f.pass.value });
            PZ.toast('¡Listo! Ya sos parte del equipo 🍕');
            await A.login(f.username.value, f.pass.value);
            localStorage.setItem('pz-memberships', JSON.stringify(A.memberships));
            await App.enter();
          }
        } catch (ex) {
          err.textContent = ex.message;
          err.classList.remove('hidden');
        } finally {
          btn.disabled = false;
        }
      });
    },

    /** Decide a qué nivel entra el usuario después de ingresar */
    async enter() {
      if (A.platform) return App.openPlatform();
      const list = A.memberships;
      let m = list.find((x) => x.org_id === localStorage.getItem('pz-org'));
      if (!m && list.length === 1) m = list[0];
      if (!m) {
        const id = await App.pick('¿Con qué negocio vas a trabajar?', list.map((x) => ({ id: x.org_id, title: x.organizations.name, sub: A.ROLES[x.role].label, icon: '🍕' })));
        m = list.find((x) => x.org_id === id);
      }
      A.use(m);
      localStorage.setItem('pz-org', m.org_id);
      await App.loadOrg(m.org_id);
      if (A.isOwner()) {
        const last = localStorage.getItem('pz-mode-' + m.org_id);
        const allowed = App.allowedBranches();
        if (last === 'org' || (!last && allowed.length > 1)) return App.openOrg();
      }
      return App.openBranch(await App.chooseBranch());
    },

    /** Carga negocio, sucursales y equipo (con respaldo local si no hay internet) */
    async loadOrg(orgId) {
      App.loading('Buscando tus sucursales…');
      S.ctx.orgId = orgId;
      try {
        const meta = await PZ.cloud.orgMeta(orgId);
        S.ctx.org = meta.org;
        S.ctx.branches = meta.branches;
        S.ctx.members = meta.members;
        localStorage.setItem('pz-orgmeta-' + orgId, JSON.stringify(meta));
      } catch (e) {
        const meta = JSON.parse(localStorage.getItem('pz-orgmeta-' + orgId) || 'null');
        if (!meta) throw e;
        S.ctx.org = meta.org;
        S.ctx.branches = meta.branches;
        S.ctx.members = meta.members;
      }
    },

    allowedBranches() {
      const u = A.current;
      if (!u) return [];
      return S.ctx.branches.filter((b) => b.active && (u.role === 'owner' || !u.branchIds.length || u.branchIds.includes(b.id)));
    },

    async chooseBranch() {
      const allowed = App.allowedBranches();
      if (!allowed.length) throw new Error('No tenés sucursales asignadas. Hablá con el dueño.');
      const last = localStorage.getItem('pz-branch-' + A.current.orgId);
      if (allowed.some((b) => b.id === last)) return last;
      if (allowed.length === 1) return allowed[0].id;
      return App.pick('¿En qué sucursal vas a trabajar?', allowed.map((b) => ({ id: b.id, title: b.name, sub: (b.settings && b.settings.business && b.settings.business.address) || '', icon: '🏪' })));
    },

    /* ---------- Cambiar de nivel (sin cerrar sesión) ---------- */
    async openPlatform() {
      await App.leaveBranch();
      A.current = null;
      App.mode = 'platform';
      PZ.cloud.unsubscribe();
      App.renderShell();
      App.go('p-negocios');
      App.route();
      App.afterEnter();
    },

    /** Soporte: la plataforma entra al panel de un negocio */
    async supportOrg(org) {
      A.useSupport(org);
      await App.loadOrg(org.id);
      return App.openOrg();
    },

    async openOrg() {
      if (!A.isOwner()) return;
      await App.leaveBranch();
      App.mode = 'org';
      localStorage.setItem('pz-mode-' + A.current.orgId, 'org');
      PZ.cloud.subscribeOrg(A.current.orgId, S.onRemoteHook);
      App.renderShell();
      if (modeOf((location.hash.replace(/^#\/?/, '') || 'x').split('/')[0]) !== 'org') history.replaceState(null, '', '#/n-resumen');
      App.route();
      App.afterEnter();
    },

    async openBranch(branchId) {
      App.loading('Calentando el horno…');
      if (cleanup) { try { cleanup(); } catch (e) { /* noop */ } cleanup = null; }
      await S.flush();
      await S.open(A.current.orgId, branchId);
      App.mode = 'branch';
      localStorage.setItem('pz-branch-' + A.current.orgId, branchId);
      if (A.isOwner() && !A.current.support) localStorage.setItem('pz-mode-' + A.current.orgId, 'branch');
      if (!A.current.support) PZ.cloud.sb.rpc('touch_login', { p_org: A.current.orgId }).then(() => {}, () => {});
      // Sucursal nueva sin menú: se copia el menú modelo del negocio
      if (!S.data.categories.length && A.isAdmin()) await S.seedIfEmpty({ example: false });
      // Pedidos de la carta online y estado de Mercado Pago (no bloquean la entrada)
      PZ.web.load();
      PZ.mp.load();
      // un logo pesado hace lenta la carta online en los celulares: se aliviana solo
      if (A.isAdmin()) S.optimizeLogo().catch(() => {});
      App.renderShell();
      const cur = (location.hash.replace(/^#\/?/, '') || '').split('/')[0];
      if (!cur || modeOf(cur) !== 'branch') history.replaceState(null, '', '#/inicio');
      App.route();
      App.afterEnter();
    },

    async leaveBranch() {
      if (App.mode === 'branch' && S.data) {
        if (cleanup) { try { cleanup(); } catch (e) { /* noop */ } cleanup = null; }
        S.diff();
        await S.flush();
      }
    },

    /** Pantalla de elección (negocio / sucursal) */
    pick(title, options) {
      return new Promise((resolve) => {
        root().innerHTML = `
          <div class="login"><div class="floaters">${App.floaters()}</div>
            <div class="login-card wide">
              <div class="login-logo">${PZ.brandLogo(96)}</div>
              <h1 style="font-size:1.5em">${U.esc(title)}</h1>
              <div class="pick-list mt">${options.map((o) => `<button class="pick" data-id="${o.id}"><span class="pick-ico">${o.icon}</span><span><b>${U.esc(o.title)}</b><small>${U.esc(o.sub || '')}</small></span><span class="pick-go">→</span></button>`).join('')}</div>
              <p class="center small mt"><a href="#" data-a="out">Salir</a></p>
            </div></div>`;
        qa(root(), '.pick').forEach((b) => b.onclick = () => resolve(b.dataset.id));
        q(root(), '[data-a=out]').onclick = (e) => { e.preventDefault(); App.logout(); };
      });
    },

    /** Elegir sucursal en un modal (desde el panel o la barra superior) */
    branchPicker(title = '🏪 ¿En qué sucursal querés operar?') {
      const list = App.allowedBranches();
      const m = PZ.modal({
        title,
        size: 'sm',
        body: `<div class="pick-list">${list.map((b) => `<button class="pick ${App.mode === 'branch' && b.id === S.ctx.branchId ? 'on' : ''}" data-id="${b.id}"><span class="pick-ico">🏪</span><span><b>${U.esc(b.name)}</b><small>${U.esc((b.settings && b.settings.business && b.settings.business.address) || '')}</small></span><span class="pick-go">${App.mode === 'branch' && b.id === S.ctx.branchId ? '✓' : '→'}</span></button>`).join('')}</div>
          ${A.isOwner() && App.mode === 'branch' ? '<button class="btn ghost block mt" data-a="panel">🏢 Ir al panel del negocio</button>' : ''}`,
      });
      m.el.querySelectorAll('.pick').forEach((b) => b.onclick = async () => {
        m.close();
        if (App.mode === 'branch' && b.dataset.id === S.ctx.branchId) return;
        try { await App.openBranch(b.dataset.id); PZ.toast('Operando en ' + S.branchName()); } catch (e) { PZ.toast(e.message, 'err'); }
      });
      const p = m.el.querySelector('[data-a=panel]');
      if (p) p.onclick = () => { m.close(); App.openOrg(); };
    },

    /* ===================== ESTRUCTURA ===================== */
    navItems() {
      const mode = App.mode;
      if (mode === 'platform') return NAV.platform;
      if (mode === 'org') return NAV.org.filter((n) => PZ.views[n.id] && (n.id !== 'n-finanzas' || A.feature('gastos')));
      return NAV.branch.filter((n) => PZ.views[n.id] && A.can(n.id));
    },

    renderShell() {
      const mode = App.mode;
      const u = A.current;
      const items = App.navItems();
      const bottom = items.filter((n) => BOTTOM[mode].includes(n.id));
      const rest = items.filter((n) => !bottom.includes(n));
      const title = mode === 'platform' ? 'Plataforma' : (S.ctx.org ? S.ctx.org.name : '');
      const sub = mode === 'platform' ? 'Administración' : mode === 'org' ? 'Panel del negocio' : S.branchName();
      const name = mode === 'platform' ? ((A.me && A.me.user_metadata && A.me.user_metadata.name) || 'Admin') : u.name;
      const roleLabel = mode === 'platform' ? 'Plataforma' : u.support ? 'Soporte' : A.ROLES[u.role].label;

      let chips = '';
      if (mode === 'branch') {
        chips += `<button class="branch-chip" data-a="branch" title="Cambiar de sucursal">🏪 <span class="bc-txt">${U.esc(S.branchName())}</span>${App.allowedBranches().length > 1 || A.isOwner() ? ' ▾' : ''}</button>`;
        if (A.isOwner()) chips += '<button class="mode-chip" data-a="panel" title="Panel del negocio">🏢 <span class="mc-txt">Panel</span></button>';
        chips += '<button class="sync-chip" data-a="sync"></button>' + (A.can('caja') ? '<button class="cash-chip" data-a="cash"></button>' : '');
      } else if (mode === 'org') {
        chips += '<button class="mode-chip primary" data-a="operate" title="Operar en una sucursal">🍕 <span class="mc-txt">Operar en sucursal</span> ▾</button>';
        if (u.support) chips += '<button class="mode-chip" data-a="platform" title="Volver a la plataforma">🛠️ <span class="mc-txt">Plataforma</span></button>';
        chips += '<button class="sync-chip" data-a="sync"></button>';
      }

      root().innerHTML = `
        <div class="shell mode-${mode}">
          <aside class="sidebar">
            <div class="brand">${PZ.brandLogo(44)}<div class="brand-txt"><b>${U.esc(title)}</b><small>${U.esc(sub)}</small></div></div>
            ${u && u.support ? '<div class="support-tag">🛠️ Modo soporte</div>' : ''}
            <nav class="nav">
              ${items.map((n) => `<a href="#/${n.id}" data-r="${n.id}" title="${n.label}"><span class="n-ico">${n.icon}</span><span class="n-txt">${n.label}</span>${n.id === 'pedidos' ? '<span class="n-count hidden"></span>' : ''}</a>`).join('')}
            </nav>
            <div class="side-foot">
              <div class="sf-txt"><div style="opacity:.75">Conectado como</div><b>${U.esc(name)}</b> · ${roleLabel}</div>
              <button class="btn sm ghost block mt" data-a="logout" title="Cerrar sesión" style="color:inherit;box-shadow:inset 0 0 0 2px rgba(255,255,255,.2)">🚪<span class="sf-txt"> Cerrar sesión</span></button>
            </div>
          </aside>
          <div class="main">
            <header class="topbar">
              <h2><span class="t-ico"></span><span class="t-txt"></span></h2>
              <div class="spacer"></div>
              ${chips}
              <span class="clock"></span>
              <button class="icon-btn theme-btn" data-a="theme" title="Modo oscuro / claro" aria-label="Cambiar tema">${App.isDark() ? '☀️' : '🌙'}</button>
              <button class="icon-btn help-btn" data-a="help" title="Ayuda de esta pantalla" aria-label="Ayuda">❓</button>
              <button class="user-pill" data-a="user" aria-label="Mi usuario">${PZ.profile.avatar(PZ.profile.me, name, 32)}<span class="u-name">${U.esc(name)}</span></button>
              <svg class="drip" viewBox="0 0 1200 14" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 0H1200V3H0Z"/>
                <path class="d" d="M120 2 q8 0 8 7 q0 5 -8 5 q-8 0 -8 -5 q0 -7 8 -7z"/>
                <path class="d" d="M380 2 q6 0 6 5 q0 4 -6 4 q-6 0 -6 -4 q0 -5 6 -5z"/>
                <path class="d" d="M640 2 q9 0 9 8 q0 4 -9 4 q-9 0 -9 -4 q0 -8 9 -8z"/>
                <path class="d" d="M900 2 q6 0 6 6 q0 4 -6 4 q-6 0 -6 -4 q0 -6 6 -6z"/>
                <path class="d" d="M1100 2 q7 0 7 6 q0 5 -7 5 q-7 0 -7 -5 q0 -6 7 -6z"/>
              </svg>
            </header>
            <div class="help-slot" id="help-slot"></div>
            <main class="content" id="view"></main>
          </div>
          <nav class="bottom-nav">
            ${bottom.map((n) => `<a href="#/${n.id}" data-r="${n.id}"><span class="b-ico">${n.icon}</span><span class="b-txt">${n.label}</span>${n.id === 'pedidos' ? '<span class="n-count hidden"></span>' : ''}</a>`).join('')}
            ${rest.length || mode !== 'platform' ? '<button data-a="more"><span class="b-ico">☰</span><span class="b-txt">Más</span></button>' : ''}
          </nav>
        </div>`;

      const r = root();
      const on = (a, fn) => { const b = /** @type {HTMLElement | null} */ (r.querySelector(`[data-a=${a}]`)); if (b) b.onclick = fn; };
      on('logout', App.logout);
      on('user', App.userMenu);
      on('branch', () => App.branchPicker());
      on('panel', () => App.openOrg());
      on('operate', () => App.branchPicker());
      on('platform', () => App.openPlatform());
      on('sync', App.syncInfo);
      on('theme', App.toggleDark);
      on('help', () => PZ.help.open(App.currentView));
      on('cash', () => (A.can('caja') ? App.go('caja') : null));
      on('more', () => {
        const extra = [];
        if (mode === 'branch' && (App.allowedBranches().length > 1 || A.isOwner())) extra.push('<a href="#" data-x="br"><span>🏪</span>Cambiar sucursal</a>');
        if (mode === 'branch' && A.isOwner()) extra.push('<a href="#" data-x="panel"><span>🏢</span>Panel del negocio</a>');
        if (mode === 'org') extra.push('<a href="#" data-x="br"><span>🍕</span>Operar en sucursal</a>');
        const m = PZ.modal({
          title: 'Más',
          body: `<div class="more-menu">${rest.map((n) => `<a href="#/${n.id}"><span>${n.icon}</span>${n.label}</a>`).join('')}${extra.join('')}<a href="#" data-x="lo"><span>🚪</span>Salir</a></div>`,
        });
        m.el.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => {
          const x = a.dataset.x;
          if (!x) return m.close();
          e.preventDefault();
          m.close();
          if (x === 'lo') App.logout();
          if (x === 'br') App.branchPicker();
          if (x === 'panel') App.openOrg();
        }));
      });

      const tick = () => {
        const c = r.querySelector('.clock');
        if (c) c.textContent = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      };
      tick();
      clearInterval(clockTimer);
      clockTimer = setInterval(tick, 15000);
      App.refreshChrome();
      App.refreshSync(S.status);
    },

    refreshChrome() {
      const r = root();
      if (App.mode !== 'branch' || !S.data) return;
      const chip = /** @type {HTMLElement | null} */ (r.querySelector('.cash-chip'));
      if (chip) {
        const s = S.currentSession();
        chip.className = 'cash-chip ' + (s ? 'open' : 'closed');
        chip.innerHTML = `<span class="c-ico">💰</span><span class="dot"></span><span class="c-txt">${s ? 'Caja abierta' : 'Caja cerrada'}</span>`;
        chip.title = s ? 'Caja abierta' : 'Caja cerrada';
      }
      // el mozo solo sigue lo del salón
      const active = S.data.orders.filter((o) => !o.voided && !['entregado', 'cancelado'].includes(o.status) && (!A.isWaiter() || o.type === 'mesa')).length
        + (PZ.web && A.can('vender') ? PZ.web.pending().length : 0);
      r.querySelectorAll('.n-count').forEach((el) => {
        el.textContent = active;
        el.classList.toggle('hidden', !active);
      });
      const bc = r.querySelector('.bc-txt');
      if (bc) bc.textContent = S.branchName();
    },

    refreshSync(st) {
      const el = root().querySelector('.sync-chip');
      if (!el) return;
      const offline = !navigator.onLine;
      let cls = 'ok';
      let txt = App.mode === 'org' ? 'En vivo' : 'Al día';
      let ico = '☁️';
      if (offline) { cls = 'off'; ico = '📴'; txt = st.pending ? `Sin conexión · ${st.pending} por enviar` : 'Sin conexión'; }
      else if (st.state === 'syncing') { cls = 'busy'; ico = '⏳'; txt = 'Guardando…'; }
      else if (st.state === 'retry') { cls = 'warn'; ico = '⚠️'; txt = `Reintentando (${st.pending})`; }
      else if (st.state === 'error') { cls = 'err'; ico = '⚠️'; txt = 'Error al guardar'; }
      else if (st.pending) { cls = 'busy'; ico = '⏳'; txt = `${st.pending} por enviar`; }
      el.className = 'sync-chip ' + cls;
      el.innerHTML = `<span>${ico}</span><span class="s-txt">${txt}</span>`;
    },

    syncInfo() {
      const st = S.status;
      PZ.modal({
        title: '☁️ Sincronización',
        size: 'sm',
        body: `
          <div class="bank-box">
            <div class="bk-row"><span>Conexión</span><b>${navigator.onLine ? '🟢 En línea' : '🔴 Sin internet'}</b></div>
            <div class="bk-row"><span>Tiempo real</span><b>${PZ.cloud.realtime === 'SUBSCRIBED' ? '🟢 Activo' : '🟡 ' + (PZ.cloud.realtime || 'Conectando')}</b></div>
            <div class="bk-row"><span>Cambios por enviar</span><b>${st.pending || 0}</b></div>
            <div class="bk-row"><span>Última sincronización</span><b>${st.lastSync ? U.time(st.lastSync) : '—'}</b></div>
          </div>
          <p class="small muted">Todo se guarda primero en este equipo y se sube a la nube apenas hay internet. Si se corta la conexión, podés seguir vendiendo e imprimiendo: se sincroniza solo al volver.</p>
          ${st.error ? `<div class="alert-row">⚠️ ${U.esc(st.error)}</div>` : ''}`,
      });
    },

    userMenu() {
      const mode = App.mode;
      const u = A.current;
      const name = mode === 'platform' ? ((A.me && A.me.user_metadata && A.me.user_metadata.name) || 'Admin') : u.name;
      const items = [];
      if (mode === 'branch' && A.isOwner()) items.push('<button class="btn ghost block mt" data-a="panel">🏢 Panel del negocio</button>');
      if (mode === 'org') items.push('<button class="btn ghost block mt" data-a="operate">🍕 Operar en una sucursal</button>');
      if (A.platform && mode !== 'platform') items.push('<button class="btn ghost block mt" data-a="platform">🛠️ Volver a la plataforma</button>');
      if (!A.platform && A.memberships.length > 1) items.push('<button class="btn ghost block mt" data-a="org">🔀 Cambiar de negocio</button>');
      if (!(u && u.support)) items.unshift('<button class="btn primary block mt" data-a="profile">👤 Mi perfil (foto, datos, correo y contraseña)</button>');
      const m = PZ.modal({
        title: `Hola, ${U.esc(name)} 👋`,
        size: 'sm',
        body: `
          <p class="muted" style="margin-top:0">${mode === 'platform' ? 'Administrador de la plataforma' : `${u.support ? 'Soporte' : A.ROLES[u.role].label} · ${U.esc(S.ctx.org ? S.ctx.org.name : '')}`}</p>
          <div class="opt-section">Sabor del sistema (en este equipo)</div>
          <div class="flavor-dots" style="justify-content:flex-start">${flavorDots(App.theme())}</div>
          ${items.join('')}
          <button class="btn danger block mt" data-a="out">🚪 Cerrar sesión</button>`,
      });
      App.bindFlavors(m.el);
      const on = (a, fn) => { const b = m.el.querySelector(`[data-a=${a}]`); if (b) b.onclick = () => { m.close(); fn(); }; };
      on('out', App.logout);
      on('panel', App.openOrg);
      on('operate', () => App.branchPicker());
      on('platform', App.openPlatform);
      on('org', () => { localStorage.removeItem('pz-org'); App.enter().catch((e) => App.renderLogin(e.message)); });
      on('profile', () => PZ.profile.open());
    },

    /** Foto de la barra superior */
    refreshAvatar() {
      const pill = root().querySelector('.user-pill');
      if (!pill) return;
      const nameEl = pill.querySelector('.u-name');
      const old = pill.querySelector('.avatar');
      if (old) old.outerHTML = PZ.profile.avatar(PZ.profile.me, nameEl ? nameEl.textContent : '', 32);
    },

    afterEnter() {
      PZ.profile.load().then(() => {
        App.refreshAvatar();
        PZ.profile.ensureComplete();
      });
    },

    async logout() {
      if (S.status.pending && !(await PZ.confirm(`Hay ${S.status.pending} cambio(s) que todavía no se enviaron a la nube. Se envían la próxima vez que ingreses en este equipo. ¿Salir igual?`))) return;
      if (cleanup) { try { cleanup(); } catch (e) { /* noop */ } cleanup = null; }
      await S.flush();
      await A.logout();
      App.mode = null;
      location.hash = '';
      App.renderLogin();
    },

    /* ===================== NAVEGACIÓN ===================== */
    route() {
      if (!App.mode) return;
      if (App.mode !== 'platform' && !A.current) return;
      if (App.mode === 'branch' && !S.data) return;
      const [name, ...params] = (location.hash.replace(/^#\/?/, '') || '').split('/');

      // Un link a otro nivel cambia de nivel (si tiene permiso)
      if (name && PZ.views[name] && modeOf(name) !== App.mode) {
        const target = modeOf(name);
        if (target === 'org' && A.isOwner()) return App.openOrg();
        if (target === 'platform' && A.platform) return App.openPlatform();
        if (target === 'branch' && A.current) return App.openBranch(S.ctx.branchId || App.allowedBranches()[0].id);
      }
      if (!document.getElementById('view')) App.renderShell();
      const items = App.navItems();
      const id = name && items.some((n) => n.id === name) ? name : items[0].id;
      if (id !== name) history.replaceState(null, '', '#/' + id);
      const view = PZ.views[id];
      const nav = items.find((n) => n.id === id) || items[0];
      if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
      qa(document, '[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === id));
      q(document, '.topbar .t-ico').textContent = nav.icon;
      q(document, '.topbar .t-txt').textContent = view.title || nav.label;
      document.title = `${nav.label} · ${App.mode === 'branch' ? S.branchName() : App.mode === 'org' ? (S.ctx.org ? S.ctx.org.name : '') : 'Plataforma'}`;
      const el = q(document, '#view');
      el.innerHTML = '';
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      App.currentView = id;
      const slot = document.getElementById('help-slot');
      if (slot) { slot.innerHTML = ''; PZ.help.banner(slot, id); }
      try {
        cleanup = view.render(el, params) || null;
      } catch (e) {
        console.error(e);
        el.innerHTML = `<div class="card empty"><span class="e-ico">🔥</span>Se quemó la pizza: ${U.esc(e.message)}</div>`;
      }
    },
  });

  /* ===================== Tablas adaptables ===================== */
  // En pantallas chicas cada fila se muestra como tarjeta; cada celda
  // necesita la etiqueta de su columna.
  function labelTables(scope) {
    scope.querySelectorAll('table.tbl').forEach((t) => {
      const heads = Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent.trim());
      if (!heads.length) { t.classList.add('no-head'); return; }
      t.classList.add('stackable');
      t.querySelectorAll('tbody tr').forEach((tr) => {
        Array.from(tr.children).forEach((td, i) => { if (!td.dataset.label) td.dataset.label = heads[i] || ''; });
      });
    });
  }

  /* ===================== Ojito en las contraseñas ===================== */
  // Todo campo de contraseña (ingreso, alta de empleados, perfil, autorización
  // de encargado…) recibe un botón para ver u ocultar lo que se escribió.
  const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  function passwordEyes(scope) {
    scope.querySelectorAll('input[type="password"]:not([data-eye])').forEach((el) => {
      const input = /** @type {HTMLInputElement} */ (el);
      input.dataset.eye = '1';
      const wrap = document.createElement('span');
      wrap.className = 'pw-wrap';
      input.replaceWith(wrap);
      wrap.appendChild(input);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-eye';
      const draw = () => {
        const shown = input.type === 'text';
        btn.innerHTML = shown ? EYE_OFF : EYE;
        btn.setAttribute('aria-label', shown ? 'Ocultar contraseña' : 'Mostrar contraseña');
        btn.setAttribute('aria-pressed', String(shown));
        btn.title = shown ? 'Ocultar contraseña' : 'Mostrar contraseña';
      };
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // no le saca el foco al campo
      btn.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; draw(); input.focus(); });
      draw();
      wrap.appendChild(btn);
    });
  }
  PZ.passwordEyes = passwordEyes;

  /* ===================== Arranque ===================== */
  async function boot() {
    App.applyTheme();
    window.addEventListener('hashchange', () => App.route());
    S.onChange(() => App.refreshChrome());
    S.onStatus((st) => App.refreshSync(st));
    new MutationObserver(() => { labelTables(document.body); passwordEyes(document.body); }).observe(document.body, { childList: true, subtree: true });
    passwordEyes(document.body);

    // Cambios de otros equipos: se redibujan las pantallas "en vivo"
    S.onRemoteHook = U.debounce(() => {
      const v = App.currentView ? PZ.views[App.currentView] : null;
      if (v && v.live && !document.querySelector('.modal-back')) App.route();
    }, 600);

    const bootEl = q(document, '#boot');
    const hideBoot = () => { bootEl.style.opacity = '0'; setTimeout(() => bootEl.remove(), 400); };
    const invite = new URLSearchParams(location.search).get('codigo');
    if (invite) {
      history.replaceState(null, '', location.pathname);
      hideBoot();
      return App.renderJoin(invite);
    }
    try {
      const session = await PZ.cloud.session();
      if (!session) { hideBoot(); return App.renderLogin(); }
      A.me = session.user;
      try {
        A.platform = await PZ.cloud.isPlatformAdmin();
        A.memberships = await PZ.cloud.memberships();
        localStorage.setItem('pz-memberships', JSON.stringify(A.memberships));
        localStorage.setItem('pz-platform', A.platform ? '1' : '');
      } catch (e) {
        A.platform = localStorage.getItem('pz-platform') === '1';
        A.memberships = JSON.parse(localStorage.getItem('pz-memberships') || '[]');
      }
      hideBoot();
      if (!A.platform && !A.memberships.length) return App.renderLogin('Tu usuario no tiene acceso a ningún negocio activo.');
      await App.enter();
    } catch (e) {
      console.error(e);
      hideBoot();
      App.renderLogin(e.message);
    }

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          for (const reg of regs) reg.unregister();
        });
      } else {
        navigator.serviceWorker.register('sw.js').then((reg) => {
          reg.update().catch(() => {});
        }).catch(() => {});
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!sessionStorage.getItem('pz-sw-reloaded')) {
            sessionStorage.setItem('pz-sw-reloaded', '1');
            window.location.reload();
          }
        });
      }
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window.PZ);
