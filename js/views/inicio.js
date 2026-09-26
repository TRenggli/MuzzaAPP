// @ts-check
/* ==========================================================================
   Vista: INICIO — resumen del día
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  }

  function render(el) {
    const L = PZ.labels;
    const C = PZ.charts;
    const u = PZ.auth.current;
    const start = U.startOfDay().getTime();
    const todays = S.data.orders.filter((o) => o.createdAt >= start && !o.voided);
    const paid = todays.filter((o) => o.paid);
    const sales = paid.reduce((a, o) => a + o.total, 0);
    const yStart = start - 864e5;
    const ySales = S.data.orders.filter((o) => o.paid && !o.voided && o.paidAt >= yStart && o.paidAt < start - (864e5 - (Date.now() - start))).reduce((a, o) => a + o.total, 0);
    const pizzas = paid.reduce((a, o) => a + o.items.filter((i) => { const p = S.product(i.productId); const c = p && S.category(p.categoryId); return c && c.allowHalf; }).reduce((x, i) => x + i.qty, 0), 0);
    const active = S.data.orders.filter((o) => !o.voided && !['entregado', 'cancelado'].includes(o.status));
    const unpaid = active.filter((o) => !o.paid);
    const low = S.lowStock();
    const sess = S.currentSession();

    // Ventas por hora (hoy)
    const hours = {};
    for (let h = 11; h <= 24; h++) hours[h] = 0;
    paid.forEach((o) => { const h = new Date(o.paidAt).getHours() || 24; hours[h] = (hours[h] || 0) + o.total; });
    // Top de hoy (o de los últimos 7 días si hoy no hay nada)
    const topSrc = paid.length ? paid : S.data.orders.filter((o) => o.paid && !o.voided && o.createdAt >= start - 7 * 864e5);
    const top = {};
    topSrc.forEach((o) => o.items.forEach((i) => { top[i.name] = (top[i.name] || 0) + i.qty; }));
    const topList = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));
    const vs = ySales && sales ? Math.round(((sales - ySales) / ySales) * 100) : null;

    el.innerHTML = `
      <div class="hero">
        <div class="hero-pizza">${PZ.brandLogo(240)}</div>
        <h1>${greeting()}, ${U.esc(u.name)} 🍕</h1>
        <p>${new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })} · 🏪 ${U.esc(S.branchName())} · ${sess ? 'caja abierta' : 'caja cerrada'}</p>
        <div class="row-flex">
          ${PZ.auth.can('vender') ? '<a class="btn lg" href="#/vender">🍕 Nueva venta</a>' : ''}
          <a class="btn ghost" href="#/pedidos">🔥 Ver pedidos (${active.length})</a>
          ${!sess && PZ.auth.can('caja') ? '<a class="btn ghost" href="#/caja">🔓 Abrir caja</a>' : ''}
        </div>
      </div>
      ${S.data.demo && PZ.auth.isAdmin() ? `<div class="alert-row mb">🎬 Estás viendo <b>datos de demostración</b>. Cuando empiecen a usarlo de verdad, borralos desde Configuración → Sistema.</div>` : ''}
      <div class="kpis">
        <div class="kpi"><span class="k-ico">💰</span><div class="k-label">Vendido hoy</div><div class="k-value">${U.money(sales)}</div><div class="k-sub">${vs === null ? '&nbsp;' : (vs >= 0 ? '▲ ' : '▼ ') + Math.abs(vs) + '% vs. ayer a esta hora'}</div></div>
        <div class="kpi"><span class="k-ico">🧾</span><div class="k-label">Tickets</div><div class="k-value">${paid.length}</div><div class="k-sub">Promedio ${U.money(paid.length ? sales / paid.length : 0)}</div></div>
        <div class="kpi"><span class="k-ico">🍕</span><div class="k-label">Pizzas vendidas</div><div class="k-value">${pizzas}</div><div class="k-sub">${todays.filter((o) => o.type === 'delivery').length} deliveries</div></div>
        <div class="kpi"><span class="k-ico">⏳</span><div class="k-label">Sin cobrar</div><div class="k-value">${U.money(unpaid.reduce((a, o) => a + o.total, 0))}</div><div class="k-sub">${unpaid.length} pedido(s)</div></div>
      </div>
      <div class="dash">
        <div class="card"><h3>⏰ Ventas por hora (hoy)</h3>
          ${paid.length ? C.bars(Object.entries(hours).map(([h, v]) => ({ label: (Number(h) % 24) + 'h', value: v }))) : '<div class="empty"><span class="e-ico">🍕</span>Todavía no hay ventas hoy. ¡Que empiece el servicio!</div>'}
        </div>
        <div class="card"><h3>🔔 Atención</h3>
          ${!sess ? '<div class="alert-row">💰 La caja está cerrada</div>' : ''}
          ${unpaid.length ? `<div class="alert-row">⏳ ${unpaid.length} pedido(s) sin cobrar</div>` : ''}
          ${active.filter((o) => U.minutesSince(o.createdAt) > (S.data.settings.prepMinutes || 35) && o.status !== 'en_camino').map((o) => `<div class="alert-row">🔥 Pedido #${o.number} lleva ${U.minutesSince(o.createdAt)} min</div>`).join('')}
          ${low.map((i) => `<div class="alert-row">📦 Queda poco: <b>${U.esc(i.name)}</b> (${U.num(i.stock)} ${i.unit})</div>`).join('')}
          ${sess || unpaid.length || low.length ? '' : '<div class="empty small"><span class="e-ico">😎</span>Todo en orden</div>'}
        </div>
      </div>
      <div class="dash">
        <div class="card"><h3>🏆 Lo más pedido ${paid.length ? 'hoy' : '(últimos 7 días)'}</h3>${C.hbars(topList, { suffix: ' u.' })}</div>
        <div class="card"><h3>💳 Cómo pagan hoy</h3>
          ${C.donut(Object.keys(L.method).map((k) => ({ label: L.method[k], value: paid.reduce((a, o) => a + o.payments.filter((p) => p.method === k).reduce((x, p) => x + p.amount, 0), 0), color: C.methodColors[k] })).filter((d) => d.value))}
        </div>
      </div>`;
  }

  PZ.views.inicio = { title: 'Inicio', live: true, render };
})(window.PZ);
