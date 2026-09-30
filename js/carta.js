// @ts-check
/* ==========================================================================
   Carta online (página pública para los clientes)

   carta.html?l=<sucursal>            la carta, el carrito y el pedido
   carta.html?l=<sucursal>&mesa=5     pedido desde la mesa (QR en la mesa)
   carta.html?l=<sucursal>&pedido=ID  seguimiento de un pedido
   carta.html?preview=1               vista previa desde el panel del local

   El pedido se guarda en la base (con los precios calculados por el
   servidor) y el cliente lo manda por WhatsApp al local.
   ========================================================================== */
(function () {
  const PZ = window.PZ;
  const C = PZ.carta;
  const CFG = window.PZ_CONFIG;
  const root = /** @type {HTMLElement} */ (document.getElementById('carta'));
  const params = new URLSearchParams(location.search);
  const slug = (params.get('l') || '').toLowerCase();
  const tableParam = (params.get('mesa') || '').slice(0, 10);
  const trackId = params.get('pedido') || '';
  const preview = params.has('preview');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** @type {PZ.CartaMenu | null} */
  let menu = null;
  /** @type {PZ.CartLine[]} */
  let cart = [];
  let query = '';
  /** Datos que el cliente cargó la última vez (en este teléfono) */
  let me = load('pz-carta-me', { name: '', phone: '', address: '', zoneId: '', type: '', payment: '', street: '', streetNum: '', floor: '', dept: '', crossStreets: '', deliveryNotes: '' });

  /* ---------------- utilidades ---------------- */
  /** @param {string} s */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
  const money = C.money;
  /** @param {string} sel @param {ParentNode} [r] */
  const $ = (sel, r = document) => /** @type {HTMLElement} */ (r.querySelector(sel));
  /** @param {string} sel @param {ParentNode} [r] */
  const $$ = (sel, r = document) => /** @type {HTMLElement[]} */ (Array.from(r.querySelectorAll(sel)));
  /** @param {string} sel @param {ParentNode} [r] */
  const inp = (sel, r = document) => /** @type {HTMLInputElement} */ (r.querySelector(sel));
  /** @template T @param {string} k @param {T} def @returns {T} */
  function load(k, def) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : { ...def, ...v }; } catch (e) { return def; } }
  /** @param {string} k @param {unknown} v */
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* modo privado */ } }
  const cartKey = () => `pz-carta-cart-${slug || 'preview'}`;
  const saveCart = () => { if (!preview) save(cartKey(), cart); };
  const vibrate = (/** @type {number | number[]} */ p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* noop */ } };

  /** Llama a una función pública de la base (sin sesión) @param {string} fn @param {object} args */
  async function rpc(fn, args) {
    const res = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: `Bearer ${CFG.supabaseKey}` },
      body: JSON.stringify(args),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && (data.message || data.hint)) || 'No se pudo conectar. Revisá tu internet.');
    return data;
  }

  function toast(/** @type {string} */ msg, kind = 'ok') {
    const t = document.createElement('div');
    t.className = 'c-toast ' + kind;
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
  }

  /* ---------------- tema ---------------- */
  const loadedFonts = new Set();
  /** @param {PZ.CartaSettings} online */
  function applyTheme(online) {
    const theme = { ...C.defaults().theme, ...(online.theme || {}) };
    const vars = C.themeVars(theme);
    Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
    document.documentElement.style.colorScheme = vars['--c-scheme'];
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', theme.primary);
    const fams = { redonda: 'Fredoka:wght@500;600;700&family=Nunito:wght@500;600;700;800', clasica: 'Playfair+Display:wght@600;700;800&family=Lato:wght@400;700;900', moderna: 'Poppins:wght@500;600;700&family=Inter:wght@400;500;600;700' };
    const fam = fams[theme.font] || fams.redonda;
    if (!loadedFonts.has(fam)) {
      loadedFonts.add(fam);
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = `https://fonts.googleapis.com/css2?family=${fam}&display=swap`;
      document.head.appendChild(l);
    }
    root.dataset.layout = theme.layout === 'lista' ? 'lista' : 'grilla';
  }

  /* ---------------- arranque ---------------- */
  async function boot() {
    if (preview) return bootPreview();
    if (!slug) return fatal('Falta la dirección de la carta', 'Pedile el link al local.');
    try {
      menu = await rpc('carta_menu', { p_slug: slug });
    } catch (e) {
      return fatal('No pudimos cargar la carta', e.message, true);
    }
    if (!menu) return fatal('Esta carta no está disponible', 'Puede que el local la haya pausado. Probá más tarde o escribiles directamente.');
    cart = C.validLines(menu, load(cartKey(), []));
    if (!Array.isArray(cart)) cart = [];
    if (trackId) return renderTrack();
    render();
  }

  /** Vista previa: los datos llegan desde el panel del local */
  function bootPreview() {
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'pz-carta-preview' && e.data.menu) {
        const first = !menu;
        menu = e.data.menu;
        if (first) cart = [];
        cart = C.validLines(/** @type {PZ.CartaMenu} */ (menu), cart);
        render();
      }
    });
    const target = window.parent !== window ? window.parent : window.opener;
    if (target) target.postMessage({ type: 'pz-carta-ready' }, location.origin);
    else fatal('Vista previa', 'Abrí la vista previa desde el panel de tu local.');
  }

  /** @param {string} title @param {string} msg @param {boolean} [retry] */
  function fatal(title, msg, retry = false) {
    root.innerHTML = `<div class="c-empty-page"><div class="c-pizza-big" aria-hidden="true">🍕</div><h1>${esc(title)}</h1><p>${esc(msg)}</p>${retry ? '<button class="c-btn primary" data-a="retry">Reintentar</button>' : ''}</div>`;
    const b = $('[data-a=retry]', root);
    if (b) b.onclick = () => location.reload();
  }

  /* ---------------- carta ---------------- */
  function render() {
    const m = /** @type {PZ.CartaMenu} */ (menu);
    const s = m.settings;
    const on = { ...C.defaults(), ...s.online };
    applyTheme(on);
    const b = s.business || {};
    document.title = `${b.name || m.branch.org} · Carta online`;
    const open = C.isOpen(on) && m.open;
    const cats = m.categories.filter((c) => m.products.some((p) => p.categoryId === c.id));
    const logo = s.logo || '';
    const recent = load(`pz-carta-orders-${slug}`, /** @type {{id:string,number:number,at:number}[]} */ ([]));
    const last = Array.isArray(recent) ? recent.filter((r) => Date.now() - r.at < 864e5).slice(-1)[0] : null;
    const types = /** @type {PZ.WebOrderType[]} */ (['retiro', 'delivery', 'mesa']).filter((t) => on.types[t]);

    root.innerHTML = `
      ${preview ? '<div class="c-preview-tag">👀 Vista previa · así ven la carta tus clientes</div>' : ''}
      <header class="c-hero ${on.cover ? 'has-cover' : ''}" ${on.cover ? `style="--cover:url('${esc(on.cover)}')"` : ''}>
        <div class="c-hero-in">
          <div class="c-logo">${logo ? `<img src="${esc(logo)}" alt="">` : '<span aria-hidden="true">🍕</span>'}</div>
          <h1>${esc(b.name ? (m.branch && m.branch.name && m.branch.name !== b.name ? `${b.name} · ${m.branch.name}` : b.name) : m.branch.org)}</h1>
          ${b.slogan ? `<p class="c-slogan">${esc(b.slogan)}</p>` : ''}
          <div class="c-badges">
            <span class="c-badge ${open ? 'open' : 'closed'}">${open ? '● Abierto · tomando pedidos' : on.paused ? '● Pedidos pausados' : '● Cerrado ahora'}</span>
            ${on.hours.mode === 'schedule' ? `<span class="c-badge">🕒 ${esc(C.hoursText(on.hours))}</span>` : ''}
            ${types.includes('delivery') ? `<span class="c-badge">🛵 Delivery ~${on.deliveryMinutes || 40} min</span>` : ''}
            ${types.includes('retiro') ? `<span class="c-badge">🥡 Retiro ~${on.pickupMinutes || 15} min</span>` : ''}
          </div>
          <div class="c-info">
            ${b.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address + (b.city ? ', ' + b.city : ''))}" target="_blank" rel="noopener">📍 ${esc(b.address)}${b.city ? ', ' + esc(b.city) : ''}</a>` : ''}
            ${b.instagram ? `<a href="https://instagram.com/${esc(b.instagram.replace(/^@/, ''))}" target="_blank" rel="noopener">📷 ${esc(b.instagram)}</a>` : ''}
          </div>
        </div>
      </header>
      <main class="c-main">
        ${on.welcome ? `<p class="c-welcome">${esc(on.welcome)}</p>` : ''}
        ${!open ? `<div class="c-closed">${on.paused ? '⏸️ En este momento no estamos tomando pedidos online. ¡Volvé en un rato!' : `🌙 Ahora estamos cerrados. Podés mirar la carta; los pedidos se toman ${esc(C.hoursText(on.hours))}.`}</div>` : ''}
        ${tableParam && on.types.mesa ? `<div class="c-table-tag">🍽️ Estás pidiendo desde la <b>mesa ${esc(tableParam)}</b></div>` : ''}
        ${last ? `<a class="c-last" href="?l=${encodeURIComponent(slug)}&pedido=${encodeURIComponent(last.id)}">📦 Ver mi pedido W-${last.number} →</a>` : ''}
        <div class="c-sticky">
          <label class="c-search"><span aria-hidden="true">🔎</span><input type="search" placeholder="Buscar en la carta…" value="${esc(query)}" aria-label="Buscar"></label>
          <nav class="c-cats" aria-label="Categorías">${cats.map((c) => `<a href="#cat-${esc(c.id)}" data-cat="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</a>`).join('')}</nav>
        </div>
        <div class="c-list"></div>
        <footer class="c-foot">
          ${b.phone ? `<p>¿Dudas? Llamanos al <a href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">${esc(b.phone)}</a></p>` : ''}
          <p class="c-muted small">Precios en pesos. Pueden cambiar sin aviso.</p>
        </footer>
      </main>
      <button class="c-cartbar hidden" data-a="cart" aria-label="Ver mi pedido"></button>`;

    const search = inp('.c-search input', root);
    search.addEventListener('input', () => { query = search.value; drawList(); });
    drawList();
    drawCartBar();
    spyCategories();
    $('[data-a=cart]', root).onclick = () => openCart();
  }

  function drawList() {
    const m = /** @type {PZ.CartaMenu} */ (menu);
    const on = { ...C.defaults(), ...m.settings.online };
    const q = query.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const match = (/** @type {PZ.Product} */ p) => !q || (p.name + ' ' + (p.desc || '')).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q);
    const html = m.categories.map((c) => {
      const ps = m.products.filter((p) => p.categoryId === c.id && match(p));
      if (!ps.length) return '';
      return `<section class="c-sec" id="cat-${esc(c.id)}" data-sec="${esc(c.id)}">
        <h2><span aria-hidden="true">${esc(c.icon)}</span> ${esc(c.name)}</h2>
        ${c.allowHalf ? '<p class="c-muted small c-sec-hint">Podés pedirla mitad y mitad 🍕</p>' : ''}
        <div class="c-grid">${ps.map((p) => card(p, c, on.showPhotos)).join('')}</div>
      </section>`;
    }).join('');
    const list = $('.c-list', root);
    list.innerHTML = html || `<div class="c-none">No encontramos “${esc(query)}” en la carta.</div>`;
    $$('[data-p]', list).forEach((el) => el.onclick = () => openProduct(el.dataset.p || ''));
  }

  /** @param {PZ.Product} p @param {PZ.Category} c @param {boolean} photos */
  function card(p, c, photos) {
    const min = Math.min(...p.variants.map((v) => Number(v.price) || 0));
    const inCart = cart.filter((l) => l.productId === p.id).reduce((a, l) => a + l.qty, 0);
    const pic = photos && p.photo
      ? `<img src="${esc(p.photo)}" alt="" loading="lazy">`
      : c.allowHalf ? `<span class="c-disc" style="--pc:${esc(p.color || '#ffd166')}" aria-hidden="true"></span>` : `<span class="c-emoji" aria-hidden="true">${esc(c.icon)}</span>`;
    return `<button class="c-card" data-p="${esc(p.id)}">
      <div class="c-pic">${pic}${inCart ? `<span class="c-incart">${inCart}</span>` : ''}</div>
      <div class="c-body">
        <b class="c-name">${esc(p.name)}</b>
        ${p.desc ? `<span class="c-desc">${esc(p.desc)}</span>` : ''}
        <span class="c-price">${p.variants.length > 1 ? '<small>desde</small> ' : ''}${money(min)}</span>
      </div>
      <span class="c-add" aria-hidden="true">+</span>
    </button>`;
  }

  /** Resalta la categoría visible mientras se hace scroll */
  function spyCategories() {
    if (!('IntersectionObserver' in window)) return;
    const links = $$('.c-cats a', root);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const id = /** @type {HTMLElement} */ (en.target).dataset.sec;
        links.forEach((a) => {
          const on = a.dataset.cat === id;
          a.classList.toggle('on', on);
          if (on) a.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('[data-sec]', root).forEach((s) => io.observe(s));
  }

  function drawCartBar() {
    const m = /** @type {PZ.CartaMenu} */ (menu);
    const bar = $('.c-cartbar', root);
    if (!bar) return;
    const t = C.totals(m, cart);
    bar.classList.toggle('hidden', !t.count);
    bar.innerHTML = `<span class="cb-count">${t.count}</span><span class="cb-txt">Ver mi pedido</span><b>${money(t.subtotal)}</b>`;
  }

  function bump() {
    const bar = $('.c-cartbar', root);
    if (!bar || reduceMotion) return;
    bar.classList.remove('bump');
    void bar.offsetWidth;
    bar.classList.add('bump');
  }

  /* ---------------- hojas (paneles que suben desde abajo) ---------------- */
  /** @param {string} html @param {{ onClose?: () => void, wide?: boolean }} [opts] */
  function sheet(html, opts = {}) {
    const back = document.createElement('div');
    back.className = 'c-sheet-back';
    back.innerHTML = `<div class="c-sheet ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="c-x" aria-label="Cerrar">✕</button>${html}</div>`;
    document.body.appendChild(back);
    document.body.classList.add('c-lock');
    requestAnimationFrame(() => back.classList.add('show'));
    const el = /** @type {HTMLElement} */ (back.querySelector('.c-sheet'));
    const close = () => {
      back.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => { back.remove(); if (!document.querySelector('.c-sheet-back')) document.body.classList.remove('c-lock'); }, 260);
      if (opts.onClose) opts.onClose();
    };
    const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    $('.c-x', el).onclick = close;
    setTimeout(() => { const f = /** @type {HTMLElement | null} */ (el.querySelector('[autofocus]')); if (f) f.focus(); }, 80);
    return { el, close };
  }

  /* ---------------- producto ---------------- */
  /** @param {string} id */
  function openProduct(id) {
    const m = /** @type {PZ.CartaMenu} */ (menu);
    const p = m.products.find((x) => x.id === id);
    if (!p) return;
    const cat = m.categories.find((c) => c.id === p.categoryId);
    const allowHalf = !!(cat && cat.allowHalf);
    const halves = allowHalf ? m.products.filter((x) => x.id !== p.id && m.categories.some((c) => c.id === x.categoryId && c.allowHalf)) : [];
    const on = { ...C.defaults(), ...m.settings.online };
    /** @type {PZ.Condiment[]} */
    const condiments = Array.isArray(on.condiments) && on.condiments.length
      ? on.condiments
      : [
          { id: 'oregano', name: 'Orégano', default: true },
          { id: 'chimi', name: 'Chimi', default: true },
        ];
    /** @type {Record<string, boolean>} */
    const condState = Object.fromEntries(condiments.map((c) => [c.id, c.default !== false]));
    /** @type {PZ.CartLine} */
    const line = { key: '', productId: p.id, variantId: p.variants[0].id, halfId: '', extras: [], qty: 1, notes: '' };
    const photo = on.showPhotos && p.photo ? `<div class="c-sheet-photo"><img src="${esc(p.photo)}" alt=""></div>` : '';

    const s = sheet(`
      ${photo}
      <h3>${esc(p.name)}</h3>
      ${p.desc ? `<p class="c-muted">${esc(p.desc)}</p>` : ''}
      ${p.variants.length > 1 ? `<div class="c-opt-title">Tamaño</div><div class="c-opts" data-g="v">${p.variants.map((v) => `<button class="c-opt" data-v="${esc(v.id)}">${esc(v.name)}<small>${money(v.price)}</small></button>`).join('')}</div>` : ''}
      ${halves.length ? `<div class="c-opt-title">¿Mitad y mitad?</div>
        <div class="c-half"><span class="c-half-pz" aria-hidden="true"><i class="h1" style="background:${esc(p.color || '#ffd166')}"></i><i class="h2"></i></span>
          <select class="c-select" data-g="h" aria-label="Otra mitad"><option value="">Entera de ${esc(p.name)}</option>${halves.map((h) => `<option value="${esc(h.id)}">½ ${esc(p.name)} + ½ ${esc(h.name)}</option>`).join('')}</select></div>
        <p class="c-muted small">${m.settings.halfPricing === 'avg' ? 'Se cobra el promedio de las dos mitades.' : 'Se cobra la mitad de mayor precio.'}</p>` : ''}
      ${allowHalf && condiments.length ? `
        <div class="c-opt-title">Condimentos <small class="c-muted" style="font-weight:normal">(tocá para elegir o quitar)</small></div>
        <div class="c-opts c-conds" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px;margin-bottom:12px;">
          ${condiments.map((c) => `<button type="button" class="c-opt ${condState[c.id] ? 'on' : ''}" data-cid="${esc(c.id)}"></button>`).join('')}
        </div>` : ''}
      ${allowHalf && m.extras.length ? `<div class="c-extras-wrap"><div class="c-opt-title">Agregados</div><div class="c-opts" data-g="x"></div></div>` : ''}
      <div class="c-opt-title">Aclaraciones</div>
      <input class="c-input" data-g="n" maxlength="140" placeholder="Ej: bien cocida, sin aceitunas…">
      <div class="c-sheet-foot">
        <div class="c-qty"><button data-q="-1" aria-label="Menos">−</button><span aria-live="polite">1</span><button data-q="1" aria-label="Más">+</button></div>
        <button class="c-btn primary grow" data-a="add"></button>
      </div>`);
    const E = s.el;

    const renderConds = () => {
      if (!allowHalf) return;
      condiments.forEach((c) => {
        const btn = /** @type {HTMLElement | null} */ (E.querySelector(`[data-cid="${c.id}"]`));
        if (!btn) return;
        const isOn = !!condState[c.id];
        const isDefault = c.default !== false;
        btn.className = `c-opt ${isOn ? 'on' : ''}`;
        if (isOn) {
          btn.innerHTML = `🌿 Con ${esc(c.name)}<small>${isDefault ? 'Incluido' : 'Agregado'}</small>`;
        } else {
          btn.innerHTML = isDefault
            ? `<span style="color:#b3261e">❌ Sin ${esc(c.name)}</span><small style="color:#b3261e">Quitar</small>`
            : `<span style="color:var(--c-muted)">Sin ${esc(c.name)}</span><small>Opcional</small>`;
        }
      });
    };
    if (allowHalf) {
      condiments.forEach((c) => {
        const btn = /** @type {HTMLElement | null} */ (E.querySelector(`[data-cid="${c.id}"]`));
        if (btn) {
          btn.onclick = () => {
            condState[c.id] = !condState[c.id];
            renderConds();
          };
        }
      });
      renderConds();
    }

    const draw = () => {
      $$('[data-v]', E).forEach((b) => b.classList.toggle('on', b.dataset.v === line.variantId));
      const h2 = E.querySelector('.h2');
      const half = m.products.find((x) => x.id === line.halfId);
      if (h2) {
        /** @type {HTMLElement} */ (h2).style.background = half ? (half.color || '#ffd166') : (p.color || '#ffd166');
        /** @type {HTMLElement} */ (E.querySelector('.c-half-pz')).classList.toggle('split', !!half);
      }
      if (allowHalf && m.extras.length) {
        const wrap = /** @type {HTMLElement | null} */ (E.querySelector('.c-extras-wrap'));
        const xg = E.querySelector('[data-g=x]');
        if (xg && wrap) {
          const visibleExtras = m.extras.filter((x) => C.extraApplies ? C.extraApplies(x, p, half) : true);
          line.extras = line.extras.filter((xId) => visibleExtras.some((ve) => ve.id === xId));
          wrap.style.display = visibleExtras.length ? '' : 'none';
          xg.innerHTML = visibleExtras.map((x) => `<button type="button" class="c-opt ${line.extras.includes(x.id) ? 'on' : ''}" data-x="${esc(x.id)}">${esc(x.name)}<small>${x.price ? '+ ' + money(x.price) : 'sin cargo'}</small></button>`).join('');
          $$('[data-x]', xg).forEach((b) => b.onclick = () => {
            const x = b.dataset.x || '';
            line.extras = line.extras.includes(x) ? line.extras.filter((y) => y !== x) : line.extras.concat(x);
            draw();
          });
        }
      }
      $('.c-qty span', E).textContent = String(line.qty);
      const pl = C.priceLine(m, line);
      $('[data-a=add]', E).textContent = `Agregar · ${money(pl ? pl.unit * line.qty : 0)}`;
    };
    $$('[data-v]', E).forEach((b) => b.onclick = () => { line.variantId = b.dataset.v || line.variantId; draw(); });
    const hs = /** @type {HTMLSelectElement | null} */ (E.querySelector('[data-g=h]'));
    if (hs) hs.onchange = () => { line.halfId = hs.value; draw(); };
    $$('[data-q]', E).forEach((b) => b.onclick = () => { line.qty = Math.max(1, Math.min(50, line.qty + Number(b.dataset.q))); draw(); });
    $('[data-a=add]', E).onclick = () => {
      let userNotes = inp('[data-g=n]', E).value.trim().slice(0, 140);
      const tags = [];
      if (allowHalf) {
        condiments.forEach((c) => {
          const isDefault = c.default !== false;
          const isSelected = !!condState[c.id];
          if (isDefault && !isSelected) tags.push(`Sin ${c.name.toLowerCase()}`);
          else if (!isDefault && isSelected) tags.push(`Con ${c.name.toLowerCase()}`);
        });
      }
      if (tags.length) {
        userNotes = tags.join(' · ') + (userNotes ? ` · ${userNotes}` : '');
      }
      line.notes = userNotes;
      line.key = [line.productId, line.variantId, line.halfId, line.extras.slice().sort().join('+'), line.notes].join('|');
      const same = cart.find((l) => l.key === line.key);
      if (same) same.qty = Math.min(50, same.qty + line.qty);
      else cart.push(line);
      saveCart();
      s.close();
      drawList();
      drawCartBar();
      bump();
      vibrate(15);
      const added = C.priceLine(m, line);
      toast(`${line.qty > 1 ? line.qty + ' × ' : ''}${added ? added.name : p.name} al pedido`);
    };
    draw();
  }

  /* ---------------- carrito y datos ---------------- */
  function openCart() {
    const m = /** @type {PZ.CartaMenu} */ (menu);
    const on = { ...C.defaults(), ...m.settings.online };
    const types = /** @type {PZ.WebOrderType[]} */ (['retiro', 'delivery', 'mesa']).filter((t) => on.types[t]);
    const pays = /** @type {PZ.WebPayMethod[]} */ (['efectivo', 'transferencia', 'tarjeta']).filter((p) => on.payments[p]);
    let type = /** @type {PZ.WebOrderType} */ (tableParam && types.includes('mesa') ? 'mesa' : types.includes(/** @type {any} */ (me.type)) ? me.type : types[0] || 'retiro');
    let pay = /** @type {PZ.WebPayMethod} */ (pays.includes(/** @type {any} */ (me.payment)) ? me.payment : pays[0] || 'efectivo');
    let step = 1;
    let sending = false;

    const s = sheet('<div class="c-cart"></div>', { wide: true, onClose: () => { drawList(); drawCartBar(); } });
    const box = $('.c-cart', s.el);

    const draw = () => {
      const t = C.totals(m, cart, { type, zoneId: inp('[name=zone]', box) ? inp('[name=zone]', box).value : me.zoneId });
      if (!cart.length) {
        box.innerHTML = '<div class="c-none"><div class="c-pizza-big" aria-hidden="true">🧺</div><p>Tu pedido está vacío.<br>Tocá un producto para agregarlo.</p></div>';
        return;
      }
      if (step === 1) {
        box.innerHTML = `
          <h3>🧺 Tu pedido</h3>
          <div class="c-lines">${cart.map((l, i) => {
            const pl = C.priceLine(m, l);
            if (!pl) return '';
            return `<div class="c-line">
              <div class="c-qty sm"><button data-d="-1" data-i="${i}" aria-label="Menos">−</button><span>${l.qty}</span><button data-d="1" data-i="${i}" aria-label="Más">+</button></div>
              <div class="grow"><b>${esc(pl.name)}</b>${pl.variantName ? ` <span class="c-muted">${esc(pl.variantName)}</span>` : ''}
                ${pl.extras.length ? `<div class="c-muted small">+ ${pl.extras.map((x) => esc(x.name)).join(', ')}</div>` : ''}
                ${l.notes ? `<div class="c-muted small">» ${esc(l.notes)}</div>` : ''}</div>
              <b class="nowrap">${money(pl.unit * l.qty)}</b></div>`;
          }).join('')}</div>
          <div class="c-sum"><span>Subtotal</span><b>${money(t.subtotal)}</b></div>
          ${on.minOrder && t.subtotal < on.minOrder ? `<div class="c-warn">El pedido mínimo es de ${money(on.minOrder)}. Te faltan ${money(on.minOrder - t.subtotal)}.</div>` : ''}
          <div class="c-sheet-foot">
            <button class="c-btn ghost" data-a="more">Seguir pidiendo</button>
            <button class="c-btn primary grow" data-a="next" ${on.minOrder && t.subtotal < on.minOrder ? 'disabled' : ''}>Continuar →</button>
          </div>`;
        $$('[data-d]', box).forEach((b) => b.onclick = () => {
          const l = cart[Number(b.dataset.i)];
          l.qty += Number(b.dataset.d);
          if (l.qty <= 0) cart.splice(Number(b.dataset.i), 1);
          saveCart();
          draw();
        });
        $('[data-a=more]', box).onclick = () => s.close();
        $('[data-a=next]', box).onclick = () => { step = 2; draw(); s.el.scrollTop = 0; };
        return;
      }

      const open = C.isOpen(on) && m.open;
      const zones = m.settings.zones || [];
      box.innerHTML = `
        <h3>📝 Tus datos</h3>
        ${types.length > 1 ? `<div class="c-seg" role="radiogroup" aria-label="Tipo de pedido">${types.map((k) => `<button role="radio" aria-checked="${k === type}" class="${k === type ? 'on' : ''}" data-t="${k}">${k === 'retiro' ? '🥡 Retiro' : k === 'delivery' ? '🛵 Delivery' : '🍽️ En el local'}</button>`).join('')}</div>` : `<p class="c-muted">${esc(C.TYPE_LABEL[type])}</p>`}
        <form class="c-form" novalidate>
          <label class="c-field"><span>Nombre y apellido</span><input name="name" autocomplete="name" maxlength="80" value="${esc(me.name)}" required></label>
          <label class="c-field"><span>Teléfono / WhatsApp</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" placeholder="Ej: 11 5555-1234" value="${esc(me.phone)}" required></label>
          ${type === 'delivery' ? `
            ${(on.deliveryFields && on.deliveryFields.separateAddress) ? `
              <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px">
                <label class="c-field"><span>Calle</span><input name="street" autocomplete="address-line1" maxlength="120" placeholder="Ej: Av. San Martín" value="${esc(me.street || '')}" required></label>
                <label class="c-field"><span>Número / Altura</span><input name="streetNum" inputmode="numeric" maxlength="10" placeholder="Ej: 1420" value="${esc(me.streetNum || '')}" required></label>
              </div>
            ` : `
              <label class="c-field"><span>Dirección de entrega</span><input name="address" autocomplete="street-address" maxlength="200" placeholder="Calle, número, piso, depto" value="${esc(me.address)}" required></label>
            `}
            ${(on.deliveryFields && on.deliveryFields.floorDept) ? `
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <label class="c-field"><span>Piso (opcional)</span><input name="floor" maxlength="10" placeholder="Ej: 3" value="${esc(me.floor || '')}"></label>
                <label class="c-field"><span>Depto (opcional)</span><input name="dept" maxlength="10" placeholder="Ej: B" value="${esc(me.dept || '')}"></label>
              </div>
            ` : ''}
            ${(on.deliveryFields && on.deliveryFields.crossStreets) ? `<label class="c-field"><span>Entre qué calles (opcional)</span><input name="crossStreets" maxlength="120" placeholder="Ej: Belgrano y Moreno" value="${esc(me.crossStreets || '')}"></label>` : ''}
            ${(on.deliveryFields && on.deliveryFields.notes) ? `<label class="c-field"><span>Aclaraciones para la entrega (opcional)</span><input name="deliveryNotes" maxlength="150" placeholder="Ej: timbre blanco, reja negra" value="${esc(me.deliveryNotes || '')}"></label>` : ''}
            ${zones.length ? `<label class="c-field"><span>Zona de envío</span><select name="zone" class="c-select">${zones.map((z) => `<option value="${esc(z.id)}" ${z.id === me.zoneId ? 'selected' : ''}>${esc(z.name)} · ${money(z.fee)}</option>`).join('')}</select></label>` : '<p class="c-muted small">El costo de envío te lo confirmamos por WhatsApp.</p>'}` : ''}
          ${type === 'mesa' ? `<label class="c-field"><span>Número de mesa</span><input name="table" inputmode="numeric" maxlength="10" value="${esc(tableParam)}" required></label>` : ''}
          ${pays.length ? `<div class="c-opt-title">¿Cómo pagás?</div>
            <div class="c-opts">${pays.map((k) => `<button type="button" class="c-opt ${k === pay ? 'on' : ''}" data-pay="${k}">${k === 'efectivo' ? '💵' : k === 'transferencia' ? '🏦' : '💳'} ${esc(C.PAY_LABEL[k])}</button>`).join('')}</div>` : ''}
          ${pay === 'efectivo' ? '<label class="c-field"><span>¿Con cuánto pagás? (opcional, para llevarte el vuelto)</span><input name="cash" inputmode="numeric" placeholder="Ej: 20000"></label>' : ''}
          ${pay === 'transferencia' && m.settings.transfer && (m.settings.transfer.alias || m.settings.transfer.cbu) ? `<p class="c-muted small">Al enviar el pedido te mostramos el alias para transferir.</p>` : ''}
          <label class="c-field"><span>Aclaraciones (opcional)</span><input name="notes" maxlength="300" placeholder="Ej: timbre 2B, sin cebolla, llamar al llegar"></label>
          <input name="website" class="c-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
          <div class="c-total-box">
            ${t.deliveryFee ? `<div class="c-sum"><span>Subtotal</span><span>${money(t.subtotal)}</span></div><div class="c-sum"><span>Envío</span><span>${money(t.deliveryFee)}</span></div>` : ''}
            <div class="c-sum big"><span>Total</span><b>${money(t.total)}</b></div>
          </div>
          ${!open ? `<div class="c-warn">${on.paused ? 'Los pedidos online están pausados en este momento.' : `Ahora estamos cerrados. Tomamos pedidos ${esc(C.hoursText(on.hours))}.`}</div>` : ''}
          <div class="c-err hidden" role="alert"></div>
          <div class="c-sheet-foot">
            <button type="button" class="c-btn ghost" data-a="back">← Volver</button>
            <button type="submit" class="c-btn wa grow" ${open ? '' : 'disabled'}><span aria-hidden="true">🟢</span> Enviar pedido por WhatsApp</button>
          </div>
          <p class="c-muted small center">Te abrimos WhatsApp con el pedido listo para mandar al local.</p>
        </form>`;
      const form = /** @type {HTMLFormElement} */ (box.querySelector('form'));
      const keep = () => {
        // conserva lo escrito al redibujar
        ['name', 'phone', 'address', 'street', 'streetNum', 'floor', 'dept', 'crossStreets', 'deliveryNotes'].forEach((k) => { const x = inp(`[name=${k}]`, box); if (x) /** @type {any} */ (me)[k] = x.value; });
        const z = inp('[name=zone]', box);
        if (z) me.zoneId = z.value;
      };
      $$('[data-t]', box).forEach((b) => b.onclick = () => { keep(); type = /** @type {PZ.WebOrderType} */ (b.dataset.t); draw(); });
      $$('[data-pay]', box).forEach((b) => b.onclick = () => { keep(); pay = /** @type {PZ.WebPayMethod} */ (b.dataset.pay); draw(); });
      const zs = inp('[name=zone]', box);
      if (zs) zs.onchange = () => { keep(); draw(); };
      $('[data-a=back]', box).onclick = () => { keep(); step = 1; draw(); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (sending) return;
        const f = (/** @type {string} */ n) => { const x = inp(`[name=${n}]`, form); return x ? x.value.trim() : ''; };
        const err = $('.c-err', form);
        const fail = (/** @type {string} */ msg, /** @type {string} */ field = '') => {
          err.textContent = msg;
          err.classList.remove('hidden');
          const x = field && inp(`[name=${field}]`, form);
          if (x) x.focus();
        };
        err.classList.add('hidden');
        if (f('website')) return; // formulario completado por un robot
        if (f('name').length < 2) return fail('Escribí tu nombre', 'name');
        if (f('phone').replace(/\D/g, '').length < 8) return fail('Revisá tu teléfono (con característica)', 'phone');

        let addressVal = f('address');
        const df = on.deliveryFields || {};
        if (type === 'delivery') {
          if (df.separateAddress) {
            if (f('street').length < 2) return fail('Falta la calle', 'street');
            if (!f('streetNum')) return fail('Falta la altura / número', 'streetNum');
            addressVal = `${f('street')} ${f('streetNum')}`.trim();
          } else if (addressVal.length < 5) {
            return fail('Falta la dirección de entrega', 'address');
          }
          if (df.floorDept && (f('floor') || f('dept'))) {
            const fd = [f('floor') ? 'Piso ' + f('floor') : '', f('dept') ? 'Dpto ' + f('dept') : ''].filter(Boolean).join(' ');
            addressVal += (addressVal ? ', ' : '') + fd;
          }
          if (df.crossStreets && f('crossStreets')) {
            addressVal += ` (entre ${f('crossStreets')})`;
          }
          if (df.notes && f('deliveryNotes')) {
            addressVal += ` [${f('deliveryNotes')}]`;
          }
        }
        if (type === 'mesa' && !f('table')) return fail('Indicá el número de mesa', 'table');
        keep();
        me = { ...me, type, payment: pay, address: addressVal };
        save('pz-carta-me', me);
        const payload = {
          type, name: f('name'), phone: f('phone'), address: addressVal, zoneId: f('zone') || null, table: f('table'),
          payment: pay, cashWith: f('cash').replace(/\D/g, ''), notes: f('notes'),
          items: cart.map((l) => ({ productId: l.productId, variantId: l.variantId, halfId: l.halfId, extras: l.extras, qty: l.qty, notes: l.notes })),
        };
        const btn = /** @type {HTMLButtonElement} */ (form.querySelector('[type=submit]'));
        sending = true;
        btn.disabled = true;
        btn.textContent = 'Enviando…';
        try {
          const order = preview ? fakeOrder(payload) : /** @type {PZ.WebOrder} */ (await rpc('carta_order', { p_slug: slug, p_order: payload }));
          if (!preview) {
            cart = [];
            saveCart();
            const recent = load(`pz-carta-orders-${slug}`, /** @type {any[]} */ ([]));
            save(`pz-carta-orders-${slug}`, (Array.isArray(recent) ? recent : []).concat({ id: order.id, number: order.number, at: Date.now() }).slice(-5));
          }
          s.close();
          done(order);
        } catch (ex) {
          fail(ex.message || 'No se pudo enviar el pedido');
          btn.disabled = false;
          btn.innerHTML = '<span aria-hidden="true">🟢</span> Enviar pedido por WhatsApp';
        } finally {
          sending = false;
        }
      };
    };
    draw();
  }

  /** En la vista previa no se guarda nada: se arma el pedido acá mismo
   * @param {any} p @returns {PZ.WebOrder} */
  function fakeOrder(p) {
    const m = /** @type {PZ.CartaMenu} */ (menu);
    const items = /** @type {PZ.OrderItem[]} */ (cart.map((l) => {
      const pl = /** @type {NonNullable<ReturnType<typeof C.priceLine>>} */ (C.priceLine(m, l));
      return { id: l.key, productId: l.productId, variantId: pl.variant.id, variantName: pl.variantName, half: pl.half ? { productId: pl.half.id, name: pl.half.name } : null, name: pl.name, extras: pl.extras, qty: l.qty, unitPrice: pl.unit, total: pl.unit * l.qty, notes: l.notes };
    }));
    const t = C.totals(m, cart, { type: p.type, zoneId: p.zoneId });
    const zone = (m.settings.zones || []).find((z) => z.id === p.zoneId);
    return {
      id: 'vista-previa', number: 123, createdAt: new Date().toISOString(), type: p.type, name: p.name, phone: p.phone,
      address: p.type === 'delivery' ? p.address : '', zoneId: zone ? zone.id : null, zoneName: zone && p.type === 'delivery' ? zone.name : null,
      table: p.table, payment: p.payment, cashWith: Number(p.cashWith) || null, notes: p.notes, items,
      subtotal: t.subtotal, deliveryFee: t.deliveryFee, total: t.total,
    };
  }

  /* ---------------- pedido enviado ---------------- */
  /** @param {PZ.WebOrder} o */
  function done(o) {
    const m = /** @type {PZ.CartaMenu} */ (menu);
    const on = { ...C.defaults(), ...m.settings.online };
    const b = m.settings.business || {};
    const trackUrl = preview ? '' : `${location.origin}${location.pathname}?l=${encodeURIComponent(slug)}&pedido=${encodeURIComponent(o.id)}`;
    const text = C.waMessage({ business: b.name || m.branch.org, branch: m.branch.name }, o, { trackUrl, transfer: m.settings.transfer });
    const wa = C.waLink(on.whatsapp, text);
    const t = m.settings.transfer;
    const s = sheet(`
      <div class="c-done">
        <div class="c-check" aria-hidden="true">✓</div>
        <h3>${preview ? 'Así llegaría el pedido' : `¡Pedido W-${o.number} listo!`}</h3>
        <p>${preview ? 'En la vista previa no se guarda nada. Este es el mensaje que recibiría el local:' : 'Tocá el botón para mandarlo por WhatsApp. El local lo confirma por ahí.'}</p>
        ${preview ? `<pre class="c-wa-preview">${esc(text)}</pre>` : `<a class="c-btn wa block big" href="${esc(wa)}" target="_blank" rel="noopener" data-a="wa"><span aria-hidden="true">🟢</span> Enviar por WhatsApp</a>`}
        ${o.payment === 'transferencia' && t && (t.alias || t.cbu) ? `<div class="c-bank">
          <div class="c-opt-title">Datos para transferir ${money(o.total)}</div>
          ${t.alias ? `<div class="c-bk"><span>Alias</span><b>${esc(t.alias)}</b><button class="c-btn sm ghost" data-copy="${esc(t.alias)}">Copiar</button></div>` : ''}
          ${t.cbu ? `<div class="c-bk"><span>CBU/CVU</span><b>${esc(t.cbu)}</b><button class="c-btn sm ghost" data-copy="${esc(t.cbu)}">Copiar</button></div>` : ''}
          ${t.holder ? `<div class="c-bk"><span>Titular</span><b>${esc(t.holder)}</b></div>` : ''}
        </div>` : ''}
        ${trackUrl ? `<a class="c-btn ghost block" href="${esc(trackUrl)}">📦 Seguir mi pedido</a>` : ''}
      </div>`, { onClose: () => { if (!preview) { drawList(); drawCartBar(); } } });
    $$('[data-copy]', s.el).forEach((btn) => btn.onclick = async () => {
      try { await navigator.clipboard.writeText(btn.dataset.copy || ''); toast('Copiado'); } catch (e) { toast('No se pudo copiar', 'warn'); }
    });
    drawList();
    drawCartBar();
    // En el celular abre WhatsApp solo; el botón queda por si el navegador no lo permite
    if (!preview && on.whatsapp && window.matchMedia('(pointer: coarse)').matches) setTimeout(() => { location.href = wa; }, 900);
  }

  /* ---------------- seguimiento ---------------- */
  const STEPS = [
    ['nuevo', '📨', 'Recibido', 'Esperando que el local lo confirme'],
    ['pendiente', '✅', 'Confirmado', 'El local aceptó tu pedido'],
    ['horno', '🔥', 'En el horno', 'Lo estamos preparando'],
    ['listo', '🍕', 'Listo', 'Tu pedido está listo'],
    ['en_camino', '🛵', 'En camino', 'Ya salió para tu casa'],
    ['entregado', '🏁', 'Entregado', '¡Que lo disfrutes!'],
  ];

  /** @type {any} */
  let trackMap = null;
  /** @type {any} */
  let trackMotoMarker = null;
  /** @type {any} */
  let trackTimer = null;
  /** @type {string|null} */
  let lastTrackStatus = null;
  /** @type {boolean} */
  let lastHadGps = false;

  async function renderTrack() {
    const m = /** @type {PZ.CartaMenu} */ (menu);
    applyTheme({ ...C.defaults(), ...m.settings.online });
    const b = m.settings.business || {};
    let info;
    try { info = await rpc('carta_order_status', { p_id: trackId }); } catch (e) { info = null; }
    if (!info) return fatal('No encontramos el pedido', 'Revisá el link o escribile al local por WhatsApp.');
    const status = info.status === 'rechazado' ? 'rechazado' : info.status === 'nuevo' ? 'nuevo' : (info.orderStatus === 'preparando' ? 'horno' : info.orderStatus || 'pendiente');
    const steps = STEPS.filter(([k]) => k !== 'en_camino' || info.type === 'delivery');
    const idx = steps.findIndex(([k]) => k === status);
    const on = { ...C.defaults(), ...m.settings.online };

    /** @type {any} */
    let liveLoc = null;
    if (info.type === 'delivery' && status === 'en_camino') {
      try {
        liveLoc = await rpc('carta_delivery_location', { p_order_id: trackId });
      } catch (e) {
        liveLoc = null;
      }
    }

    const hasLiveGps = !!(liveLoc && liveLoc.lat && liveLoc.lng);

    // Si el mapa ya está en pantalla y seguimos en camino con GPS, movemos la moto suavemente sin destruir el mapa ni recargar
    const existingMapEl = document.getElementById('live-delivery-map');
    if (trackMap && trackMotoMarker && hasLiveGps && existingMapEl && lastTrackStatus === status && lastHadGps === hasLiveGps) {
      try {
        trackMotoMarker.setLatLng([liveLoc.lat, liveLoc.lng]);
        trackMap.panTo([liveLoc.lat, liveLoc.lng], { animate: true, duration: 1.5 });
      } catch (err) {
        console.warn('Error actualizando posición de moto:', err);
      }
      const pill = document.getElementById('live-gps-pill');
      if (pill) {
        pill.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2e7d32;animation:c-pulse 1.4s infinite"></span> GPS en vivo (${esc(liveLoc ? liveLoc.driver : 'Repartidor')})`;
      }
      clearTimeout(trackTimer);
      trackTimer = setTimeout(renderTrack, 7000);
      return;
    }

    lastTrackStatus = status;
    lastHadGps = hasLiveGps;

    root.innerHTML = `
      <header class="c-hero small"><div class="c-hero-in"><h1>${esc(b.name || m.branch.org)}</h1><p class="c-slogan">Pedido W-${esc(String(info.number))}</p></div></header>
      <main class="c-main">
        ${status === 'rechazado' || status === 'cancelado' ? `<div class="c-warn">😔 El local no pudo tomar este pedido${info.reason ? `: ${esc(info.reason)}` : '.'}</div>` : `
        <ol class="c-track">${steps.map(([k, ico, title, sub], i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}"><span class="t-ico" aria-hidden="true">${ico}</span><div><b>${title}</b><small>${i === idx ? sub : ''}</small></div></li>`).join('')}</ol>`}
        ${(info.type === 'delivery' && (info.address || hasLiveGps) && status !== 'rechazado' && status !== 'cancelado') ? `
          <div class="c-card-plain" style="margin-top:14px;padding:14px;text-align:left">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <b>🛵 Seguimiento del envío</b>
              <span class="c-badge ${status === 'en_camino' ? 'open' : ''}">${status === 'en_camino' ? (hasLiveGps ? '🛵 Repartidor en viaje' : '🛵 En camino') : status === 'listo' ? '🍕 Listo para salir' : '🔥 En preparación'}</span>
            </div>
            ${info.address ? `<p class="c-muted small" style="margin:0 0 10px">📍 Entrega en: <b>${esc(info.address)}</b></p>` : ''}
            ${hasLiveGps ? `
              <div style="position:relative;border-radius:12px;overflow:hidden;border:1px solid rgba(0,0,0,0.08);background:#f2efe9">
                <div id="live-delivery-map" style="width:100%;height:250px;"></div>
                <div style="position:absolute;bottom:8px;left:8px;right:8px;display:flex;justify-content:space-between;align-items:center;pointer-events:none;z-index:999">
                  <div id="live-gps-pill" style="background:rgba(255,255,255,0.95);padding:5px 12px;border-radius:20px;font-size:0.8em;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.18);color:#1b4332;display:flex;align-items:center;gap:6px">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2e7d32;animation:c-pulse 1.4s infinite"></span>
                    GPS en vivo (${esc(liveLoc ? liveLoc.driver : 'Repartidor')})
                  </div>
                  <div style="background:rgba(255,255,255,0.95);padding:5px 12px;border-radius:20px;font-size:0.8em;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.18)">
                    ⏱️ En viaje
                  </div>
                </div>
              </div>
            ` : `
              <div style="position:relative;border-radius:12px;overflow:hidden;border:1px solid rgba(0,0,0,0.08);background:#f2efe9">
                <iframe width="100%" height="220" style="border:0;display:block" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"
                  src="https://maps.google.com/maps?q=${encodeURIComponent(info.address + (b.city ? ', ' + b.city : ''))}&t=&z=15&ie=UTF8&iwloc=&output=embed"></iframe>
                <div style="position:absolute;bottom:8px;right:8px;background:rgba(255,255,255,0.92);padding:4px 10px;border-radius:20px;font-size:0.8em;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.15)">
                  ${status === 'en_camino' ? `⏱️ Llegada estimada ~${Math.max(5, (on.deliveryMinutes || 40) - 20)} min` : `⏱️ Demora total estimada ~${on.deliveryMinutes || 40} min`}
                </div>
              </div>
            `}
            <div style="margin-top:8px;text-align:right">
              <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.address + (b.city ? ', ' + b.city : ''))}" target="_blank" rel="noopener" class="small" style="color:var(--c-primary, #d7263d);font-weight:600">Ver en Google Maps ↗</a>
            </div>
          </div>` : ''}
        <div class="c-card-plain">
          ${(info.items || []).map((/** @type {PZ.OrderItem} */ it) => `<div class="c-sum"><span>${it.qty} × ${esc(it.name)}${it.variantName ? ` (${esc(it.variantName)})` : ''}</span><span>${money(it.unitPrice * it.qty)}</span></div>`).join('')}
          <div class="c-sum big"><span>Total</span><b>${money(info.total)}</b></div>
        </div>
        ${on.whatsapp ? `<a class="c-btn wa block" href="${esc(C.waLink(on.whatsapp, `Hola! Consulto por mi pedido W-${info.number}`))}" target="_blank" rel="noopener">💬 Escribir al local</a>` : ''}
        <a class="c-btn ghost block" href="?l=${encodeURIComponent(slug)}">← Volver a la carta</a>
        <p class="c-muted small center">Esta pantalla se actualiza sola.</p>
      </main>`;

    const Leaflet = /** @type {any} */ (window).L;
    if (hasLiveGps && Leaflet && liveLoc) {
      const mapEl = document.getElementById('live-delivery-map');
      if (mapEl) {
        try {
          if (trackMap) {
            trackMap.remove();
            trackMap = null;
            trackMotoMarker = null;
          }
          trackMap = Leaflet.map(mapEl, { zoomControl: false, attributionControl: false }).setView([liveLoc.lat, liveLoc.lng], 16);
          Leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(trackMap);
          const motoHtml = `<div style="background:#fff;border:2.5px solid var(--c-primary,#d7263d);border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.3);font-size:20px;transform:translate(-50%,-50%)">🛵</div>`;
          const icon = Leaflet.divIcon({ className: 'c-moto-marker', html: motoHtml, iconSize: [0, 0] });
          trackMotoMarker = Leaflet.marker([liveLoc.lat, liveLoc.lng], { icon }).addTo(trackMap);
        } catch (err) {
          console.warn('Error inicializando mapa Leaflet:', err);
        }
      }
    } else if (trackMap) {
      trackMap.remove();
      trackMap = null;
      trackMotoMarker = null;
    }

    const pollInterval = (status === 'en_camino') ? 7000 : 15000;
    if (!['entregado', 'rechazado', 'cancelado'].includes(status)) {
      clearTimeout(trackTimer);
      trackTimer = setTimeout(renderTrack, pollInterval);
    }
  }

  boot();
})();
