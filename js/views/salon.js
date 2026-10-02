// @ts-check
/* ==========================================================================
   Vista: SALÓN Y MESAS — en vivo para mozos, caja y encargado

   · Cada mesa ocupada tiene UNA cuenta. Cada vez que se manda algo a la
     cocina se agrega una TANDA (sale como comanda separada), pero la cuenta
     se cobra toda junta con un solo comprobante.
   · Todo se actualiza solo en todos los equipos: si el mozo agrega una tanda,
     la caja ve el saldo al instante; si la cocina marca "listo", el mozo ve
     la mesa en verde para servir.
   · El mozo atiende (abre, pide, pide la cuenta, marca servido). Cobra la caja.
   ========================================================================== */
(function (PZ) {
  const S = PZ.store;
  const U = PZ.util;
  const A = () => PZ.auth;
  let area = 'all';
  let listMode = false;
  let onlyMine = false;
  /** panel de cuenta abierto (para refrescarlo en vivo) @type {null | { sessionId: string, draw: () => void, el: HTMLElement }} */
  let panel = null;
  /** tandas ya avisadas como "listas para servir" en este equipo */
  const readySeen = new Set();
  let readyPrimed = false;

  const STATUS = {
    pendiente: { label: 'En cocina', cls: '' },
    preparando: { label: 'En el horno', cls: 'warn' },
    horno: { label: 'En el horno', cls: 'warn' },
    listo: { label: 'Lista para servir', cls: 'ok' },
    entregado: { label: 'Servida', cls: 'muted' },
    cancelado: { label: 'Anulada', cls: 'err' },
  };

  const tableNum = (s) => { const t = S.table(s.tableIds[0]); return t ? t.number : '?'; };
  /** @param {any} s */
  function stateOf(s) {
    if (!s) return 'libre';
    if (S.tableOrders(s).some((o) => o.status === 'listo')) return 'listo';
    return s.state === 'cuenta_solicitada' ? 'cuenta' : 'ocupada';
  }
  const STATE_LABEL = { libre: 'Libre', ocupada: 'Ocupada', cuenta: 'Pidió la cuenta', listo: 'Para servir' };

  /* ======================= Mapa ======================= */
  function render(el) {
    if (!S.data.diningTables.length) {
      if (A().isAdmin()) S.ensureDining();
      else {
        el.innerHTML = '<div class="card empty"><span class="e-ico">🍽️</span>Todavía no hay mesas cargadas. Pedile al encargado que las configure.</div>';
        return;
      }
    }
    S.reconcileTables();
    const areas = S.data.diningAreas;
    const me = A().current;
    const tables = S.tables().filter((t) => {
      if (area !== 'all' && t.areaId !== area) return false;
      if (!onlyMine) return true;
      const s = S.activeTableSession(t.id);
      return s && me && s.waiterId === me.id;
    });
    const sessions = S.tables().map((t) => S.activeTableSession(t.id)).filter(Boolean);
    const busy = sessions.length;
    const toServe = sessions.filter((s) => stateOf(s) === 'listo').length;
    const bills = sessions.filter((s) => stateOf(s) === 'cuenta').length;

    el.innerHTML = `
      <div class="salon-head">
        <div>
          <div class="tabs-nav salon-tabs">
            <button data-area="all" class="${area === 'all' ? 'on' : ''}">Todas</button>
            ${areas.map((a) => `<button data-area="${a.id}" class="${a.id === area ? 'on' : ''}">${U.esc(a.name)}</button>`).join('')}
            ${A().isWaiter() || sessions.some((s) => me && s.waiterId === me.id) ? `<button data-mine class="${onlyMine ? 'on' : ''}">🙋 Mis mesas</button>` : ''}
          </div>
          <div class="salon-stats">
            <span class="badge">${busy} ocupada${busy === 1 ? '' : 's'} de ${S.tables().length}</span>
            ${toServe ? `<span class="badge ok">🍕 ${toServe} para servir</span>` : ''}
            ${bills ? `<span class="badge err">🧾 ${bills} ${bills === 1 ? 'pidió' : 'pidieron'} la cuenta</span>` : ''}
          </div>
        </div>
        <div class="row-flex"><button class="btn ghost sm" data-a="view">${listMode ? '▦ Mapa' : '☷ Lista'}</button>${A().isAdmin() ? '<button class="btn ghost sm" data-a="add">＋ Mesa</button>' : ''}</div>
      </div>
      <div class="salon-layout">
        <section class="salon-map ${listMode ? 'list' : ''}">${tables.map(tableCard).join('') || '<p class="muted" style="padding:16px">No hay mesas para mostrar.</p>'}</section>
        <aside class="card salon-help"><h3>Cómo se atiende</h3><ol>
          <li>Tocá una mesa libre y abrila.</li>
          <li><b>Agregar tanda</b> manda a la cocina solo lo nuevo.</li>
          <li>Todo queda en <b>una sola cuenta</b>: la mesa paga junta, con un solo comprobante.</li>
          <li>${A().canCharge() ? '<b>Cobrar mesa</b> cobra todo y libera la mesa.' : 'Cuando pidan la cuenta, tocá <b>Pedir cuenta</b>: la caja la cobra.'}</li>
        </ol><p class="small muted">Se actualiza solo en todos los equipos. En verde: hay algo listo para servir.</p></aside>
      </div>`;
    el.querySelectorAll('[data-area]').forEach((b) => { /** @type {HTMLElement} */ (b).onclick = () => { area = /** @type {HTMLElement} */ (b).dataset.area || 'all'; render(el); }; });
    const mine = /** @type {HTMLElement | null} */ (el.querySelector('[data-mine]'));
    if (mine) mine.onclick = () => { onlyMine = !onlyMine; render(el); };
    /** @type {HTMLElement} */ (el.querySelector('[data-a=view]')).onclick = () => { listMode = !listMode; render(el); };
    const add = /** @type {HTMLElement | null} */ (el.querySelector('[data-a=add]'));
    if (add) add.onclick = () => addTable(el);
    el.querySelectorAll('[data-table]').forEach((b) => { /** @type {HTMLElement} */ (b).onclick = () => openTable(el, /** @type {HTMLElement} */ (b).dataset.table || ''); });
    notifyReady();
  }

  function tableCard(t) {
    const s = S.activeTableSession(t.id);
    const st = stateOf(s);
    if (!s) return `<button class="dining-table libre ${t.shape || 'round'}" data-table="${t.id}" style="--x:${t.x || 0};--y:${t.y || 0}"><b>${U.esc(t.number)}</b><span>Libre</span><small>${t.capacity || 4} lugares</small></button>`;
    const orders = S.tableOrders(s);
    const ready = orders.filter((o) => o.status === 'listo').length;
    return `<button class="dining-table ${st} ${t.shape || 'round'}" data-table="${t.id}" style="--x:${t.x || 0};--y:${t.y || 0}">
      <b>${U.esc(t.number)}</b><span>${STATE_LABEL[st]}</span>
      <small>${s.guests || '—'} pers. · ${U.minutesSince(s.openedAt)} min</small>
      <em>${U.money(S.tableBalance(s))}</em>${S.tableTotal(s) > S.tableBalance(s) ? '<small>saldo (ya pagó una parte)</small>' : ''}
      <i>${orders.length} tanda${orders.length === 1 ? '' : 's'}${ready ? ` · 🍕${ready}` : ''}${s.waiterName ? ` · ${U.esc(s.waiterName.split(' ')[0])}` : ''}</i>
    </button>`;
  }

  /** Aviso (sonido + vibración) cuando algo de una mesa queda listo para servir */
  function notifyReady() {
    const sessions = S.tables().map((t) => S.activeTableSession(t.id)).filter(Boolean);
    const ready = sessions.flatMap((s) => S.tableOrders(s).filter((o) => o.status === 'listo').map((o) => ({ o, s })));
    const fresh = ready.filter(({ o }) => !readySeen.has(o.id));
    ready.forEach(({ o }) => readySeen.add(o.id));
    if (!readyPrimed) { readyPrimed = true; return; }
    if (!fresh.length) return;
    const me = A().current;
    const mine = fresh.filter(({ s }) => !A().isWaiter() || (me && (s.waiterId === me.id || !s.waiterId)));
    if (!mine.length) return;
    if (PZ.beep) PZ.beep([880, 1175, 1568]);
    if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
    PZ.toast(`🍕 Para servir: mesa ${mine.map(({ s }) => tableNum(s)).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`, 'ok', 5000);
  }

  function openTable(el, id) {
    const s = S.activeTableSession(id);
    if (!s) return openModal(el, id);
    sessionPanel(el, s.id);
  }

  function openModal(el, tableId) {
    const t = S.table(tableId);
    if (!t) return;
    const m = PZ.modal({
      title: `🍽️ Abrir mesa ${U.esc(t.number)}`,
      size: 'sm',
      body: `<label class="field"><span>¿Cuántas personas?</span><input name="guests" inputmode="numeric" value="2" autofocus></label>
        <div class="bills guests-quick">${[1, 2, 3, 4, 5, 6, 8].map((n) => `<button type="button" data-g="${n}">${n}</button>`).join('')}</div>
        <p class="small muted">La mesa queda ocupada hasta que se cobre la cuenta.</p>`,
      footer: '<button class="btn ghost" data-a="x">Cancelar</button><button class="btn ghost" data-a="ok">Solo abrir</button><button class="btn primary" data-a="order">Abrir y pedir</button>',
    });
    const E = m.el;
    const inp = /** @type {HTMLInputElement} */ (E.querySelector('[name=guests]'));
    E.querySelectorAll('[data-g]').forEach((b) => { /** @type {HTMLElement} */ (b).onclick = () => { inp.value = /** @type {HTMLElement} */ (b).dataset.g || '2'; }; });
    const open = () => {
      const s = S.openTable(tableId, { guests: Math.max(1, Number(inp.value) || 1) });
      m.close();
      return s;
    };
    /** @type {HTMLElement} */ (E.querySelector('[data-a=x]')).onclick = () => m.close();
    /** @type {HTMLElement} */ (E.querySelector('[data-a=ok]')).onclick = () => { const s = open(); if (s) sessionPanel(el, s.id); };
    /** @type {HTMLElement} */ (E.querySelector('[data-a=order]')).onclick = () => { const s = open(); if (s) takeTableOrder(el, s.id); };
  }

  /* ======================= Cuenta de la mesa (en vivo) ======================= */
  function sessionPanel(el, sessionId) {
    const m = PZ.modal({ title: '🍽️ Mesa', size: 'md', body: '<div class="tbl-panel"></div>', footer: '<div class="tbl-foot"></div>', onClose: () => { panel = null; } });
    const E = m.el;
    const draw = () => {
      let s = S.tableSession(sessionId);
      if (s && s.mergedInto) s = S.tableSession(s.mergedInto);
      if (!s) { m.close(); return; }
      const orders = S.tableOrders(s);
      const due = S.tableBalance(s);
      const total = S.tableTotal(s);
      const active = S.sessionActive(s);
      const canCharge = A().canCharge();
      /** @type {HTMLElement} */ (E.querySelector('.modal-head h3')).textContent = `🍽️ Mesa ${tableNum(s)} · ${active ? STATE_LABEL[stateOf(s)] : 'Cobrada'}`;
      /** @type {HTMLElement} */ (E.querySelector('.tbl-panel')).innerHTML = `
        <div class="table-summary">
          <div><span>Personas</span><b>${s.guests || '—'} ${active ? '<button class="icon-btn sm" data-a="guests" title="Cambiar">✏️</button>' : ''}</b></div>
          <div><span>Abierta hace</span><b>${U.minutesSince(s.openedAt)} min</b></div>
          <div><span>Atiende</span><b>${U.esc(s.waiterName || '—')}</b></div>
          <div><span>${active ? 'Saldo a cobrar' : 'Total cobrado'}</span><b class="${due ? 'due' : ''}">${U.money(active ? due : total)}</b></div>
        </div>
        ${s.state === 'cuenta_solicitada' && active ? '<div class="alert-row" style="margin-top:10px">🧾 La mesa pidió la cuenta.</div>' : ''}
        ${active && s.bill && total > due ? `<div class="alert-row" style="margin-top:10px">✅ Ya se cobró ${U.money(total - due)} de esta mesa. <button class="btn sm ghost" data-a="receipt">🧾 Ver comprobante</button></div>` : ''}
        <h3 style="margin:14px 0 6px">Tandas</h3>
        ${orders.length ? `<div class="table-orders">${orders.map((o, i) => {
          const st = STATUS[o.status] || { label: o.status, cls: '' };
          return `<div class="tanda ${o.status === 'listo' ? 'ready' : ''}">
            <div class="tanda-head">
              <b>Tanda ${i + 1}</b> <span class="muted small">${U.time(o.createdAt)}</span>
              <span class="badge ${st.cls}">${st.label}</span>
              ${o.paid ? '<span class="badge ok">Cobrada</span>' : ''}
              <span class="grow"></span>
              <b>${U.money(o.total)}</b>
            </div>
            <div class="tanda-items">${o.items.map((it) => `<div>${it.qty}× ${U.esc(it.name)}${it.variantName ? ` <span class="muted">(${U.esc(it.variantName)})</span>` : ''}${it.extras && it.extras.length ? ` <small class="muted">+ ${it.extras.map((x) => U.esc(x.name)).join(', ')}</small>` : ''}${it.notes ? ` <small class="muted">» ${U.esc(it.notes)}</small>` : ''}</div>`).join('')}</div>
            <div class="tanda-actions">
              ${o.status === 'listo' ? `<button class="btn sm primary" data-served="${o.id}">🍽️ Servida</button>` : ''}
              <button class="btn sm ghost" data-print-kit="${o.id}" title="Reimprimir comanda">👨‍🍳 Comanda</button>
              ${!o.paid && canCharge ? `<button class="btn sm ghost" data-void="${o.id}" title="Anular esta tanda (requiere encargado)">✕ Anular</button>` : ''}
            </div>
          </div>`;
        }).join('')}</div>` : '<p class="muted">Todavía no se mandó nada a la cocina.</p>'}
        ${orders.length ? `<div class="tbl-total"><span>Total de la mesa</span><b>${U.money(total)}</b></div>` : ''}`;

      /** @type {HTMLElement} */ (E.querySelector('.tbl-foot')).innerHTML = active ? `
        <button class="btn ghost" data-a="move">↔ Cambiar de mesa</button>
        ${orders.length ? `<button class="btn ghost" data-a="bill">🧾 ${s.state === 'cuenta_solicitada' ? 'Reimprimir cuenta' : 'Pedir cuenta'}</button>` : ''}
        ${!due ? `<button class="btn ghost danger" data-a="close">${orders.length ? '✅ Liberar mesa' : '✕ Liberar mesa'}</button>` : ''}
        ${due && canCharge ? `<button class="btn accent" data-a="pay">💸 Cobrar mesa ${U.money(due)}</button>` : ''}
        <button class="btn primary" data-a="order">＋ Agregar tanda</button>`
        : `<button class="btn ghost" data-a="receipt">🧾 Ver comprobante</button><button class="btn primary" data-a="done">Listo</button>`;

      const on = (sel, fn) => { const b = /** @type {HTMLElement | null} */ (E.querySelector(sel)); if (b) b.onclick = fn; };
      on('[data-a=order]', () => { m.close(); takeTableOrder(el, s.id); });
      on('[data-a=bill]', () => {
        S.requestTableBill(s.id);
        // primero se avisa a los demás equipos: el diálogo de impresión frena la página
        S.diff();
        S.flush();
        setTimeout(() => printBill(s, false), 80);
        PZ.toast(`Cuenta de la mesa ${tableNum(s)}: ${U.money(S.tableBalance(s))}`, 'ok');
      });
      on('[data-a=pay]', () => payTable(el, s.id, m));
      on('[data-a=move]', () => moveModal(el, m, s.id));
      on('[data-a=close]', () => {
        if (S.closeTableSession(s.id)) { m.close(); PZ.toast(`Mesa ${tableNum(s)} libre`); render(el); }
        else PZ.toast('Todavía hay saldo pendiente', 'warn');
      });
      on('[data-a=guests]', async () => {
        const v = await PZ.prompt('¿Cuántas personas?', { value: String(s.guests || ''), type: 'number' });
        if (v != null) S.setTableGuests(s.id, Number(v));
      });
      on('[data-a=receipt]', () => printBill(s, true));
      on('[data-a=done]', () => m.close());
      E.querySelectorAll('[data-served]').forEach((b) => { /** @type {HTMLElement} */ (b).onclick = () => S.setStatus(/** @type {HTMLElement} */ (b).dataset.served || '', 'entregado'); });
      E.querySelectorAll('[data-print-kit]').forEach((b) => {
        /** @type {HTMLElement} */ (b).onclick = () => { const o = S.order(/** @type {HTMLElement} */ (b).dataset.printKit || ''); if (o && PZ.ticket) PZ.ticket.printOrder(o, { kitchen: true, customer: false }); };
      });
      E.querySelectorAll('[data-void]').forEach((b) => {
        /** @type {HTMLElement} */ (b).onclick = async () => { const o = S.order(/** @type {HTMLElement} */ (b).dataset.void || ''); if (o && PZ.voidFlow) await PZ.voidFlow(o, 'Anular'); draw(); };
      });
    };
    panel = { sessionId, draw, el: E };
    draw();
  }

  /** Pre-cuenta (antes de cobrar) o comprobante final (después) */
  function printBill(s, paid) {
    if (!PZ.ticket) return;
    const bill = paid && s.bill ? S.tableBillOrder(s, s.bill.ticketNumber) : S.tableBillOrder(s);
    if (!bill.items.length) return PZ.toast('No hay nada para imprimir', 'warn');
    if (paid) PZ.ticket.preview(bill, { title: `🧾 Mesa ${tableNum(s)}` });
    else PZ.ticket.printOrder(bill, { kitchen: false, customer: true });
  }

  /** Cobra toda la cuenta en un solo cobro y un solo comprobante */
  async function payTable(el, sessionId, m) {
    const s = S.tableSession(sessionId);
    if (!s) return;
    if (!A().canCharge()) return PZ.toast('La cuenta la cobra la caja', 'warn');
    if (PZ.cash && !(await PZ.cash.ensureOpen())) return;
    const snapshot = S.tablePending(s).map((o) => o.id);
    const due = S.tableBalance(s);
    if (!due) return PZ.toast('No hay saldo para cobrar', 'warn');
    const res = await PZ.checkout({ tableBill: true, number: `Mesa ${tableNum(s)}`, total: due, items: [] });
    if (!res) return;
    let bill;
    try {
      bill = S.payTable(s.id, res.payments, res.adjust, snapshot);
    } catch (e) {
      return PZ.toast(e.message || 'No se pudo cobrar la mesa', 'err', 6000);
    }
    if (m) m.close();
    const left = S.tableBalance(s);
    if (left > 0) PZ.toast(`Ojo: entró otra tanda mientras cobrabas. Quedan ${U.money(left)} por cobrar en la mesa ${tableNum(s)}.`, 'warn', 7000);
    else PZ.toast(`Mesa ${tableNum(s)} cobrada y libre`, 'ok');
    if (PZ.afterPaid) PZ.afterPaid(bill, { ...res, kitchen: false });
    render(el);
  }

  /* ======================= Tomar una tanda ======================= */
  function takeTableOrder(el, sessionId) {
    const s0 = S.tableSession(sessionId);
    if (!s0) return;
    const table = S.table(s0.tableIds[0]);
    const nextBatch = S.tableOrders(s0).length + 1;
    const cats = (S.data.categories || []).slice().sort((a, b) => (a._i ?? 1e9) - (b._i ?? 1e9));
    let activeCat = cats[0] ? cats[0].id : '';
    let query = '';
    /** @type {PZ.OrderItem[]} */
    const items = [];
    let sent = false;

    const m = PZ.modal({
      title: `🍽️ Mesa ${table ? U.esc(table.number) : ''} · Tanda ${nextBatch}`,
      size: 'lg',
      dismissable: true,
      body: `
        <div class="salon-order-builder">
          <div class="pos-search"><input class="salon-search" type="search" placeholder="🔍 Buscar pizza, bebida, empanada…"></div>
          <div class="pos-cats salon-cat-tabs">
            ${cats.map((c) => `<button data-cat="${c.id}" class="cat-btn ${c.id === activeCat ? 'on' : ''}"><span class="c-ico">${c.icon || ''}</span>${U.esc(c.name)}</button>`).join('')}
          </div>
          <div class="prod-grid salon-prod-grid"></div>
          <div class="card salon-batch-tray">
            <div class="row-flex space-between"><b>Para mandar a la cocina</b><span class="badge" data-count>0 productos</span></div>
            <div class="salon-batch-items"></div>
            <div class="row-flex space-between batch-total"><span class="muted">Total de la tanda</span><strong data-batch-total>$ 0</strong></div>
          </div>
        </div>`,
      footer: `<button class="btn ghost" data-a="cancel">Volver</button><button class="btn primary lg grow" data-a="send" disabled>🚀 Mandar a la cocina</button>`,
      onClose: () => { if (!sent && items.length) PZ.toast('La tanda no se mandó (quedó sin enviar)', 'warn'); },
    });
    const E = m.el;
    const searchInput = /** @type {HTMLInputElement} */ (E.querySelector('.salon-search'));
    const prodGrid = /** @type {HTMLElement} */ (E.querySelector('.salon-prod-grid'));
    const trayItems = /** @type {HTMLElement} */ (E.querySelector('.salon-batch-items'));
    const countBadge = /** @type {HTMLElement} */ (E.querySelector('[data-count]'));
    const totalEl = /** @type {HTMLElement} */ (E.querySelector('[data-batch-total]'));
    const sendBtn = /** @type {HTMLButtonElement} */ (E.querySelector('[data-a=send]'));

    /** @type {HTMLElement} */ (E.querySelector('[data-a=cancel]')).onclick = () => {
      if (items.length && !confirm('Hay productos sin mandar a la cocina. ¿Salir igual?')) return;
      sent = true;
      m.close();
      sessionPanel(el, sessionId);
    };
    searchInput.oninput = () => { query = searchInput.value; renderCats(); renderProds(); };

    const batchTotal = () => items.reduce((a, i) => a + i.unitPrice * i.qty, 0);
    function renderCats() {
      E.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.cat === activeCat && !query.trim()));
    }
    function renderProds() {
      const q = U.stripAccents(query.toLowerCase().trim());
      let prods = S.data.products.filter((p) => p.active);
      prods = q ? prods.filter((p) => U.stripAccents((p.name + ' ' + (p.desc || '')).toLowerCase()).includes(q)) : prods.filter((p) => p.categoryId === activeCat);
      if (!prods.length) {
        prodGrid.innerHTML = `<div class="empty" style="grid-column:1/-1">No hay productos${q ? ' con “' + U.esc(query) + '”' : ' en esta categoría'}.</div>`;
        return;
      }
      prodGrid.innerHTML = prods.map((p) => {
        const cat = S.category(p.categoryId);
        const inBatch = items.filter((x) => x.productId === p.id).reduce((a, x) => a + x.qty, 0);
        const min = Math.min(...p.variants.map((v) => v.price));
        const icon = cat && cat.allowHalf ? `<div class="p-disc" style="--pc:${U.esc(p.color || 'var(--accent)')}"></div>` : `<div class="p-emoji">${cat ? cat.icon : '🍽️'}</div>`;
        return `<button class="prod${p.photo ? ' has-photo' : ''}" data-p="${p.id}">
          ${inBatch ? `<span class="badge accent prod-count">${inBatch}</span>` : ''}
          ${p.photo ? `<div class="p-photo">${PZ.carta.pic(p, icon)}</div>` : icon}
          <div class="p-name">${U.esc(p.name)}</div>
          <div class="p-price">${p.variants.length > 1 ? 'desde ' : ''}${U.money(min)}</div>
        </button>`;
      }).join('');
      prodGrid.querySelectorAll('[data-p]').forEach((b) => {
        /** @type {HTMLElement} */ (b).onclick = () => {
          const p = S.product(/** @type {HTMLElement} */ (b).dataset.p || '');
          if (!p) return;
          const cat = S.category(p.categoryId);
          if (p.variants.length === 1 && !(cat && cat.allowHalf)) addItem(S.makeItem({ product: p, variant: p.variants[0], qty: 1 }));
          else if (PZ.productModal) PZ.productModal(p, (item) => addItem(item));
        };
      });
    }
    function addItem(item) {
      const same = items.find((x) => x.productId === item.productId && x.variantId === item.variantId && !x.half && !item.half && !x.extras.length && !item.extras.length && !x.notes && !item.notes);
      if (same) { same.qty += item.qty; same.total = same.unitPrice * same.qty; } else items.push(item);
      if (navigator.vibrate) navigator.vibrate(15);
      refresh();
    }
    function refresh() {
      const tot = batchTotal();
      const count = items.reduce((a, i) => a + i.qty, 0);
      countBadge.textContent = `${count} producto${count === 1 ? '' : 's'}`;
      totalEl.textContent = U.money(tot);
      sendBtn.textContent = items.length ? `🚀 Mandar a la cocina · ${U.money(tot)}` : '🚀 Mandar a la cocina';
      sendBtn.disabled = !items.length;
      trayItems.innerHTML = items.length ? items.map((it, idx) => `
        <div class="tray-line">
          <div class="grow"><b>${it.qty}×</b> ${U.esc(it.name)}${it.variantName ? ` <span class="muted">(${U.esc(it.variantName)})</span>` : ''}
            ${it.extras && it.extras.length ? `<small class="muted">+ ${it.extras.map((e) => U.esc(e.name)).join(', ')}</small>` : ''}
            ${it.notes ? `<small class="muted">» ${U.esc(it.notes)}</small>` : ''}</div>
          <b>${U.money(it.unitPrice * it.qty)}</b>
          <div class="qty"><button data-sub="${idx}" aria-label="Uno menos">−</button><span>${it.qty}</span><button data-add="${idx}" aria-label="Uno más">+</button></div>
        </div>`).join('')
        : '<p class="small muted" style="margin:6px 0">Tocá los productos para sumarlos a esta tanda.</p>';
      trayItems.querySelectorAll('[data-add]').forEach((b) => { /** @type {HTMLElement} */ (b).onclick = () => { const it = items[Number(/** @type {HTMLElement} */ (b).dataset.add)]; it.qty += 1; it.total = it.unitPrice * it.qty; refresh(); }; });
      trayItems.querySelectorAll('[data-sub]').forEach((b) => {
        /** @type {HTMLElement} */ (b).onclick = () => {
          const i = Number(/** @type {HTMLElement} */ (b).dataset.sub);
          items[i].qty -= 1;
          if (items[i].qty <= 0) items.splice(i, 1); else items[i].total = items[i].unitPrice * items[i].qty;
          refresh();
        };
      });
      renderProds();
    }
    E.querySelectorAll('[data-cat]').forEach((b) => {
      /** @type {HTMLElement} */ (b).onclick = () => { activeCat = /** @type {HTMLElement} */ (b).dataset.cat || ''; query = ''; searchInput.value = ''; renderCats(); renderProds(); };
    });
    sendBtn.onclick = () => {
      if (!items.length) return;
      let o;
      try {
        o = S.addTableBatch(sessionId, items);
      } catch (e) {
        return PZ.toast(e.message || 'No se pudo mandar la tanda', 'err', 6000);
      }
      sent = true;
      const st = S.data.settings.ticket;
      // en impresión del sistema no se abre el diálogo solo (molesta en el salón): se imprime desde la cuenta
      if (st && st.printKitchen && st.printMode !== 'browser' && PZ.ticket) PZ.ticket.printOrder(o, { kitchen: true, customer: false });
      PZ.toast(`Tanda mandada a la cocina · mesa ${o.table} (${U.money(o.total)})`, 'ok');
      m.close();
      render(el);
      sessionPanel(el, o.tableSessionId);
    };
    refresh();
  }

  function moveModal(el, parent, sessionId) {
    const free = S.tables().filter((t) => !S.activeTableSession(t.id));
    if (!free.length) return PZ.toast('No hay mesas libres', 'warn');
    const m = PZ.modal({
      title: '↔ Pasar la cuenta a otra mesa',
      size: 'sm',
      body: `<div class="opt-grid">${free.map((t) => `<button class="opt" data-t="${t.id}">Mesa ${U.esc(t.number)}</button>`).join('')}</div>`,
      footer: '<button class="btn ghost" data-a="x">Cancelar</button>',
    });
    /** @type {HTMLElement} */ (m.el.querySelector('[data-a=x]')).onclick = () => m.close();
    m.el.querySelectorAll('[data-t]').forEach((b) => {
      /** @type {HTMLElement} */ (b).onclick = () => {
        if (S.moveTableSession(sessionId, /** @type {HTMLElement} */ (b).dataset.t || '')) { m.close(); parent.close(); render(el); }
        else PZ.toast('Esa mesa se ocupó recién, elegí otra', 'warn');
      };
    });
  }

  function addTable(el) {
    const n = String(Math.max(0, ...S.tables().map((t) => Number(t.number) || 0)) + 1);
    S.data.diningTables.push({ id: U.uid('table-'), areaId: S.data.diningAreas[0].id, number: n, capacity: 4, shape: 'round', x: 10, y: 10 });
    S.save();
    render(el);
  }

  PZ.views.salon = {
    title: 'Salón y mesas',
    render(el) {
      render(el);
      // Abrir directo una cuenta (por ejemplo desde el tablero de cocina)
      if (PZ.salonOpen) { const id = PZ.salonOpen; PZ.salonOpen = null; if (S.tableSession(id)) sessionPanel(el, id); }
      // En vivo: cambios propios y de otros equipos redibujan el mapa y la cuenta abierta
      let timer;
      const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!document.body.contains(el)) return;
          if (panel && document.body.contains(panel.el)) { panel.draw(); notifyReady(); }
          else if (!document.querySelector('.modal-back')) render(el);
          else notifyReady();
        }, 150);
      };
      const off = S.onChange(refresh);
      const tick = setInterval(() => { if (!document.querySelector('.modal-back')) render(el); }, 60000);
      return () => { off(); clearInterval(tick); clearTimeout(timer); panel = null; };
    },
  };
})(window.PZ);
