// @ts-check
/* ==========================================================================
   Vista: PEDIDOS — tablero en vivo para cocina, mostrador y delivery
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;

  const COLS = [
    { id: 'pendiente', label: '📥 Recibidos', next: 'horno', nextLabel: '🔥 Al horno' },
    { id: 'horno', label: '🔥 En el horno', next: 'listo', nextLabel: '✅ Listo' },
    { id: 'listo', label: '✅ Listos', next: null },
    { id: 'en_camino', label: '🛵 En camino', next: 'entregado', nextLabel: '🏁 Entregado' },
  ];
  let mobileCol = 'pendiente';
  let lastPending = null;

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach((t, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = i ? 1046 : 784;
        g.gain.setValueAtTime(0.2, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.26);
      });
    } catch (e) { /* sin audio */ }
  }

  function render(el) {
    const active = S.data.orders.filter((o) => !o.voided && !['entregado', 'cancelado'].includes(o.status));
    const pendingCount = active.filter((o) => o.status === 'pendiente').length;
    if (lastPending !== null && pendingCount > lastPending) beep();
    lastPending = pendingCount;

    const prep = S.data.settings.prepMinutes || 35;
    const today = S.data.orders.filter((o) => o.status === 'entregado' && o.createdAt >= U.startOfDay().getTime()).slice().reverse();
    const web = PZ.web && PZ.auth.can('vender') ? PZ.web.pending() : [];

    el.innerHTML = `
      <div class="row-flex space-between mb">
        <div class="muted">Los pedidos avanzan de izquierda a derecha. Se marcan en rojo los que pasan los ${prep} minutos.</div>
        ${PZ.auth.can('vender') ? '<a class="btn primary" href="#/vender">🍕 Nuevo pedido</a>' : ''}
      </div>
      ${web.length ? `<div class="card web-inbox mb">
        <h3>📲 Pedidos de la carta online por confirmar <span class="badge pri">${web.length}</span></h3>
        <p class="muted small" style="margin-top:0">Al aceptarlo pasa a <b>Recibidos</b> con todos los productos cargados. Se cobra al entregar, como cualquier pedido.</p>
        <div class="web-grid">${web.map((w) => PZ.web.cardHTML(w)).join('')}</div>
      </div>` : ''}
      <div class="seg board-tabs">${COLS.map((c) => `<button data-mc="${c.id}" class="${mobileCol === c.id ? 'on' : ''}">${c.label} (${active.filter((o) => o.status === c.id || (c.id === 'horno' && o.status === 'preparando')).length})</button>`).join('')}</div>
      <div class="board tabs">
        ${COLS.map((c) => {
          const list = active.filter((o) => o.status === c.id || (c.id === 'horno' && o.status === 'preparando'));
          return `<div class="col ${mobileCol === c.id ? 'show' : ''}">
            <div class="col-head"><span>${c.label}</span><span class="ch-count">${list.length}</span></div>
            ${list.length ? list.map((o) => card(o, c, prep)).join('') : '<div class="empty small"><span class="e-ico" style="font-size:34px">🍃</span>Nada por acá</div>'}
          </div>`;
        }).join('')}
      </div>
      <div class="card mt"><h3>🏁 Entregados hoy <span class="badge">${today.length}</span></h3>
        ${today.length ? `<div class="table-wrap"><table class="tbl"><tbody>${today.slice(0, 40).map((o) => `<tr><td>#${o.number}</td><td>${PZ.labels.typeIcon[o.type]} ${U.esc(o.customerName || PZ.labels.type[o.type])}</td><td class="small muted">${o.items.map((i) => i.qty + 'x ' + U.esc(i.name)).join(', ')}</td><td class="right">${U.money(o.total)}</td><td class="small muted">${o.statusTimes && o.statusTimes.entregado ? Math.round((o.statusTimes.entregado - o.createdAt) / 60000) + ' min' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty small">Todavía no se entregó nada hoy</div>'}
      </div>`;

    el.querySelectorAll('[data-mc]').forEach((b) => b.onclick = () => { mobileCol = b.dataset.mc; render(el); });
    el.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => action(el, b.dataset.id, b.dataset.act));
    if (web.length) PZ.web.bind(el, () => render(el));
  }

  function card(o, col, prep) {
    const L = PZ.labels;
    const mins = U.minutesSince(o.createdAt);
    const late = mins > prep && o.status !== 'en_camino';
    const isDelivery = o.type === 'delivery';
    let next = col.next;
    let nextLabel = col.nextLabel;
    if (col.id === 'listo') {
      next = isDelivery ? 'en_camino' : 'entregado';
      nextLabel = isDelivery ? '🛵 Salió' : '🏁 Entregado';
    }
    const canCook = PZ.auth.can('pedidos');
    const canCash = PZ.auth.can('vender');
    const mapUrl = o.address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address + ', ' + (S.data.settings.business.city || '')) : '';
    return `<div class="ocard ${late ? 'late' : ''}">
      ${o.status === 'horno' ? '<div class="steam"><i></i><i></i><i></i></div>' : ''}
      <div class="oc-top">
        <span class="oc-num">#${o.number}</span>
        <span class="timer ${late ? 'badge err' : 'badge'}">⏱ ${mins} min</span>
      </div>
      <div class="row-flex" style="gap:6px">
        <span class="badge pri">${L.typeIcon[o.type]} ${L.type[o.type]}${o.type === 'mesa' && o.table ? ' ' + U.esc(o.table) : ''}</span>
        ${o.web ? `<span class="badge">📲 W-${o.web.number}</span>` : ''}
        ${o.paid ? '<span class="badge ok">Pagado</span>' : `<span class="badge warn">A cobrar ${U.money(o.total)}</span>`}
        ${o.eta ? `<span class="badge">🕒 ${U.esc(o.eta)}</span>` : ''}
      </div>
      ${o.customerName ? `<div style="margin-top:6px;font-weight:800">${U.esc(o.customerName)}</div>` : ''}
      ${isDelivery && o.address ? `<div class="small"><a href="${mapUrl}" target="_blank" rel="noopener">📍 ${U.esc(o.address)}</a></div>` : ''}
      ${isDelivery && o.driver ? `<div class="small muted">Repartidor: ${U.esc(o.driver)}</div>` : ''}
      <div class="oc-items">${o.items.map((it) => `<div><b>${it.qty}x</b> ${U.esc(it.name)}${it.variantName ? ' <span class="muted">(' + U.esc(it.variantName) + ')</span>' : ''}${it.extras.length ? `<div class="small muted">+ ${it.extras.map((e) => U.esc(e.name)).join(', ')}</div>` : ''}${it.notes ? `<div class="oc-note">» ${U.esc(it.notes)}</div>` : ''}</div>`).join('')}</div>
      ${o.notes ? `<div class="oc-note">📝 ${U.esc(o.notes)}</div>` : ''}
      <div class="oc-actions">
        ${canCook && next ? `<button class="btn sm primary" data-act="to:${next}" data-id="${o.id}">${nextLabel}</button>` : ''}
        ${canCash && !o.paid ? `<button class="btn sm accent" data-act="pay" data-id="${o.id}">💸 Cobrar</button>` : ''}
        ${isDelivery && canCash ? `<button class="btn sm ghost" data-act="driver" data-id="${o.id}" title="Repartidor">🛵</button>` : ''}
        ${o.phone ? `<button class="btn sm ghost" data-act="wa" data-id="${o.id}" title="Avisar por WhatsApp">💬</button>` : ''}
        <button class="btn sm ghost" data-act="print" data-id="${o.id}" title="Imprimir">🖨️</button>
        ${canCash ? `<button class="btn sm ghost" data-act="cancel" data-id="${o.id}" title="Cancelar">✕</button>` : ''}
      </div>
    </div>`;
  }

  async function action(el, id, act) {
    const o = S.order(id);
    if (!o) return;
    if (act.startsWith('to:')) {
      const st = act.slice(3);
      if (st === 'entregado' && !o.paid) {
        if (!PZ.auth.can('vender')) return PZ.toast('Este pedido todavía no está cobrado', 'warn');
        const paid = await pay(o);
        if (!paid) return;
      }
      S.setStatus(o.id, st);
      if (st === 'entregado') PZ.toast(`Pedido #${o.number} entregado 🎉`);
      return render(el);
    }
    if (act === 'pay') { await pay(o); return render(el); }
    if (act === 'print') {
      const m = PZ.modal({
        title: `🖨️ Pedido #${o.number}`, size: 'sm',
        body: `<div class="cards"><button class="btn block" data-p="k">👨‍🍳 Comanda de cocina</button><button class="btn block" data-p="c">🧾 ${o.paid ? 'Comprobante de pago' : 'Comprobante de pedido (para el repartidor)'}</button><button class="btn ghost block" data-p="v">👀 Ver comprobante</button></div>`,
      });
      m.el.querySelector('[data-p=k]').onclick = () => { m.close(); PZ.ticket.printOrder(o, { kitchen: true, customer: false }); };
      m.el.querySelector('[data-p=c]').onclick = () => { m.close(); PZ.ticket.printOrder(o); };
      m.el.querySelector('[data-p=v]').onclick = () => { m.close(); PZ.ticket.preview(o); };
      return;
    }
    if (act === 'wa') {
      const b = S.data.settings.business;
      const msgs = {
        pendiente: `¡Hola${o.customerName ? ' ' + o.customerName.split(' ')[0] : ''}! Recibimos tu pedido #${o.number} en ${b.name} 🍕`,
        horno: `¡Tu pedido #${o.number} ya está en el horno! 🔥`,
        listo: o.type === 'delivery' ? `Tu pedido #${o.number} está listo y sale en unos minutos 🛵` : `¡Tu pedido #${o.number} está listo para retirar! 🍕`,
        en_camino: `¡Tu pedido #${o.number} ya salió! Llega en unos minutos 🛵${o.paid ? '' : ` Total a pagar: ${U.money(o.total)}`}`,
      };
      window.open(`https://wa.me/${U.phoneForWa(o.phone)}?text=${encodeURIComponent(msgs[o.status] || msgs.pendiente)}`, '_blank', 'noopener');
      return;
    }
    if (act === 'driver') {
      const drivers = S.data.settings.drivers || [];
      const slug = (S.data.branch && S.data.branch.slug) || '';
      const matched = PZ.carta ? PZ.carta.matchDriver(drivers, o.driver || '') : null;
      const driverCode = matched ? matched.code : '';
      const repUrl = PZ.carta ? PZ.carta.repartoUrl(location.href, slug, o.driver || '', '', driverCode) : ('reparto.html?l=' + encodeURIComponent(slug));
      const m = PZ.modal({
        title: '🛵 Asignar repartidor', size: 'sm',
        body: `<div class="opt-grid">${drivers.map((d) => {
          const name = typeof d === 'object' ? d.name : d;
          const code = typeof d === 'object' && d.code ? d.code : '';
          return `<button class="opt ${o.driver === name ? 'on' : ''}" data-d="${U.esc(name)}" data-c="${U.esc(code)}" style="display:flex;align-items:center;justify-content:space-between">
            <span>🛵 <b>${U.esc(name)}</b></span>
            ${code ? `<span class="badge pri" style="font-family:monospace;font-size:0.75rem">${U.esc(code)}</span>` : ''}
          </button>`;
        }).join('')}</div>${drivers.length ? '' : '<p class="muted">Cargá repartidores en Configuración o en Equipo.</p>'}
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px">
          <button class="btn ghost sm" data-act="copy-driver-link" style="justify-content:center">📲 Copiar link para el repartidor</button>
          <a class="btn ghost sm" href="${U.esc(repUrl)}" target="_blank" rel="noopener" style="justify-content:center">📱 Abrir panel de repartidor ↗</a>
        </div>`,
      });
      m.el.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
        const btn = /** @type {HTMLElement} */ (b);
        o.driver = btn.dataset.d || '';
        S.save();
        m.close();
        render(el);
      });
      const copyBtn = m.el.querySelector('[data-act=copy-driver-link]');
      if (copyBtn) {
        copyBtn.onclick = async () => {
          try {
            const curMatched = PZ.carta ? PZ.carta.matchDriver(drivers, o.driver || '') : null;
            const curCode = curMatched ? curMatched.code : '';
            const currentRepUrl = PZ.carta ? PZ.carta.repartoUrl(location.href, slug, o.driver || '', '', curCode) : ('reparto.html?l=' + encodeURIComponent(slug));
            await navigator.clipboard.writeText(currentRepUrl);
            PZ.toast(`Link copiado para ${o.driver || 'el repartidor'} 📲`);
          } catch (e) {
            PZ.toast('No se pudo copiar el link', 'warn');
          }
        };
      }
      return;
    }
    if (act === 'cancel') {
      if (await PZ.voidFlow(o, 'Cancelar')) render(el);
    }
  }

  /**
   * Anular / cancelar una venta: pide autorización de encargado si hace
   * falta, el motivo, y la anula en el servidor. Devuelve true si se anuló.
   */
  PZ.voidFlow = async function (o, verb = 'Anular') {
    if (!navigator.onLine) { PZ.toast('Para anular hace falta conexión a internet', 'warn'); return false; }
    const auth = await PZ.auth.requireAdmin(`${verb} una venta requiere un encargado`);
    if (!auth) return false;
    try {
      const reason = await PZ.prompt('Motivo', { title: `${verb} pedido #${o.number}` });
      if (reason == null) return false;
      if (!reason.trim()) { PZ.toast('Tenés que indicar el motivo', 'warn'); return false; }
      const client = auth === true ? null : auth;
      if (S.order(o.id)) await S.voidOrder(o.id, reason.trim(), client);
      else Object.assign(o, await PZ.cloud.voidOrder(S.ctx.orgId, o.id, reason.trim(), client));
      PZ.toast(o.paid ? `Anulado. Devolvé ${U.money(o.total)} al cliente si corresponde.` : `Pedido #${o.number} cancelado`, 'warn', 4500);
      return true;
    } catch (e) {
      PZ.toast(e.message || 'No se pudo anular', 'err', 5000);
      return false;
    } finally {
      PZ.auth.release(auth);
    }
  };

  async function pay(o) {
    if (!(await PZ.cash.ensureOpen())) return false;
    S.computeTotals(o);
    const res = await PZ.checkout(o);
    if (!res) return false;
    S.payOrder(o.id, res.payments, res.adjust);
    PZ.afterPaid(o, { ...res, kitchen: false });
    return true;
  }

  PZ.views.pedidos = {
    title: 'Pedidos en curso',
    live: true,
    render(el) {
      render(el);
      const t = setInterval(() => { if (!document.querySelector('.modal-back')) render(el); }, 30000);
      const off = PZ.web ? PZ.web.onChange(() => { if (!document.querySelector('.modal-back')) render(el); }) : () => {};
      return () => { clearInterval(t); off(); };
    },
  };
})(window.PZ);
