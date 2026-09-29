// @ts-check
/* ==========================================================================
   PZ.web — pedidos que llegan por la carta online
     · llegan en tiempo real (con aviso sonoro) a la sucursal
     · el cajero los acepta (pasan a cocina como cualquier pedido, sin volver
       a cargarlos) o los rechaza, y le avisa al cliente por WhatsApp
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  const PAY = { efectivo: '💵 Efectivo', transferencia: '🏦 Transferencia', tarjeta: '💳 Tarjeta' };
  const TYPE = { retiro: '🥡 Retiro', delivery: '🛵 Delivery', mesa: '🍽️ Mesa' };
  let list = [];
  const listeners = new Set();

  const W = (PZ.web = {
    PAY, TYPE,
    all: () => list,
    pending: () => list.filter((w) => w.status === 'nuevo'),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit() {
      listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
      if (PZ.app) PZ.app.refreshChrome();
    },

    async load() {
      list = [];
      if (!PZ.auth.feature('carta') || !navigator.onLine || !S.ctx.branchId) return W.emit();
      try { list = await PZ.cloud.webOrders(S.ctx.branchId); } catch (e) { console.warn('pedidos web', e); }
      W.emit();
    },

    /** Cambio en tiempo real (pedido nuevo o atendido desde otro equipo) */
    onRemote(p) {
      const row = p.new && Object.keys(p.new).length ? p.new : null;
      if (!row || row.branch_id !== S.ctx.branchId) return;
      const i = list.findIndex((x) => x.id === row.id);
      if (i >= 0) list[i] = row;
      else {
        list.unshift(row);
        if (row.status === 'nuevo') W.notify(row);
      }
      W.emit();
    },

    notify(w) {
      if (!PZ.auth.can('vender')) return;
      PZ.beep([880, 1175, 1568]);
      if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
      PZ.toast(`📲 Pedido web W-${w.number} · ${w.data.name} · ${U.money(w.total)}`, 'info', 6000);
      try {
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(`Pedido web W-${w.number}`, { body: `${w.data.name} · ${U.money(w.total)}`, icon: 'img/icon.svg' });
        }
      } catch (e) { /* sin notificaciones */ }
    },

    /** Tarjeta para el tablero de pedidos */
    cardHTML(w) {
      const d = w.data;
      const mins = U.minutesSince(w.created_at);
      const cash = d.payment === 'efectivo' && d.cashWith ? ` · paga con ${U.money(d.cashWith)}` : '';
      return `<div class="ocard web ${mins >= 5 ? 'late' : ''}" data-web="${w.id}">
        <div class="oc-top"><span class="oc-num">📲 W-${w.number}</span><span class="badge ${mins >= 5 ? 'err' : ''}">⏱ ${mins} min</span></div>
        <div class="row-flex" style="gap:6px">
          <span class="badge pri">${TYPE[d.type] || d.type}${d.type === 'mesa' && d.table ? ' ' + U.esc(d.table) : ''}</span>
          <span class="badge warn">${PAY[d.payment] || d.payment} · ${U.money(w.total)}${cash}</span>
        </div>
        <div style="margin-top:6px;font-weight:800">${U.esc(d.name)} <a class="small" href="tel:${U.esc(d.phone)}">${U.esc(d.phone)}</a></div>
        ${d.type === 'delivery' ? `<div class="small">📍 ${U.esc(d.address)}${d.zoneName ? ` · ${U.esc(d.zoneName)}` : ''}</div>` : ''}
        <div class="oc-items">${d.items.map((it) => `<div><b>${it.qty}x</b> ${U.esc(it.name)}${it.variantName ? ' <span class="muted">(' + U.esc(it.variantName) + ')</span>' : ''}${it.extras && it.extras.length ? `<div class="small muted">+ ${it.extras.map((e) => U.esc(e.name)).join(', ')}</div>` : ''}${it.notes ? `<div class="oc-note">» ${U.esc(it.notes)}</div>` : ''}</div>`).join('')}</div>
        ${d.notes ? `<div class="oc-note">📝 ${U.esc(d.notes)}</div>` : ''}
        <div class="oc-actions">
          <button class="btn sm primary" data-wa-act="accept" data-id="${w.id}">✅ Aceptar</button>
          <button class="btn sm ghost" data-wa-act="reject" data-id="${w.id}">✕ Rechazar</button>
          <button class="btn sm ghost" data-wa-act="chat" data-id="${w.id}" title="Escribirle por WhatsApp">💬</button>
        </div>
      </div>`;
    },

    /** Conecta los botones de las tarjetas de pedidos web dentro de `el` */
    bind(el, after) {
      el.querySelectorAll('[data-wa-act]').forEach((b) => b.onclick = async () => {
        const w = list.find((x) => x.id === b.dataset.id);
        if (!w) return;
        const act = b.dataset.waAct;
        if (act === 'chat') return W.chat(w, `¡Hola ${w.data.name.split(' ')[0]}! Te escribimos por tu pedido W-${w.number} 🍕`);
        b.disabled = true;
        try {
          if (act === 'accept') await W.accept(w);
          if (act === 'reject') await W.reject(w);
        } catch (e) {
          PZ.toast(e.message || 'No se pudo completar', 'err', 5000);
        } finally {
          b.disabled = false;
          if (after) after();
        }
      });
    },

    /** Abre WhatsApp con el cliente */
    chat(w, text) {
      window.open(PZ.carta.waLink(w.data.phone, text), '_blank', 'noopener');
    },

    /** Acepta: pasa a ser un pedido del local (a cocina, sin cobrar) */
    async accept(w) {
      if (!navigator.onLine) throw new Error('Para aceptar pedidos web hace falta internet');
      const d = w.data;
      const orderId = U.uid('o-');
      // El servidor bloquea el pedido web y crea la comanda en una transacción.
      // Repetir la llamada devuelve la misma comanda, no una segunda pizza.
      const remoteOrder = await PZ.cloud.acceptWebOrder(w.id, orderId);
      if (!remoteOrder) throw new Error('Este pedido ya lo atendió otra persona');
      Object.assign(w, { status: 'aceptado', order_id: remoteOrder.id });
      const payTxt = `${PAY[d.payment] || d.payment}${d.payment === 'efectivo' && d.cashWith ? ` (trae ${U.money(d.cashWith)})` : ''}`;
      const o = { ...remoteOrder, id: remoteOrder.id };
      if (!S.order(o.id)) S.data.orders.push(o);
      S.rebuildShadow();
      S.cache(true);
      S.log('pedido web', `Aceptado W-${w.number} → pedido #${o.number}`);
      W.emit();
      const st = S.data.settings;
      if (st.ticket.printKitchen) PZ.ticket.printOrder(o, { kitchen: true, customer: o.type === 'delivery' });
      const on = st.online || {};
      const pickupMins = on.pickupMinutes || st.pickupMinutes || st.prepMinutes || 15;
      const deliveryMins = on.deliveryMinutes || st.deliveryMinutes || ((st.prepMinutes || 35) + 15);
      const msg = `¡Hola ${d.name.split(' ')[0]}! 🍕 Confirmamos tu pedido W-${w.number} en ${st.business.name}.\n`
        + `${o.type === 'delivery' ? `Llega en aproximadamente ${deliveryMins} minutos` : o.type === 'mesa' ? 'Ya lo estamos preparando' : `Va a estar listo para retirar en unos ${pickupMins} minutos`}.\n`
        + `Total: ${U.money(o.total)}. ¡Gracias!`;
      const m = PZ.modal({
        title: `✅ Pedido W-${w.number} aceptado`,
        size: 'sm',
        body: `<p style="margin-top:0">Quedó como pedido <b>#${o.number}</b> y ya está en la cocina.</p>
          <p class="muted small">Avisale al cliente que lo confirmaste:</p>`,
        footer: `<button class="btn ghost" data-a="x">Listo</button><button class="btn primary" data-a="wa">💬 Confirmar por WhatsApp</button>`,
      });
      m.el.querySelector('[data-a=x]').onclick = () => m.close();
      m.el.querySelector('[data-a=wa]').onclick = () => { m.close(); W.chat(w, msg); };
      return o;
    },

    async reject(w) {
      if (!navigator.onLine) throw new Error('Para rechazar pedidos web hace falta internet');
      const reason = await new Promise((resolve) => {
        let done = false;
        const opts = ['No nos queda algún producto', 'La dirección está fuera de la zona de envío', 'Estamos por cerrar', 'Hay mucha demora en este momento'];
        const m = PZ.modal({
          title: `✕ Rechazar W-${w.number}`,
          size: 'sm',
          body: `<p class="muted" style="margin-top:0">El cliente lo ve en el seguimiento del pedido.</p>
            <div class="cards">${opts.map((o) => `<button class="btn ghost block" data-r="${U.esc(o)}">${U.esc(o)}</button>`).join('')}</div>
            <label class="field mt"><span>Otro motivo</span><input class="rsn" maxlength="200"></label>`,
          footer: `<button class="btn ghost" data-a="x">Volver</button><button class="btn danger" data-a="ok">Rechazar</button>`,
          onClose: () => { if (!done) resolve(null); },
        });
        const finish = (v) => { done = true; m.close(); resolve(v); };
        m.el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => finish(b.dataset.r));
        m.el.querySelector('[data-a=x]').onclick = () => m.close();
        m.el.querySelector('[data-a=ok]').onclick = () => finish(m.el.querySelector('.rsn').value.trim() || 'No podemos tomar el pedido en este momento');
      });
      if (reason == null) return null;
      const res = await PZ.cloud.handleWebOrder(w.id, { status: 'rechazado', reason });
      if (!res) { await W.load(); throw new Error('Este pedido ya lo atendió otra persona'); }
      Object.assign(w, res);
      S.log('pedido web', `Rechazado W-${w.number}: ${reason}`);
      W.emit();
      if (await PZ.confirm('¿Avisarle al cliente por WhatsApp?', { title: 'Pedido rechazado', ok: '💬 Avisar' })) {
        W.chat(w, `¡Hola ${w.data.name.split(' ')[0]}! Lamentablemente no podemos tomar tu pedido W-${w.number}: ${reason}. ¡Disculpá!`);
      }
      return res;
    },
  });
})(window.PZ);
