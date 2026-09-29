// @ts-check
/* Vista: Salón y mesas. Las cuentas son sesiones; cada envío crea una tanda/pedido. */
(function (PZ) {
  const S = PZ.store; const U = PZ.util;
  let area = 'all'; let listMode = false;

  const state = (session) => !session ? 'libre' : session.state === 'cuenta_solicitada' ? 'cuenta' : 'ocupada';
  const label = (session) => !session ? 'Libre' : session.state === 'cuenta_solicitada' ? 'Cuenta solicitada' : 'Ocupada';

  function render(el) {
    S.ensureDining();
    const areas = S.data.diningAreas;
    const tables = S.tables().filter((t) => area === 'all' || t.areaId === area);
    el.innerHTML = `<div class="salon-head"><div><div class="tabs-nav salon-tabs"><button data-area="all" class="${area === 'all' ? 'on' : ''}">Todas</button>${areas.map((a) => `<button data-area="${a.id}" class="${a.id === area ? 'on' : ''}">${U.esc(a.name)}</button>`).join('')}</div><p class="muted small">Tocá una mesa para abrir una cuenta o continuar una atención. Cada nuevo envío es una tanda separada.</p></div><div class="row-flex"><button class="btn ghost sm" data-a="view">${listMode ? '▦ Mapa' : '☷ Lista'}</button>${PZ.auth.isAdmin() ? '<button class="btn ghost sm" data-a="add">＋ Mesa</button>' : ''}</div></div>
      <div class="salon-layout"><section class="salon-map ${listMode ? 'list' : ''}">${tables.map(tableCard).join('')}</section><aside class="card salon-help"><h3>Atención por tandas</h3><ol><li>Abrí la mesa e indicá comensales.</li><li>Agregá una tanda: se envía a cocina sin repetir lo anterior.</li><li>Pedí la cuenta y cobrá los pedidos pendientes.</li><li>Con saldo cero, cerrá la atención.</li></ol><p class="small muted">El estado de cocina está en cada pedido, no en toda la mesa.</p></aside></div>`;
    el.querySelectorAll('[data-area]').forEach((b) => b.onclick = () => { area = b.dataset.area; render(el); });
    el.querySelector('[data-a=view]').onclick = () => { listMode = !listMode; render(el); };
    const add = el.querySelector('[data-a=add]'); if (add) add.onclick = () => addTable(el);
    el.querySelectorAll('[data-table]').forEach((b) => b.onclick = () => openTable(el, b.dataset.table));
  }

  function tableCard(t) {
    const s = S.activeTableSession(t.id); const orders = s ? S.tableOrders(s) : []; const minutes = s ? U.minutesSince(s.openedAt) : 0;
    return `<button class="dining-table ${state(s)} ${t.shape || 'round'}" data-table="${t.id}" style="--x:${t.x || 0};--y:${t.y || 0}"><b>${U.esc(t.number)}</b><span>${label(s)}</span>${s ? `<small>${s.guests || '—'} pers. · ${minutes} min</small><em>${U.money(S.tableBalance(s))}</em><i>${orders.length} tanda${orders.length === 1 ? '' : 's'}</i>` : `<small>${t.capacity || 4} cubiertos</small>`}</button>`;
  }

  function openTable(el, id) {
    let s = S.activeTableSession(id);
    if (!s) return openModal(el, id);
    sessionModal(el, s);
  }

  function openModal(el, tableId) {
    const t = S.table(tableId);
    const m = PZ.modal({
      title: `🍽️ Abrir mesa ${t.number}`,
      size: 'sm',
      body: `<label class="field"><span>Comensales</span><input name="guests" inputmode="numeric" value="2" autofocus></label><p class="small muted">La mesa quedará ocupada hasta que se cobre el saldo y se cierre la atención.</p>`,
      footer: '<button class="btn ghost" data-a="x">Cancelar</button><button class="btn ghost" data-a="ok">Solo abrir</button><button class="btn primary" data-a="order">Abrir y pedir</button>'
    });
    m.el.querySelector('[data-a=x]').onclick = () => m.close();
    m.el.querySelector('[data-a=ok]').onclick = () => {
      const guests = Math.max(1, Number(m.el.querySelector('[name=guests]').value) || 1);
      const s = S.openTable(tableId, { guests });
      m.close();
      sessionModal(el, s);
    };
    m.el.querySelector('[data-a=order]').onclick = () => {
      const guests = Math.max(1, Number(m.el.querySelector('[name=guests]').value) || 1);
      const s = S.openTable(tableId, { guests });
      m.close();
      takeTableOrder(el, s);
    };
  }

  function sessionModal(el, s) {
    const table = S.table(s.tableIds[0]); const orders = S.tableOrders(s); const due = S.tableBalance(s);
    const ordersHtml = orders.length ? `<div class="table-orders">${orders.map((o) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
        <div><b>Tanda #${o.number}</b> <span class="muted">${o.items.map((i) => `${i.qty}× ${U.esc(i.name)}`).join(', ')}</span></div>
        <div style="display:flex;align-items:center;gap:6px">
          <strong>${o.paid ? '<span class="badge ok">Cobrado</span>' : U.money(o.total)}</strong>
          <button class="icon-btn" data-print-kit="${o.id}" title="Imprimir comanda de cocina" style="width:32px;height:32px;font-size:15px">👨‍🍳</button>
          ${!o.paid ? `<button class="btn sm accent" data-pay-order="${o.id}">💸 Cobrar</button>` : ''}
        </div>
      </div>`).join('')}</div>` : '<p class="muted">Todavía no se enviaron productos a esta mesa.</p>';

    const canClose = due === 0;
    const footerHtml = `
      <button class="btn ghost" data-a="move">↔ Mover</button>
      ${orders.length ? `<button class="btn ghost" data-a="bill">${s.state === 'cuenta_solicitada' ? '🧾 Imprimir cuenta' : '🧾 Pedir cuenta'}</button>` : ''}
      ${canClose ? `<button class="btn ghost danger" data-a="close">${orders.length ? '✅ Cerrar mesa' : '✕ Liberar mesa'}</button>` : ''}
      <button class="btn primary" data-a="order">＋ Agregar tanda</button>
    `;

    const m = PZ.modal({
      title: `Mesa ${table.number} · ${label(s)}`,
      size: 'md',
      body: `<div class="table-summary"><div><span>Comensales</span><b>${s.guests || '—'}</b></div><div><span>Abierta hace</span><b>${U.minutesSince(s.openedAt)} min</b></div><div><span>Saldo pendiente</span><b>${U.money(due)}</b></div></div><h3>Tandas / Pedidos</h3>${ordersHtml}`,
      footer: footerHtml
    });
    const E = m.el;
    const orderBtn = E.querySelector('[data-a=order]');
    if (orderBtn) orderBtn.onclick = () => { m.close(); takeTableOrder(el, s); };
    const billBtn = E.querySelector('[data-a=bill]');
    if (billBtn) {
      billBtn.onclick = () => {
        S.requestTableBill(s.id);
        printTableBill(s);
        PZ.toast(`Cuenta solicitada para Mesa ${table ? table.number : ''}`, 'ok');
        m.close();
        render(el);
      };
    }
    const moveBtn = E.querySelector('[data-a=move]');
    if (moveBtn) moveBtn.onclick = () => moveModal(el, m, s);
    const closeBtn = E.querySelector('[data-a=close]');
    if (closeBtn) closeBtn.onclick = () => {
      if (S.closeTableSession(s.id)) { m.close(); render(el); }
      else PZ.toast('Todavía hay saldo pendiente', 'warn');
    };
    E.querySelectorAll('[data-print-kit]').forEach((btn) => {
      btn.onclick = () => {
        const orderId = btn.getAttribute('data-print-kit');
        const o = S.order(orderId);
        if (o && PZ.ticket) {
          PZ.ticket.printOrder(o, { kitchen: true, customer: false });
        }
      };
    });
    E.querySelectorAll('[data-pay-order]').forEach((btn) => {
      btn.onclick = async () => {
        const orderId = btn.getAttribute('data-pay-order');
        const o = S.order(orderId);
        if (!o) return;
        if (PZ.cash && !(await PZ.cash.ensureOpen())) return;
        S.computeTotals(o);
        const res = await PZ.checkout(o);
        if (!res) return;
        S.payOrder(o.id, res.payments, res.adjust);
        if (PZ.afterPaid) PZ.afterPaid(o, { ...res, kitchen: false });
        m.close();
        render(el);
      };
    });
  }

  function printTableBill(s) {
    const table = S.table(s.tableIds[0]);
    const orders = S.tableOrders(s);
    const due = S.tableBalance(s);
    if (!orders.length || !PZ.ticket) return;
    const allItems = orders.flatMap((o) => o.items);
    const billOrder = {
      id: s.id,
      number: `Mesa ${table ? table.number : ''}`,
      ticketNumber: table ? table.number : '0',
      type: 'mesa',
      table: table ? table.number : '',
      createdAt: s.openedAt,
      items: allItems,
      subtotal: due,
      total: due,
      paid: false,
      payments: [],
      notes: `Pre-cuenta · ${orders.length} tanda(s)${s.guests ? ' · ' + s.guests + ' personas' : ''}`,
    };
    PZ.ticket.printOrder(billOrder, { kitchen: false, customer: true });
  }

  function takeTableOrder(el, s) {
    const table = S.table(s.tableIds[0]);
    const batchNumber = (s.orderIds || []).length + 1;
    const cats = (S.data.categories || []).slice().sort((a, b) => (a._i ?? 1e9) - (b._i ?? 1e9));
    let activeCat = cats[0] ? cats[0].id : '';
    let query = '';
    /** @type {PZ.OrderItem[]} */
    let items = [];

    const m = PZ.modal({
      title: `🍽️ Mesa ${table ? table.number : ''} · Tanda #${batchNumber}`,
      size: 'lg',
      body: `
        <div class="salon-order-builder">
          <div class="pos-search mb" style="margin-bottom:10px">
            <input class="salon-search" placeholder="🔍 Buscar pizza, bebida, empanada..." style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.95em">
          </div>
          <div class="pos-cats salon-cat-tabs mb" style="display:flex;align-items:center;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:12px">
            ${cats.map((c) => `<button data-cat="${c.id}" class="cat-btn ${c.id === activeCat ? 'on' : ''}"><span class="c-ico">${c.icon || ''}</span>${U.esc(c.name)}</button>`).join('')}
            <button class="btn sm ghost" style="flex-shrink:0;padding:6px 10px" data-a="cfg-cats" title="Reordenar o editar categorías">⚙️ Organizar</button>
          </div>
          <div class="prod-grid salon-prod-grid" style="max-height:340px;overflow-y:auto;padding-bottom:12px;"></div>
          <div class="card salon-batch-tray mt" style="background:var(--bg-subtle, #fafafa);padding:12px;border-radius:8px;margin-top:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <b>Productos para esta comanda</b>
              <span class="badge" data-count>0 productos</span>
            </div>
            <div class="salon-batch-items"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:8px;border-top:1px solid var(--border)">
              <span class="muted">Total tanda</span>
              <strong style="font-size:1.3em" data-batch-total>$ 0</strong>
            </div>
          </div>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-a="cancel">Volver a Salón</button>
        <button class="btn primary lg grow" data-a="send" disabled>🚀 Enviar comanda a cocina ($ 0)</button>
      `
    });

    const E = m.el;
    const searchInput = E.querySelector('.salon-search');
    const prodGrid = E.querySelector('.salon-prod-grid');
    const trayItems = E.querySelector('.salon-batch-items');
    const countBadge = E.querySelector('[data-count]');
    const totalEl = E.querySelector('[data-batch-total]');
    const sendBtn = E.querySelector('[data-a=send]');

    E.querySelector('[data-a=cancel]').onclick = () => { m.close(); sessionModal(el, s); };
    const cfgBtn = E.querySelector('[data-a=cfg-cats]');
    if (cfgBtn) cfgBtn.onclick = () => { m.close(); PZ.configTab = 'categorias'; location.hash = '#/config'; };

    if (searchInput) {
      searchInput.oninput = () => {
        query = searchInput.value;
        renderCats();
        renderProds();
      };
    }

    function batchTotal() {
      return items.reduce((a, i) => a + (i.total || (i.unitPrice * i.qty)), 0);
    }

    function renderCats() {
      E.querySelectorAll('[data-cat]').forEach((b) => {
        const id = b.getAttribute('data-cat');
        b.classList.toggle('on', id === activeCat && !query.trim());
      });
    }

    function renderProds() {
      const q = U.stripAccents(query.toLowerCase().trim());
      let prods = S.data.products.filter((p) => p.active);
      if (q) {
        prods = prods.filter((p) => U.stripAccents((p.name + ' ' + (p.desc || '')).toLowerCase()).includes(q));
      } else {
        prods = prods.filter((p) => p.categoryId === activeCat);
      }

      if (!prods.length) {
        prodGrid.innerHTML = `<div class="empty" style="grid-column:1/-1;text-align:center;padding:24px;color:var(--muted)">No hay productos en esta categoría${q ? ' con “' + U.esc(query) + '”' : ''}.</div>`;
        return;
      }

      prodGrid.innerHTML = prods.map((p, i) => {
        const cat = S.category(p.categoryId);
        const isPizza = cat && cat.allowHalf;
        const itemInBatch = items.filter((x) => x.productId === p.id).reduce((a, x) => a + x.qty, 0);
        const minPrice = Math.min(...p.variants.map((v) => v.price));
        const priceText = p.variants.length > 1 ? `desde ${U.money(minPrice)}` : U.money(minPrice);
        return `
          <button class="prod" data-p="${p.id}" style="position:relative;text-align:left;cursor:pointer;animation-delay:${i * 0.02}s">
            ${itemInBatch ? `<span class="badge accent" style="position:absolute;top:6px;right:6px;font-size:0.8em">${itemInBatch}</span>` : ''}
            ${isPizza ? `<div class="p-disc" style="--pc:${p.color || 'var(--accent)'}"></div>` : `<div class="p-emoji">${cat ? cat.icon : '🍽️'}</div>`}
            <div class="prod-top"><span class="prod-cat">${cat ? cat.name : ''}</span><b class="prod-price">${priceText}</b></div>
            <div class="prod-name"><b>${U.esc(p.name)}</b></div>
            ${p.desc ? `<div class="prod-desc muted small">${U.esc(p.desc)}</div>` : ''}
          </button>
        `;
      }).join('');

      prodGrid.querySelectorAll('[data-p]').forEach((b) => {
        b.onclick = () => {
          const p = S.product(b.getAttribute('data-p'));
          if (!p) return;
          const cat = S.category(p.categoryId);
          if (p.variants.length === 1 && !(cat && cat.allowHalf)) {
            addItem(S.makeItem({ product: p, variant: p.variants[0], qty: 1 }));
          } else if (PZ.productModal) {
            PZ.productModal(p, (item) => addItem(item));
          }
        };
      });
    }

    function addItem(item) {
      const same = items.find((x) => x.productId === item.productId && x.variantId === item.variantId && !x.half && !item.half && !x.extras.length && !item.extras.length && !x.notes && !item.notes);
      if (same) {
        same.qty += item.qty;
        same.total = same.unitPrice * same.qty;
      } else {
        items.push(item);
      }
      refresh();
    }

    function refresh() {
      const tot = batchTotal();
      const count = items.reduce((a, i) => a + i.qty, 0);
      countBadge.textContent = `${count} producto${count === 1 ? '' : 's'}`;
      totalEl.textContent = U.money(tot);
      sendBtn.textContent = `🚀 Enviar comanda a cocina (${U.money(tot)})`;
      sendBtn.disabled = items.length === 0;

      if (!items.length) {
        trayItems.innerHTML = '<p class="small muted" style="margin:6px 0">Tocá los productos del catálogo arriba para sumarlos a esta comanda.</p>';
      } else {
        trayItems.innerHTML = items.map((it, idx) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.95em">
            <div>
              <b>${it.qty}×</b> ${U.esc(it.name)}
              ${it.extras && it.extras.length ? `<small class="muted">+ ${it.extras.map((e) => U.esc(e.name)).join(', ')}</small>` : ''}
              ${it.notes ? `<small class="muted">(${U.esc(it.notes)})</small>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <b>${U.money(it.total)}</b>
              <button class="icon-btn sm" data-add="${idx}" title="Sumar uno">＋</button>
              <button class="icon-btn sm" data-sub="${idx}" title="Restar uno">－</button>
              <button class="icon-btn sm" data-del="${idx}" title="Quitar">✕</button>
            </div>
          </div>
        `).join('');

        trayItems.querySelectorAll('[data-add]').forEach((b) => {
          b.onclick = () => {
            const i = Number(b.getAttribute('data-add'));
            items[i].qty += 1;
            items[i].total = items[i].unitPrice * items[i].qty;
            refresh();
          };
        });
        trayItems.querySelectorAll('[data-sub]').forEach((b) => {
          b.onclick = () => {
            const i = Number(b.getAttribute('data-sub'));
            items[i].qty -= 1;
            if (items[i].qty <= 0) items.splice(i, 1);
            else items[i].total = items[i].unitPrice * items[i].qty;
            refresh();
          };
        });
        trayItems.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = () => {
            const i = Number(b.getAttribute('data-del'));
            items.splice(i, 1);
            refresh();
          };
        });
      }
      renderProds();
    }

    E.querySelectorAll('[data-cat]').forEach((b) => {
      b.onclick = () => {
        activeCat = b.getAttribute('data-cat') || '';
        query = '';
        if (searchInput) searchInput.value = '';
        renderCats();
        renderProds();
      };
    });

    sendBtn.onclick = () => {
      if (!items.length) return;
      const o = S.createOrder({
        type: 'mesa',
        table: table ? table.number : '',
        tableSessionId: s.id,
        batchNumber,
        items,
      });
      const st = S.data.settings.ticket;
      if (st && st.printKitchen && st.printMode !== 'browser' && PZ.ticket) {
        PZ.ticket.printOrder(o, { kitchen: true, customer: false });
      }
      PZ.toast(`Tanda #${batchNumber} enviada a cocina (${U.money(o.total)})`, 'ok');
      m.close();
      render(el);
      sessionModal(el, s);
    };

    refresh();
  }

  function moveModal(el, parent, s) { const free = S.tables().filter((t) => !S.activeTableSession(t.id)); if (!free.length) return PZ.toast('No hay mesas libres', 'warn'); const m = PZ.modal({ title: 'Mover cuenta', size: 'sm', body: `<div class="opt-grid">${free.map((t) => `<button class="opt" data-t="${t.id}">Mesa ${t.number}</button>`).join('')}</div>`, footer: '<button class="btn ghost" data-a="x">Cancelar</button>' }); m.el.querySelector('[data-a=x]').onclick = () => m.close(); m.el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { S.moveTableSession(s.id, b.dataset.t); m.close(); parent.close(); render(el); }); }
  function addTable(el) { const n = String(Math.max(0, ...S.tables().map((t) => Number(t.number) || 0)) + 1); S.data.diningTables.push({ id: U.uid('table-'), areaId: S.data.diningAreas[0].id, number: n, capacity: 4, shape: 'round', x: 10, y: 10 }); S.save(); render(el); }
  PZ.views.salon = { title: 'Salón y mesas', render };
})(window.PZ);
