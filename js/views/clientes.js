// @ts-check
/* ==========================================================================
   Vista: CLIENTES — agenda, historial de compras y fidelización
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  let q = '';

  function render(el) {
    el.innerHTML = `
      <div class="row-flex space-between mb">
        <input type="search" class="grow" placeholder="🔎 Buscar por nombre, teléfono o dirección…" value="${U.esc(q)}" style="max-width:480px">
        <button class="btn primary" data-a="new">➕ Nuevo cliente</button>
      </div>
      <div class="card"><div class="list"></div></div>`;
    const inp = el.querySelector('input');
    inp.addEventListener('input', U.debounce(() => { q = inp.value; draw(el); }, 150));
    el.querySelector('[data-a=new]').onclick = () => edit(null, () => draw(el));
    draw(el);
  }

  function draw(el) {
    const qq = U.stripAccents(q.toLowerCase());
    const list = S.data.customers
      .filter((c) => !qq || U.stripAccents(`${c.name} ${c.phone} ${c.address}`.toLowerCase()).includes(qq))
      .map((c) => ({ c, st: S.customerStats(c.id) }))
      .sort((a, b) => b.st.total - a.st.total);
    const box = el.querySelector('.list');
    if (!list.length) { box.innerHTML = '<div class="empty"><span class="e-ico">👥</span>No hay clientes. Se agregan solos cuando cargás un pedido con teléfono.</div>'; return; }
    box.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Cliente</th><th>Teléfono</th><th>Dirección</th><th class="right">Pedidos</th><th class="right">Gastado</th><th>Último</th><th></th></tr></thead><tbody>
      ${list.map(({ c, st }, i) => `<tr>
        <td><b>${U.esc(c.name)}</b> ${i < 3 && st.total ? '<span title="Top cliente">⭐</span>' : ''}${c.notes ? `<div class="small muted">📌 ${U.esc(c.notes)}</div>` : ''}</td>
        <td class="nowrap">${U.esc(c.phone)}</td>
        <td class="small">${U.esc(c.address || '')}</td>
        <td class="right">${st.count}</td>
        <td class="right"><b>${U.money(st.total)}</b></td>
        <td class="small muted nowrap">${st.last ? U.date(st.last) : '-'}</td>
        <td class="actions">
          ${c.phone ? `<a class="btn sm ghost" href="https://wa.me/${U.phoneForWa(c.phone)}" target="_blank" rel="noopener" title="WhatsApp">💬</a>` : ''}
          <button class="btn sm ghost" data-h="${c.id}" title="Historial">📜</button>
          <button class="btn sm ghost" data-e="${c.id}" title="Editar">✏️</button>
        </td></tr>`).join('')}
    </tbody></table></div>`;
    box.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => edit(S.customer(b.dataset.e), () => draw(el)));
    box.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => history(S.customer(b.dataset.h)));
  }

  function edit(c, done) {
    const zones = S.data.settings.zones;
    const m = PZ.modal({
      title: c ? '✏️ Editar cliente' : '➕ Nuevo cliente',
      body: `
        <div class="grid-2">
          <label class="field"><span>Nombre</span><input name="name" value="${U.esc(c ? c.name : '')}" autofocus></label>
          <label class="field"><span>Teléfono</span><input name="phone" value="${U.esc(c ? c.phone : '')}" inputmode="tel"></label>
        </div>
        <label class="field"><span>Dirección</span><input name="address" value="${U.esc(c ? c.address : '')}"></label>
        <label class="field"><span>Zona</span><select name="zone"><option value="">—</option>${zones.map((z) => `<option value="${z.id}" ${c && c.zoneId === z.id ? 'selected' : ''}>${U.esc(z.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Notas (se muestran al tomar el pedido)</span><input name="notes" value="${U.esc(c ? c.notes : '')}" placeholder="Ej: timbre no anda, alérgico a…"></label>`,
      footer: `${c && PZ.auth.isAdmin() ? '<button class="btn danger" data-a="del">Eliminar</button><span class="grow"></span>' : ''}<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Guardar</button>`,
    });
    const E = m.el;
    const v = (n) => E.querySelector(`[name=${n}]`).value.trim();
    E.querySelector('[data-a=x]').onclick = () => m.close();
    const del = E.querySelector('[data-a=del]');
    if (del) del.onclick = async () => {
      if (!(await PZ.confirm(`¿Eliminar a ${U.esc(c.name)}? Sus ventas se conservan.`, { danger: true, ok: 'Eliminar' }))) return;
      S.data.customers = S.data.customers.filter((x) => x.id !== c.id);
      S.save(); m.close(); done();
    };
    E.querySelector('[data-a=ok]').onclick = () => {
      if (!v('name')) return PZ.toast('Falta el nombre', 'warn');
      if (c) Object.assign(c, { name: v('name'), phone: v('phone'), address: v('address'), zoneId: v('zone') || null, notes: v('notes') });
      else S.data.customers.push({ id: U.uid('cl-'), name: v('name'), phone: v('phone'), address: v('address'), zoneId: v('zone') || null, notes: v('notes'), createdAt: Date.now() });
      S.save(); m.close(); PZ.toast('Cliente guardado'); done();
    };
  }

  function history(c) {
    const st = S.customerStats(c.id);
    const os = S.data.orders.filter((o) => o.customerId === c.id).sort((a, b) => b.createdAt - a.createdAt);
    const m = PZ.modal({
      title: `📜 ${U.esc(c.name)}`,
      size: 'lg',
      body: `
        <div class="kpis mb">
          <div class="kpi"><div class="k-label">Pedidos</div><div class="k-value">${st.count}</div></div>
          <div class="kpi"><div class="k-label">Total gastado</div><div class="k-value">${U.money(st.total)}</div></div>
          <div class="kpi"><div class="k-label">Su favorita</div><div class="k-value" style="font-size:1.1em">${U.esc(st.fav || '-')}</div></div>
        </div>
        ${os.length ? `<div class="table-wrap"><table class="tbl"><tbody>${os.map((o) => `<tr class="${o.voided ? 'voided' : ''}"><td>${U.dateTime(o.createdAt)}</td><td>#${o.number}</td><td class="small">${o.items.map((i) => i.qty + 'x ' + U.esc(i.name)).join(', ')}</td><td class="right"><b>${U.money(o.total)}</b></td><td><button class="btn sm ghost" data-v="${o.id}">🧾</button><button class="btn sm ghost" data-r="${o.id}" title="Repetir pedido">🔁</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty small">Sin pedidos todavía</div>'}`,
    });
    m.el.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => PZ.ticket.preview(S.order(b.dataset.v)));
    m.el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => {
      const o = S.order(b.dataset.r);
      // Se rearma con los precios actuales del menú
      const items = o.items.map((i) => {
        const p = S.product(i.productId);
        const v = p && p.variants.find((x) => x.id === i.variantId);
        if (!p || !v) return { ...i, id: U.uid('it-') };
        const hp = i.half && S.product(i.half.productId);
        const half = hp ? { product: hp, variant: hp.variants.find((x) => x.id === v.id) || hp.variants[0] } : null;
        const extras = i.extras.map((e) => S.data.extras.find((x) => x.id === e.id) || e);
        return S.makeItem({ product: p, variant: v, half, extras, qty: i.qty, notes: i.notes });
      });
      PZ.setCart({
        type: o.type, items, customerId: c.id, customerName: c.name, phone: c.phone,
        address: c.address, zoneId: c.zoneId, deliveryFee: o.type === 'delivery' ? ((S.zone(c.zoneId) || {}).fee || o.deliveryFee || 0) : 0,
      });
      m.close();
      PZ.toast('Pedido cargado con los precios de hoy', 'info', 3000);
      location.hash = '#/vender';
    });
  }

  PZ.views.clientes = { title: 'Clientes', render };
})(window.PZ);
