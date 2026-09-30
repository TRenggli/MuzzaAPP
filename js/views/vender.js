// @ts-check
/* ==========================================================================
   Vista: VENDER — punto de venta + cobro
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  const L = () => PZ.labels;

  const CART_KEY = 'pz-cart';
  const emptyCart = () => ({ type: 'mostrador', items: [], customerId: null, customerName: '', phone: '', address: '', zoneId: null, deliveryFee: 0, table: '', discount: null, notes: '', eta: '', driver: '' });
  let cart = (() => { try { return JSON.parse(sessionStorage.getItem(CART_KEY) || 'null') || emptyCart(); } catch (e) { return emptyCart(); } })();
  let activeCat = null;
  let query = '';
  const saveCart = () => sessionStorage.setItem(CART_KEY, JSON.stringify(cart));

  function cartTotals() {
    const o = { ...cart, items: cart.items };
    return S.computeTotals(o);
  }

  /* ======================= Render principal ======================= */
  function render(el) {
    const cats = S.data.categories;
    if (!activeCat || !cats.find((c) => c.id === activeCat)) activeCat = cats[0] && cats[0].id;
    el.innerHTML = `
      <div class="pos">
        <section>
          <div class="pos-search"><input type="search" placeholder="🔎 Buscar producto…" value="${U.esc(query)}"></div>
          <div class="pos-cats"></div>
          <div class="prod-grid"></div>
        </section>
        <aside class="card cart"></aside>
      </div>
      <button class="cart-fab hidden"></button>`;

    const search = el.querySelector('.pos-search input');
    search.addEventListener('input', () => { query = search.value; renderProducts(el); });
    renderCats(el);
    renderProducts(el);
    renderCart(el);
    el.querySelector('.cart-fab').onclick = () => el.querySelector('.cart').classList.add('open');
  }

  function renderCats(el) {
    el.querySelector('.pos-cats').innerHTML = S.data.categories.map((c) =>
      `<button class="cat-btn ${c.id === activeCat && !query ? 'on' : ''}" data-c="${c.id}"><span class="c-ico">${c.icon}</span>${U.esc(c.name)}</button>`).join('');
    el.querySelectorAll('.cat-btn').forEach((b) => b.onclick = () => {
      activeCat = b.dataset.c;
      query = '';
      el.querySelector('.pos-search input').value = '';
      renderCats(el);
      renderProducts(el);
    });
  }

  function renderProducts(el) {
    const q = U.stripAccents(query.toLowerCase().trim());
    let list = S.data.products.filter((p) => p.active);
    list = q ? list.filter((p) => U.stripAccents((p.name + ' ' + (p.desc || '')).toLowerCase()).includes(q)) : list.filter((p) => p.categoryId === activeCat);
    const grid = el.querySelector('.prod-grid');
    if (!list.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><span class="e-ico">🍕</span>No hay productos acá${q ? ' con “' + U.esc(query) + '”' : ''}.</div>`;
      return;
    }
    grid.innerHTML = list.map((p, i) => {
      const cat = S.category(p.categoryId);
      const isPizza = cat && cat.allowHalf;
      const minPrice = Math.min(...p.variants.map((v) => v.price));
      return `<button class="prod" data-p="${p.id}" style="animation-delay:${i * 0.025}s">
        ${isPizza ? `<div class="p-disc" style="--pc:${p.color || 'var(--accent)'}"></div>` : `<div class="p-emoji">${cat ? cat.icon : '🍽️'}</div>`}
        <div class="p-name">${U.esc(p.name)}</div>
        ${p.desc ? `<div class="p-desc">${U.esc(p.desc)}</div>` : ''}
        <div class="p-price">${p.variants.length > 1 ? 'desde ' : ''}${U.money(minPrice)}</div>
      </button>`;
    }).join('');
    grid.querySelectorAll('.prod').forEach((b) => b.onclick = () => onProduct(el, b));
  }

  function onProduct(el, btn) {
    const p = S.product(btn.dataset.p);
    const cat = S.category(p.categoryId);
    if (p.variants.length === 1 && !(cat && cat.allowHalf)) {
      addItem(el, S.makeItem({ product: p, variant: p.variants[0], qty: 1 }));
      btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash');
      return;
    }
    productModal(p, (item) => {
      addItem(el, item);
      btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash');
    });
  }

  function addItem(el, item) {
    // Si ya hay una línea idéntica, suma cantidad
    const same = cart.items.find((x) => x.productId === item.productId && x.variantId === item.variantId && !x.half && !item.half && !x.extras.length && !item.extras.length && !x.notes && !item.notes);
    if (same) { same.qty += item.qty; same.total = same.unitPrice * same.qty; }
    else cart.items.push(item);
    saveCart();
    renderCart(el);
    if (navigator.vibrate) navigator.vibrate(15);
  }

  /* ======================= Modal de producto ======================= */
  function productModal(p, onAdd) {
    const cat = S.category(p.categoryId);
    const isPizza = !!(cat && cat.allowHalf);
    const allowHalf = isPizza && p.allowHalf !== false;
    const halfCandidates = S.data.products.filter((x) => x.active && x.id !== p.id && x.allowHalf !== false && S.category(x.categoryId) && S.category(x.categoryId).allowHalf);
    let variant = p.variants[0];
    /** @type {PZ.Product | null} */
    let half = null;
    let qty = 1;
    const extras = new Set();
    const onlineCfg = (S.data && S.data.settings && S.data.settings.online) || {};
    /** @type {PZ.Condiment[]} */
    const condiments = Array.isArray(onlineCfg.condiments) && onlineCfg.condiments.length
      ? onlineCfg.condiments
      : [
          { id: 'oregano', name: 'Orégano', default: true },
          { id: 'chimi', name: 'Chimi', default: true },
        ];
    /** @type {Record<string, boolean>} */
    const condState = Object.fromEntries(condiments.map((c) => [c.id, c.default !== false]));
    const extraApplies = (e) => (PZ.carta && PZ.carta.extraApplies ? PZ.carta.extraApplies(e, p, half) : true);

    const m = PZ.modal({
      title: `${cat ? cat.icon : ''} ${U.esc(p.name)}`,
      body: `
        ${p.desc ? `<p class="muted" style="margin-top:0">${U.esc(p.desc)}</p>` : ''}
        ${p.variants.length > 1 ? `<div class="opt-section">Tamaño</div><div class="opt-grid v-grid"></div>` : ''}
        ${allowHalf ? `
          <div class="opt-section">¿Mitad y mitad?</div>
          <div class="half-preview"><div class="half-pizza"><div class="h1"></div><div class="h2"></div></div><div class="half-txt grow"></div></div>
          <select class="half-sel"><option value="">— Entera (sin mitad) —</option>${halfCandidates.map((x) => `<option value="${x.id}">½ ${U.esc(x.name)}</option>`).join('')}</select>
          <p class="small muted">Precio de la mitad y mitad: ${S.data.settings.halfPricing === 'avg' ? 'promedio de ambas' : 'se cobra la más cara'}.</p>` : ''}
        ${isPizza && condiments.length ? `
          <div class="opt-section">Condimentos de la casa</div>
          <div class="opt-grid cond-grid" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); margin-bottom: 8px;">
            ${condiments.map((c) => `<button type="button" class="opt ${condState[c.id] ? 'on' : ''}" data-cid="${U.esc(c.id)}"></button>`).join('')}
          </div>` : ''}
        ${isPizza && S.data.extras.length ? `<div class="opt-section">Agregados</div><div class="opt-grid x-grid"></div>` : ''}
        <div class="opt-section">Aclaraciones</div>
        <input class="notes" placeholder="Ej: bien cocida, sin aceitunas…">
        <div class="opt-section">Cantidad</div>
        <div class="qty" style="font-size:1.2em"><button data-q="-1">−</button><span class="q">1</span><button data-q="1">+</button></div>`,
      footer: `<button class="btn ghost" data-a="cancel">Cancelar</button><button class="btn primary lg" data-a="add"></button>`,
    });
    const E = m.el;
    const renderConds = () => {
      if (!isPizza) return;
      condiments.forEach((c) => {
        const btn = /** @type {HTMLElement | null} */ (E.querySelector(`[data-cid="${c.id}"]`));
        if (!btn) return;
        const isOn = !!condState[c.id];
        const isDefault = c.default !== false;
        btn.className = `opt ${isOn ? 'on' : ''}`;
        if (isOn) {
          btn.innerHTML = `🌿 Con ${U.esc(c.name)} <small class="cond-st">${isDefault ? 'Incluido' : 'Agregado'}</small>`;
        } else {
          btn.innerHTML = isDefault
            ? `<span style="color:var(--err)">❌ Sin ${U.esc(c.name)}</span> <small class="cond-st" style="color:var(--err)">Quitar</small>`
            : `<span style="color:var(--muted)">Sin ${U.esc(c.name)}</span> <small class="cond-st">Opcional</small>`;
        }
      });
    };
    if (isPizza) {
      condiments.forEach((c) => {
        const btn = /** @type {HTMLElement | null} */ (E.querySelector(`[data-cid="${c.id}"]`));
        if (btn) {
          btn.onclick = () => {
            condState[c.id] = !condState[c.id];
            renderConds();
            refresh();
          };
        }
      });
      renderConds();
    }
    const build = () => {
      const chosenExtras = S.data.extras.filter((e) => extras.has(e.id) && extraApplies(e));
      const hv = half ? { product: half, variant: half.variants.find((v) => v.id === variant.id) || half.variants[0] } : null;
      let finalNotes = E.querySelector('.notes').value.trim();
      const tags = [];
      if (isPizza) {
        condiments.forEach((c) => {
          const isDefault = c.default !== false;
          const isSelected = !!condState[c.id];
          if (isDefault && !isSelected) tags.push(`Sin ${c.name.toLowerCase()}`);
          else if (!isDefault && isSelected) tags.push(`Con ${c.name.toLowerCase()}`);
        });
      }
      if (tags.length) {
        finalNotes = tags.join(' · ') + (finalNotes ? ` · ${finalNotes}` : '');
      }
      return S.makeItem({ product: p, variant, half: hv, extras: chosenExtras, qty, notes: finalNotes });
    };
    const refresh = () => {
      const vg = E.querySelector('.v-grid');
      if (vg) {
        vg.innerHTML = p.variants.map((v) => `<button class="opt ${v.id === variant.id ? 'on' : ''}" data-v="${v.id}">${U.esc(v.name)}<small>${U.money(v.price)}</small></button>`).join('');
        vg.querySelectorAll('.opt').forEach((b) => b.onclick = () => { variant = p.variants.find((v) => v.id === b.dataset.v); refresh(); });
      }
      if (allowHalf) {
        E.querySelector('.h1').style.background = p.color || 'var(--accent)';
        E.querySelector('.h2').style.background = half ? (half.color || 'var(--accent)') : (p.color || 'var(--accent)');
        E.querySelector('.half-pizza').style.transform = half ? 'rotate(-20deg)' : 'none';
        E.querySelector('.half-txt').innerHTML = half ? `<b>½ ${U.esc(p.name)}</b><br><b>½ ${U.esc(half.name)}</b>` : `<b>${U.esc(p.name)}</b> entera`;
      }
      if (isPizza && S.data.extras.length) {
        const xg = E.querySelector('.x-grid');
        if (xg) {
          const visibleExtras = S.data.extras.filter((e) => extraApplies(e));
          xg.innerHTML = visibleExtras.map((e) => `<button type="button" class="opt ${extras.has(e.id) ? 'on' : ''}" data-x="${e.id}">${U.esc(e.name)}<small>${e.price ? '+ ' + U.money(e.price) : 'sin cargo'}</small></button>`).join('');
          xg.querySelectorAll('.opt').forEach((b) => b.onclick = () => {
            extras.has(b.dataset.x) ? extras.delete(b.dataset.x) : extras.add(b.dataset.x);
            refresh();
          });
        }
      }
      E.querySelector('.q').textContent = qty;
      const it = build();
      E.querySelector('[data-a=add]').textContent = `Agregar · ${U.money(it.total)}`;
    };
    const hs = E.querySelector('.half-sel');
    if (hs) hs.onchange = () => { half = hs.value ? S.product(hs.value) : null; refresh(); };
    E.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { qty = Math.max(1, qty + Number(b.dataset.q)); refresh(); });
    E.querySelector('[data-a=cancel]').onclick = () => m.close();
    E.querySelector('[data-a=add]').onclick = () => { onAdd(build()); m.close(); };
    refresh();
  }

  /* ======================= Carrito ======================= */
  function renderCart(el) {
    const box = el.querySelector('.cart');
    const t = cartTotals();
    const count = cart.items.reduce((a, i) => a + i.qty, 0);
    const cust = cart.customerName || cart.phone ? `${U.esc(cart.customerName || 'Cliente')}${cart.phone ? ' · ' + U.esc(cart.phone) : ''}` : '';
    const types = Object.keys(L().type).filter((k) => (k !== 'delivery' || PZ.auth.feature('delivery')) && (k !== 'mesa' || PZ.auth.feature('mesas')));
    box.innerHTML = `
      <div class="cart-head">
        <div class="row-flex space-between">
          <h3 style="margin:0">🧺 Pedido <span class="badge pri">${count} ítem${count === 1 ? '' : 's'}</span></h3>
          <div class="row-flex" style="gap:4px">
            ${cart.items.length ? '<button class="icon-btn" data-a="clear" title="Vaciar">🗑️</button>' : ''}
            <button class="icon-btn close-cart" data-a="close" title="Cerrar">✕</button>
          </div>
        </div>
        <div class="type-seg">${types.map((k) => `<button data-t="${k}" class="${cart.type === k ? 'on' : ''}"><span>${L().typeIcon[k]}</span>${L().type[k]}</button>`).join('')}</div>
        <button class="btn sm ghost block mt" data-a="info" style="justify-content:flex-start">
          ${cart.type === 'mesa' ? '🍽️ ' + (cart.table ? 'Mesa ' + U.esc(cart.table) : 'Elegir mesa') + (cust ? ' · ' + cust : '')
            : cart.type === 'delivery' ? '🛵 ' + (cart.address ? U.esc(cart.address) : 'Cargar cliente y dirección') + (cust ? ' · ' + cust : '')
            : '👤 ' + (cust || 'Agregar cliente (opcional)')}
        </button>
      </div>
      <div class="cart-items">
        ${cart.items.length ? cart.items.map((it, i) => `
          <div class="cart-item" data-i="${i}">
            <div class="qty"><button data-d="-1">−</button><span>${it.qty}</span><button data-d="1">+</button></div>
            <div>
              <div class="ci-name">${U.esc(it.name)}${it.variantName ? ` <span class="muted small">${U.esc(it.variantName)}</span>` : ''}</div>
              ${it.extras.length ? `<div class="ci-sub">+ ${it.extras.map((e) => U.esc(e.name)).join(', ')}</div>` : ''}
              ${it.notes ? `<div class="ci-sub">» ${U.esc(it.notes)}</div>` : ''}
            </div>
            <div class="ci-price">${U.money(it.unitPrice * it.qty)}</div>
          </div>`).join('')
        : `<div class="cart-empty"><div class="pizza-spin">${PZ.brandLogo(70)}</div><p>Tocá un producto para empezar el pedido</p></div>`}
      </div>
      <div class="cart-foot">
        <div class="cart-line"><span>Subtotal</span><span>${U.money(t.subtotal)}</span></div>
        ${t.discountAmount ? `<div class="cart-line"><span>Descuento${cart.discount.type === '%' ? ' ' + cart.discount.value + '%' : ''}</span><span>-${U.money(t.discountAmount)}</span></div>` : ''}
        ${t.deliveryFee ? `<div class="cart-line"><span>Envío</span><span>${U.money(t.deliveryFee)}</span></div>` : ''}
        <div class="cart-total"><span>Total</span><b>${U.money(t.total)}</b></div>
        <div class="row-flex" style="gap:6px;margin-bottom:8px">
          <button class="btn sm ghost grow" data-a="disc">🏷️ Descuento</button>
          <button class="btn sm ghost grow" data-a="note">📝 Nota${cart.notes ? ' ✓' : ''}</button>
        </div>
        <div class="row-flex" style="gap:8px">
          <button class="btn ghost grow" data-a="save" ${cart.items.length ? '' : 'disabled'} title="Manda a cocina y se cobra después">⏳ Cobrar después</button>
          <button class="btn primary lg grow" data-a="pay" ${cart.items.length ? '' : 'disabled'}>💸 Cobrar</button>
        </div>
      </div>`;

    // Botón flotante del carrito (celular)
    const fab = el.querySelector('.cart-fab');
    fab.classList.toggle('hidden', !cart.items.length);
    fab.innerHTML = `<span><span class="cf-count">${count}</span>Ver pedido</span><span>${U.money(t.total)} →</span>`;

    box.querySelectorAll('.type-seg button').forEach((b) => b.onclick = () => {
      cart.type = b.dataset.t;
      if (cart.type === 'delivery' && cart.zoneId) cart.deliveryFee = (S.zone(cart.zoneId) || {}).fee || 0;
      saveCart();
      renderCart(el);
      if (cart.type === 'delivery' && !cart.address) infoModal(el);
      if (cart.type === 'mesa' && !cart.table) infoModal(el);
    });
    box.querySelectorAll('.cart-item').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
        const it = cart.items[i];
        it.qty += Number(b.dataset.d);
        if (it.qty <= 0) cart.items.splice(i, 1);
        else it.total = it.unitPrice * it.qty;
        saveCart();
        renderCart(el);
      });
    });
    const on = (a, fn) => { const b = box.querySelector(`[data-a=${a}]`); if (b) b.onclick = fn; };
    on('clear', async () => { if (await PZ.confirm('¿Vaciar el pedido actual?', { ok: 'Vaciar', danger: true })) { cart = emptyCart(); saveCart(); renderCart(el); } });
    on('close', () => box.classList.remove('open'));
    on('info', () => infoModal(el));
    on('disc', () => discountModal(el));
    on('note', async () => {
      const n = await PZ.prompt('Nota general del pedido', { value: cart.notes, title: 'Nota para cocina / entrega' });
      if (n != null) { cart.notes = n.trim(); saveCart(); renderCart(el); }
    });
    on('save', () => saveUnpaid(el));
    on('pay', () => checkoutCart(el));
  }

  /* ======================= Datos del cliente / entrega ======================= */
  function infoModal(el) {
    const zones = S.data.settings.zones;
    const m = PZ.modal({
      title: cart.type === 'delivery' ? '🛵 Datos de entrega' : cart.type === 'mesa' ? '🍽️ Mesa' : '👤 Cliente',
      body: `
        <label class="field"><span>Buscar cliente existente</span><input class="c-search" placeholder="Nombre o teléfono…" autocomplete="off"></label>
        <div class="c-results"></div>
        ${cart.type === 'mesa' ? `<label class="field"><span>Número de mesa</span><input name="table" value="${U.esc(cart.table)}" inputmode="numeric"></label>` : ''}
        <div class="grid-2">
          <label class="field"><span>Nombre</span><input name="name" value="${U.esc(cart.customerName)}"></label>
          <label class="field"><span>Teléfono / WhatsApp</span><input name="phone" value="${U.esc(cart.phone)}" inputmode="tel"></label>
        </div>
        ${cart.type === 'delivery' ? `
          ${(S.data.settings.deliveryFields && S.data.settings.deliveryFields.separateAddress) ? `
            <div class="grid-2">
              <label class="field"><span>Calle</span><input name="street" placeholder="Ej: Av. San Martín"></label>
              <label class="field"><span>Altura / Nº</span><input name="streetNum" placeholder="Ej: 1420" inputmode="numeric"></label>
            </div>
          ` : `
            <label class="field"><span>Dirección</span><input name="address" value="${U.esc(cart.address)}" placeholder="Calle, número, piso, entre calles"></label>
          `}
          ${(S.data.settings.deliveryFields && (S.data.settings.deliveryFields.floorDept || S.data.settings.deliveryFields.crossStreets)) ? `
            <div class="grid-2">
              ${S.data.settings.deliveryFields.floorDept ? '<label class="field"><span>Piso / Dpto</span><input name="floorDept" placeholder="Ej: 3B"></label>' : ''}
              ${S.data.settings.deliveryFields.crossStreets ? '<label class="field"><span>Entre calles</span><input name="crossStreets" placeholder="Ej: Belgrano y Moreno"></label>' : ''}
            </div>
          ` : ''}
          <div class="grid-2">
            <label class="field"><span>Zona de envío</span><select name="zone"><option value="">Sin cargo</option>${zones.map((z) => `<option value="${z.id}" ${cart.zoneId === z.id ? 'selected' : ''}>${U.esc(z.name)} · ${U.money(z.fee)}</option>`).join('')}</select></label>
            <label class="field"><span>Costo de envío</span><input name="fee" value="${cart.deliveryFee || 0}" inputmode="numeric"></label>
          </div>
          <label class="field"><span>Repartidor</span><select name="driver"><option value="">Sin asignar</option>${S.data.settings.drivers.map((d) => { const name = typeof d === 'object' ? d.name : d; const code = typeof d === 'object' && d.code ? ' (' + d.code + ')' : ''; return `<option value="${U.esc(name)}" ${cart.driver === name ? 'selected' : ''}>${U.esc(name + code)}</option>`; }).join('')}</select></label>` : ''}
        ${cart.type !== 'mesa' ? `<label class="field"><span>Hora de entrega / retiro (opcional)</span><input name="eta" type="time" value="${U.esc(cart.eta)}"></label>` : ''}
        <input type="hidden" name="cid" value="${cart.customerId || ''}">`,
      footer: `<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Listo</button>`,
    });
    const E = m.el;
    const f = (n) => E.querySelector(`[name=${n}]`);
    const zoneSel = f('zone');
    if (zoneSel) zoneSel.onchange = () => { const z = S.zone(zoneSel.value); f('fee').value = z ? z.fee : 0; };
    const search = E.querySelector('.c-search');
    const results = E.querySelector('.c-results');
    search.addEventListener('input', () => {
      const q = U.stripAccents(search.value.toLowerCase().trim());
      if (q.length < 2) { results.innerHTML = ''; return; }
      const found = S.data.customers.filter((c) => U.stripAccents((c.name + ' ' + c.phone).toLowerCase()).includes(q) || c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§')).slice(0, 6);
      results.innerHTML = found.length ? found.map((c) => `<button class="opt" style="width:100%;margin-bottom:6px" data-c="${c.id}">${U.esc(c.name)}<small>${U.esc(c.phone)} ${c.address ? '· ' + U.esc(c.address) : ''}</small></button>`).join('') : '<p class="small muted">No se encontró. Cargalo abajo y se guarda solo.</p>';
      results.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
        const c = S.customer(b.dataset.c);
        f('cid').value = c.id; f('name').value = c.name; f('phone').value = c.phone;
        if (f('address')) f('address').value = c.address || '';
        if (zoneSel && c.zoneId) { zoneSel.value = c.zoneId; zoneSel.onchange(); }
        results.innerHTML = c.notes ? `<div class="alert-row">📌 ${U.esc(c.notes)}</div>` : '';
        search.value = '';
      });
    });
    E.querySelector('[data-a=x]').onclick = () => m.close();
    E.querySelector('[data-a=ok]').onclick = () => {
      cart.customerId = f('cid').value || null;
      cart.customerName = f('name').value.trim();
      cart.phone = f('phone').value.trim();
      if (f('table')) cart.table = f('table').value.trim();
      if (cart.type === 'delivery') {
        const df = S.data.settings.deliveryFields || {};
        if (df.separateAddress) {
          cart.address = `${(f('street') && f('street').value.trim()) || ''} ${(f('streetNum') && f('streetNum').value.trim()) || ''}`.trim();
          if (f('floorDept') && f('floorDept').value.trim()) cart.address += (cart.address ? ', ' : '') + f('floorDept').value.trim();
          if (f('crossStreets') && f('crossStreets').value.trim()) cart.address += ` (entre ${f('crossStreets').value.trim()})`;
        } else if (f('address')) {
          cart.address = f('address').value.trim();
        }
        if (zoneSel) cart.zoneId = zoneSel.value || null;
        if (f('fee')) cart.deliveryFee = U.parseMoney(f('fee').value);
        if (f('driver')) cart.driver = f('driver').value;
      }
      if (f('eta')) cart.eta = f('eta').value;
      // si cambiaron los datos de un cliente existente, se desvincula para no pisarlo
      const c = cart.customerId && S.customer(cart.customerId);
      if (c && c.phone && cart.phone && c.phone.replace(/\D/g, '') !== cart.phone.replace(/\D/g, '')) cart.customerId = null;
      saveCart();
      renderCart(el);
      m.close();
    };
  }

  /* ======================= Descuento ======================= */
  function discountModal(el) {
    let type = (cart.discount && cart.discount.type) || '%';
    const m = PZ.modal({
      title: '🏷️ Descuento',
      size: 'sm',
      body: `
        <div class="seg mb"><button data-t="%" class="${type === '%' ? 'on' : ''}">Porcentaje %</button><button data-t="$" class="${type === '$' ? 'on' : ''}">Monto $</button></div>
        <div class="bills">${[5, 10, 15, 20].map((v) => `<button data-v="${v}">${v}%</button>`).join('')}</div>
        <label class="field"><span>Valor</span><input class="val" inputmode="decimal" value="${cart.discount ? cart.discount.value : ''}" autofocus></label>`,
      footer: `<button class="btn ghost" data-a="rm">Quitar</button><button class="btn primary" data-a="ok">Aplicar</button>`,
    });
    const E = m.el;
    E.querySelectorAll('.seg button').forEach((b) => b.onclick = () => { type = b.dataset.t; E.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b)); });
    E.querySelectorAll('.bills button').forEach((b) => b.onclick = () => { type = '%'; E.querySelector('.val').value = b.dataset.v; E.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x.dataset.t === '%')); });
    E.querySelector('[data-a=rm]').onclick = () => { cart.discount = null; saveCart(); renderCart(el); m.close(); };
    E.querySelector('[data-a=ok]').onclick = async () => {
      const v = U.parseMoney(E.querySelector('.val').value);
      const t = cartTotals();
      const pct = type === '%' ? v : (v / Math.max(1, t.subtotal)) * 100;
      if (pct > 20) {
        const auth = await PZ.auth.requireAdmin('Descuento mayor al 20%');
        PZ.auth.release(auth);
        if (!auth) return;
      }
      cart.discount = v ? { type, value: v } : null;
      saveCart(); renderCart(el); m.close();
    };
  }

  /* ======================= Guardar sin cobrar ======================= */
  async function saveUnpaid(el) {
    if (!validateCart()) return;
    const o = S.createOrder(cart);
    cart = emptyCart(); saveCart();
    renderCart(el);
    el.querySelector('.cart').classList.remove('open');
    PZ.toast(`Pedido #${o.number} enviado a cocina`);
    const st = S.data.settings.ticket;
    if (st.printKitchen) PZ.ticket.printOrder(o, { kitchen: true, customer: o.type === 'delivery' });
  }

  function validateCart() {
    if (!cart.items.length) return false;
    if (cart.type === 'delivery' && !cart.address) { PZ.toast('Falta la dirección de entrega', 'warn'); infoModal(document.getElementById('view')); return false; }
    return true;
  }

  /* ======================= Cobrar carrito ======================= */
  async function checkoutCart(el) {
    if (!validateCart()) return;
    if (!(await PZ.cash.ensureOpen())) return;
    const draft = cartTotals();
    const res = await PZ.checkout(draft, { isNew: true });
    if (!res) return;
    const o = S.createOrder(cart, { paid: true, payments: res.payments, adjust: res.adjust });
    cart = emptyCart(); saveCart();
    renderCart(el);
    el.querySelector('.cart').classList.remove('open');
    afterPaid(o, res);
  }

  /** Pantalla de éxito + impresión automática */
  function afterPaid(o, res) {
    PZ.celebrate();
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    const change = o.payments.reduce((a, p) => a + (p.method === 'efectivo' ? Math.max(0, (p.tendered || 0) - p.amount) : 0), 0);
    const m = PZ.ticket.preview(o, { title: '✅ ¡Cobrado!' });
    if (change > 0) {
      const box = document.createElement('div');
      box.className = 'change-box';
      box.style.marginBottom = '12px';
      box.innerHTML = `Vuelto a entregar<b>${U.money(change)}</b>`;
      m.el.querySelector('.modal-body').prepend(box);
    }
    if (res.print) PZ.ticket.printOrder(o, { kitchen: res.kitchen });
    else if (res.kitchen) PZ.ticket.printOrder(o, { kitchen: true, customer: false });
  }

  /* ======================= Modal de cobro (reutilizable) ======================= */
  PZ.checkout = function (order, { isNew = false } = {}) {
    return new Promise((resolve) => {
      const st = S.data.settings;
      const P = st.payments;
      const methods = ['efectivo', 'transferencia', 'qr'].concat(P.enableCard ? ['tarjeta'] : []);
      let method = 'efectivo';
      let cardType = 'débito';
      let split = false;
      let partials = [];
      let resolved = false;
      let mpManual = false;   // usar el QR fijo en vez del QR de Mercado Pago con monto
      /** cobro acreditado por Mercado Pago @type {{ order: string, payment: string, amount: number } | null} */
      let mpPaid = null;
      const base = order.total;
      const useMp = () => method === 'qr' && !mpManual && PZ.mp && PZ.mp.ready();

      const adjustFor = (m) => {
        if (split) return { cashDiscount: 0, surcharge: 0 };
        if (m === 'efectivo' && P.cashDiscountPct) return { cashDiscount: Math.round((base * P.cashDiscountPct) / 100), surcharge: 0 };
        if (m === 'tarjeta' && P.cardSurchargePct) return { cashDiscount: 0, surcharge: Math.round((base * P.cardSurchargePct) / 100) };
        return { cashDiscount: 0, surcharge: 0 };
      };
      const totalFor = (m) => { const a = adjustFor(m); return base - a.cashDiscount + a.surcharge; };
      const paidSoFar = () => partials.reduce((a, p) => a + p.amount, 0);
      const due = () => (split ? base - paidSoFar() : totalFor(method));

      const m = PZ.modal({
        title: `💸 Cobrar${order.number ? ' pedido #' + order.number : ''}`,
        body: `
          <div class="pay-total"><div class="pt-label">Total a cobrar</div><div class="pt-value"></div><div class="pt-adj small muted"></div></div>
          <div class="pay-methods">${methods.map((k) => `<button class="pay-m" data-m="${k}"><span>${L().methodIcon[k]}</span>${L().method[k].split(' ')[0]}</button>`).join('')}</div>
          <div class="split-box"></div>
          <div class="pay-detail mt"></div>
          <label class="check mt"><input type="checkbox" class="split-t"> Pago mixto (dividir entre varios medios)</label>
          <div class="row-flex" style="gap:16px">
            <label class="check"><input type="checkbox" class="opt-print" ${st.ticket.autoPrint ? 'checked' : ''}> 🖨️ Imprimir ticket</label>
            ${isNew ? `<label class="check"><input type="checkbox" class="opt-kit" ${st.ticket.printKitchen ? 'checked' : ''}> 👨‍🍳 Comanda cocina</label>` : ''}
          </div>`,
        footer: `<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary lg" data-a="ok"></button>`,
        onClose: () => { if (!resolved) resolve(null); },
      });
      const E = m.el;
      const detail = E.querySelector('.pay-detail');

      function draw() {
        E.querySelectorAll('.pay-m').forEach((b) => b.classList.toggle('on', b.dataset.m === method));
        const d = due();
        E.querySelector('.pt-value').textContent = U.money(split ? d : totalFor(method));
        const a = adjustFor(method);
        E.querySelector('.pt-adj').textContent = split ? `Pagado ${U.money(paidSoFar())} de ${U.money(base)}` : a.cashDiscount ? `Incluye ${P.cashDiscountPct}% de descuento por efectivo (-${U.money(a.cashDiscount)})` : a.surcharge ? `Incluye ${P.cardSurchargePct}% de recargo por tarjeta (+${U.money(a.surcharge)})` : '';

        const sb = E.querySelector('.split-box');
        sb.innerHTML = split ? `<div class="split-list mt">${partials.map((p, i) => `<div class="sp"><span>${L().methodIcon[p.method]} ${L().method[p.method]}${p.ref ? ' · ' + U.esc(p.ref) : ''}</span><span>${U.money(p.amount)} <button class="icon-btn" data-rm="${i}">✕</button></span></div>`).join('')}
          ${d > 0 ? `<label class="field"><span>¿Cuánto paga con ${L().method[method]}? (esta parte)</span><input class="part" inputmode="numeric" value="${d}"></label>` : ''}</div>` : '';
        sb.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { partials.splice(Number(b.dataset.rm), 1); draw(); });

        if (method === 'efectivo') {
          // En pago mixto, el vuelto se calcula sobre la parte en efectivo
          const base = () => (split ? Math.min(d, U.parseMoney((E.querySelector('.part') || {}).value) || d) : d);
          const b0 = base();
          const suggestions = [...new Set([Math.ceil(b0 / 1000) * 1000, Math.ceil(b0 / 5000) * 5000, Math.ceil(b0 / 10000) * 10000, Math.ceil(b0 / 20000) * 20000])].filter((v) => v > b0).slice(0, 3);
          detail.innerHTML = `
            <div class="opt-section" style="margin-top:0">¿Con cuánto paga el cliente?</div>
            <div class="bills">
              <button data-b="${b0}">✓ Justo ${U.money(b0)}</button>
              ${suggestions.map((v) => `<button data-b="${v}">${U.money(v)}</button>`).join('')}
              <button data-b="other" class="other">✏️ Otro monto</button>
            </div>
            <label class="field tendered-field"><span>Monto que entrega (escribilo si es otro)</span>
              <input class="tendered" inputmode="numeric" placeholder="Ej: 23000" autocomplete="off"></label>
            <div class="change-box"><span>Vuelto</span><b class="chg">${U.money(0)}</b></div>`;
          const inp = detail.querySelector('.tendered');
          const chips = detail.querySelectorAll('[data-b]');
          const upd = () => {
            const v = U.parseMoney(inp.value);
            const box = detail.querySelector('.change-box');
            const diff = v - base();
            box.classList.toggle('neg', !!inp.value && diff < 0);
            box.querySelector('span').textContent = !inp.value ? 'Vuelto' : diff < 0 ? 'Falta' : `Paga con ${U.money(v)} · vuelto`;
            detail.querySelector('.chg').textContent = U.money(inp.value ? Math.abs(diff) : 0);
            chips.forEach((c) => c.classList.toggle('on', c.dataset.b !== 'other' && Number(c.dataset.b) === v));
          };
          inp.addEventListener('input', () => { detail.querySelector('.other').classList.remove('on'); upd(); });
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') E.querySelector('[data-a=ok]').click(); });
          chips.forEach((b) => b.onclick = () => {
            if (b.dataset.b === 'other') {
              inp.value = '';
              upd();
              b.classList.add('on');
              detail.querySelector('.tendered-field').classList.add('pulse');
              setTimeout(() => detail.querySelector('.tendered-field').classList.remove('pulse'), 700);
              inp.focus();
              return;
            }
            inp.value = b.dataset.b;
            upd();
          });
          const part = E.querySelector('.part');
          if (part) part.oninput = upd;
          setTimeout(() => inp.focus(), 50);
        } else if (method === 'transferencia') {
          const row = (label, v) => v ? `<div class="bk-row"><span class="muted">${label}</span><b>${U.esc(v)}</b><button class="btn sm ghost" data-copy="${U.esc(v)}">Copiar</button></div>` : '';
          detail.innerHTML = (P.alias || P.cbu)
            ? `<div class="bank-box">${row('Alias', P.alias)}${row('CBU/CVU', P.cbu)}${row('Titular', P.holder)}${row('Banco', P.bank)}</div>`
            : `<div class="alert-row">⚠️ Cargá el alias/CBU en Configuración → Cobros.</div>`;
          detail.innerHTML += `<label class="field mt"><span>Nº de operación / comprobante (opcional)</span><input class="ref" placeholder="Últimos dígitos o nombre de quien transfiere"></label>
            <label class="check"><input type="checkbox" class="verified"> Verifiqué que la transferencia llegó</label>`;
        } else if (method === 'qr' && useMp()) {
          // QR de Mercado Pago con el monto: se acredita solo
          detail.innerHTML = `<div class="alert-row" style="background:color-mix(in srgb,#00b1ea 14%,var(--card))">📱 Se genera un QR de Mercado Pago con el monto exacto. Cuando el cliente paga, el cobro se registra solo.</div>
            <button class="btn ghost sm" data-a="mpman">Usar el QR fijo o registrar a mano</button>`;
          detail.querySelector('[data-a=mpman]').onclick = () => { mpManual = true; draw(); };
        } else if (method === 'qr') {
          const img = P.qrImage ? `<img src="${P.qrImage}" alt="QR de pago">` : P.qrLink ? U.qrSvg(P.qrLink, 6, 1) : '';
          detail.innerHTML = img
            ? `<div class="qr-pay"><div class="qr-frame">${img}</div><div><b>Escaneá para pagar ${U.money(d)}</b><div class="small muted">Mostrale la pantalla al cliente</div></div></div>`
            : `<div class="alert-row">⚠️ Subí la imagen de tu QR de Mercado Pago (o un link de pago) en Configuración → Cobros${PZ.mp && PZ.mp.enabled() ? ', o conectá Mercado Pago para generar el QR con el monto' : ''}.</div>`;
          detail.innerHTML += `<label class="field mt"><span>Nº de operación (opcional)</span><input class="ref"></label>
            <label class="check"><input type="checkbox" class="verified"> Verifiqué el pago en la app</label>
            ${PZ.mp && PZ.mp.ready() ? '<button class="btn ghost sm" data-a="mpauto">📱 Volver al QR de Mercado Pago con monto</button>' : ''}`;
          const back = detail.querySelector('[data-a=mpauto]');
          if (back) back.onclick = () => { mpManual = false; draw(); };
        } else if (method === 'tarjeta') {
          // Posnet de cualquier marca: se cobra en el posnet y acá se registra
          detail.innerHTML = `<p class="small muted" style="margin-top:0">Pasá la tarjeta en tu posnet por <b>${U.money(d)}</b> y después confirmá acá: el comprobante sale igual.</p>
            <div class="seg mb card-type"><button data-ct="débito" class="${cardType === 'débito' ? 'on' : ''}">Débito</button><button data-ct="crédito" class="${cardType === 'crédito' ? 'on' : ''}">Crédito</button></div>
            <label class="field"><span>Cupón / últimos 4 dígitos (opcional)</span><input class="ref" inputmode="numeric"></label>`;
          detail.querySelectorAll('[data-ct]').forEach((b) => b.onclick = () => { cardType = b.dataset.ct; detail.querySelectorAll('[data-ct]').forEach((x) => x.classList.toggle('on', x === b)); });
        }
        detail.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
          try { await navigator.clipboard.writeText(b.dataset.copy); PZ.toast('Copiado'); } catch (e) { PZ.toast('No se pudo copiar', 'warn'); }
        });

        const ok = E.querySelector('[data-a=ok]');
        ok.classList.toggle('mp-go', useMp());
        ok.textContent = useMp() ? `📱 Generar QR · ${U.money(split ? Math.min(d, U.parseMoney((E.querySelector('.part') || {}).value) || d) : d)}`
          : split && d > 0 ? `Agregar pago` : `✅ Confirmar ${U.money(split ? base : totalFor(method))}`;
      }

      /** Cobra la parte con QR de Mercado Pago y, si se acredita, confirma solo */
      async function chargeMp() {
        const d = due();
        const amt = split ? Math.min(d, U.parseMoney((E.querySelector('.part') || {}).value)) : d;
        if (!amt) return;
        const desc = `${order.number ? 'Pedido #' + order.number + ' · ' : ''}${st.business.name || 'Pizzería'}`;
        const res = await PZ.mp.charge(amt, desc);
        if (!res) return;
        mpPaid = { ...res, amount: amt };
        E.querySelector('[data-a=ok]').click();
      }

      E.querySelectorAll('.pay-m').forEach((b) => b.onclick = () => { method = b.dataset.m; draw(); });
      E.querySelector('.split-t').onchange = (e) => { split = e.target.checked; partials = []; draw(); };
      E.querySelector('[data-a=x]').onclick = () => m.close();
      E.querySelector('[data-a=ok]').onclick = () => {
        const mpNow = mpPaid;
        mpPaid = null;
        if (!mpNow && useMp()) return chargeMp();
        const ref = mpNow ? `MP ${mpNow.payment || mpNow.order}` : (detail.querySelector('.ref') || {}).value || '';
        const mpInfo = mpNow ? { mp: { order: mpNow.order, payment: mpNow.payment } } : {};
        const verified = detail.querySelector('.verified');
        if (!mpNow && verified && !verified.checked && (method === 'transferencia' || method === 'qr')) {
          if (!confirm('No marcaste que verificaste el pago. ¿Confirmar igual?')) return;
        }
        const d = due();
        if (split && d > 0) {
          const part = mpNow ? mpNow.amount : Math.min(d, U.parseMoney((E.querySelector('.part') || {}).value));
          if (!part) return;
          let tendered = part;
          if (method === 'efectivo') {
            const tv = U.parseMoney(detail.querySelector('.tendered').value);
            if (tv && tv < part) return PZ.toast('El efectivo entregado no alcanza', 'warn');
            tendered = tv || part;
          }
          partials.push({ method, amount: part, tendered, change: tendered - part, ref: ref.trim(), ...(method === 'tarjeta' ? { cardType } : {}), ...mpInfo });
          if (due() > 0) return draw();
        }
        let payments;
        if (split) payments = partials;
        else {
          let tendered = d;
          if (method === 'efectivo') {
            const tv = U.parseMoney(detail.querySelector('.tendered').value);
            if (tv && tv < d) return PZ.toast(`Faltan ${U.money(d - tv)}`, 'warn');
            tendered = tv || d;
          }
          payments = [{ method, amount: d, tendered, change: tendered - d, ref: ref.trim(), ...(method === 'tarjeta' ? { cardType } : {}), ...mpInfo }];
        }
        resolved = true;
        const out = {
          payments,
          adjust: adjustFor(method),
          print: E.querySelector('.opt-print').checked,
          kitchen: isNew && E.querySelector('.opt-kit') ? E.querySelector('.opt-kit').checked : false,
        };
        m.close();
        resolve(out);
      };
      draw();
    });
  };

  PZ.afterPaid = afterPaid;
  PZ.productModal = productModal;
  PZ.setCart = (c) => { cart = { ...emptyCart(), ...c }; saveCart(); };

  PZ.views.vender = {
    title: 'Nueva venta', render,
    /** Inicia una tanda nueva sin mezclarla con pedidos anteriores de la mesa. */
    startTable(session) {
      const table = S.table(session.tableIds[0]);
      cart = { ...emptyCart(), type: 'mesa', table: table ? table.number : '', tableSessionId: session.id, batchNumber: (session.orderIds || []).length + 1 };
      saveCart(); location.hash = '#/vender';
    },
  };
})(window.PZ);
