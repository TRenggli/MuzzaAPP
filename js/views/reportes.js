// @ts-check
/* ==========================================================================
   Vista: REPORTES — ventas, productos, horarios, medios de pago
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  let range = '7d';
  let custom = { from: '', to: '' };

  const bounds = () => U.rangeBounds(range, custom);
  let reqId = 0;

  /** Trae las ventas del período (y del anterior, para comparar) y dibuja */
  async function render(el) {
    const my = ++reqId;
    const [from, to] = bounds();
    if (from - (to - from) < S.localSince() && navigator.onLine) el.innerHTML = '<div class="card empty"><span class="e-ico">☁️</span>Trayendo ventas anteriores de la nube…</div>';
    let all;
    try { all = await S.ordersInRange(from - (to - from) - 864e5, to); } catch (e) { el.innerHTML = `<div class="card empty">No se pudieron traer las ventas: ${U.esc(e.message)}</div>`; return; }
    if (my !== reqId || !el.isConnected) return;
    draw(el, all);
  }

  function draw(el, all) {
    const L = PZ.labels;
    const C = PZ.charts;
    const [from, to] = bounds();
    const inRange = all.filter((o) => o.paid && o.paidAt >= from && o.paidAt <= to);
    const orders = inRange.filter((o) => !o.voided);
    const voided = inRange.filter((o) => o.voided);
    const sales = orders.reduce((a, o) => a + o.total, 0);
    const len = to - from;
    const prev = all.filter((o) => o.paid && !o.voided && o.paidAt >= from - len && o.paidAt < from).reduce((a, o) => a + o.total, 0);
    const delta = prev ? Math.round(((sales - prev) / prev) * 100) : null;

    // Por día
    const days = {};
    for (let d = U.startOfDay(from).getTime(); d <= to; d += 864e5) days[U.dayKey(d)] = 0;
    orders.forEach((o) => { const k = U.dayKey(o.paidAt); days[k] = (days[k] || 0) + o.total; });
    const dayData = Object.entries(days).map(([k, v]) => ({ label: k.slice(8) + '/' + k.slice(5, 7), value: v }));
    // Por hora
    const hours = Array.from({ length: 24 }, () => 0);
    orders.forEach((o) => { hours[new Date(o.paidAt).getHours()] += o.total; });
    const firstH = Math.max(0, hours.findIndex((v) => v > 0));
    const lastH = 23 - Math.max(0, hours.slice().reverse().findIndex((v) => v > 0));
    const hourData = hours.slice(firstH, lastH + 1).map((v, i) => ({ label: firstH + i + 'h', value: v }));
    // Día de semana
    const wd = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const wdSum = Array(7).fill(0);
    orders.forEach((o) => { wdSum[new Date(o.paidAt).getDay()] += o.total; });
    // Productos
    const prod = {};
    orders.forEach((o) => o.items.forEach((i) => {
      const k = i.half ? '½ y ½ (combinadas)' : i.name + (i.variantName ? ' ' + i.variantName : '');
      prod[k] = prod[k] || { qty: 0, rev: 0 };
      prod[k].qty += i.qty;
      prod[k].rev += i.unitPrice * i.qty;
    }));
    const prodList = Object.entries(prod).sort((a, b) => b[1].rev - a[1].rev);
    // Gustos (contando mitades)
    const flavors = {};
    orders.forEach((o) => o.items.forEach((i) => {
      const p = S.product(i.productId);
      const c = p && S.category(p.categoryId);
      if (!c || !c.allowHalf) return;
      const a = p.name;
      flavors[a] = (flavors[a] || 0) + (i.half ? 0.5 : 1) * i.qty;
      if (i.half) flavors[i.half.name] = (flavors[i.half.name] || 0) + 0.5 * i.qty;
    }));
    const byMethod = {};
    orders.forEach((o) => o.payments.forEach((p) => { byMethod[p.method] = (byMethod[p.method] || 0) + p.amount; }));
    const byType = {};
    orders.forEach((o) => { byType[o.type] = (byType[o.type] || 0) + o.total; });
    const typeColors = { mostrador: '#f4a261', delivery: '#e63946', retiro: '#2a9d8f', mesa: '#6c8ebf' };
    const drivers = {};
    orders.filter((o) => o.type === 'delivery' && o.driver).forEach((o) => { drivers[o.driver] = (drivers[o.driver] || 0) + 1; });
    const cust = {};
    orders.filter((o) => o.customerId).forEach((o) => { cust[o.customerId] = (cust[o.customerId] || 0) + o.total; });

    el.innerHTML = `
      <div class="row-flex space-between mb">
        <div class="seg">${[['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7d', '7 días'], ['30d', '30 días'], ['mes', 'Este mes'], ['mesant', 'Mes pasado'], ['custom', 'Elegir…']].map(([k, l]) => `<button data-r="${k}" class="${range === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <button class="btn ghost sm" data-a="csv">⬇️ Exportar productos (CSV)</button>
      </div>
      ${range === 'custom' ? `<div class="row-flex mb"><input type="date" data-c="from" value="${custom.from}" style="max-width:200px"> a <input type="date" data-c="to" value="${custom.to}" style="max-width:200px"></div>` : ''}
      <div class="kpis">
        <div class="kpi"><span class="k-ico">💰</span><div class="k-label">Ventas</div><div class="k-value">${U.money(sales)}</div><div class="k-sub">${delta === null ? 'Sin período anterior' : (delta >= 0 ? '▲ ' : '▼ ') + Math.abs(delta) + '% vs. período anterior'}</div></div>
        <div class="kpi"><span class="k-ico">🧾</span><div class="k-label">Tickets</div><div class="k-value">${orders.length}</div><div class="k-sub">Promedio ${U.money(orders.length ? sales / orders.length : 0)}</div></div>
        <div class="kpi"><span class="k-ico">🍕</span><div class="k-label">Pizzas</div><div class="k-value">${U.num(Object.values(flavors).reduce((a, b) => a + b, 0))}</div><div class="k-sub">${orders.filter((o) => o.type === 'delivery').length} envíos · ${U.money(orders.reduce((a, o) => a + (o.deliveryFee || 0), 0))}</div></div>
        <div class="kpi"><span class="k-ico">🏷️</span><div class="k-label">Descuentos / anulados</div><div class="k-value">${U.money(orders.reduce((a, o) => a + (o.discountAmount || 0) + (o.cashDiscount || 0), 0))}</div><div class="k-sub">${voided.length} anulados (${U.money(voided.reduce((a, o) => a + o.total, 0))})</div></div>
      </div>
      <div class="card mt"><h3>📅 Ventas por día</h3>${dayData.length > 1 ? C.bars(dayData) : '<div class="empty small">Elegí un rango de varios días para ver la evolución</div>'}</div>
      <div class="dash">
        <div class="card"><h3>⏰ ¿A qué hora se vende más?</h3>${orders.length ? C.bars(hourData) : '<div class="empty small">Sin ventas</div>'}</div>
        <div class="card"><h3>📆 Por día de la semana</h3>${C.hbars(wd.map((l, i) => ({ label: l, value: wdSum[i] })), { money: true })}</div>
      </div>
      <div class="dash">
        <div class="card"><h3>🏆 Productos que más facturan</h3>${C.hbars(prodList.slice(0, 10).map(([label, v]) => ({ label: `${label} (${v.qty})`, value: v.rev })), { money: true })}</div>
        <div class="card"><h3>🍕 Gustos favoritos</h3>${C.hbars(Object.entries(flavors).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value })), { suffix: ' u.' })}</div>
      </div>
      <div class="dash">
        <div class="card"><h3>💳 Medios de pago</h3>${C.donut(Object.keys(L.method).map((k) => ({ label: L.method[k], value: byMethod[k] || 0, color: C.methodColors[k] })).filter((d) => d.value))}</div>
        <div class="card"><h3>🛵 Tipo de pedido</h3>${C.donut(Object.keys(L.type).map((k) => ({ label: L.type[k], value: byType[k] || 0, color: typeColors[k] })).filter((d) => d.value))}</div>
      </div>
      <div class="dash">
        <div class="card"><h3>⭐ Mejores clientes</h3>${C.hbars(Object.entries(cust).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, value]) => ({ label: (S.customer(id) || {}).name || 'Cliente', value })), { money: true })}</div>
        <div class="card"><h3>🛵 Envíos por repartidor</h3>${C.hbars(Object.entries(drivers).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })), { suffix: ' envíos' })}</div>
      </div>`;

    el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { range = b.dataset.r; render(el); });
    el.querySelectorAll('[data-c]').forEach((i) => i.onchange = () => { custom[i.dataset.c] = i.value; render(el); });
    el.querySelector('[data-a=csv]').onclick = () => {
      const rows = [['Producto', 'Cantidad', 'Facturado']].concat(prodList.map(([k, v]) => [k, v.qty, v.rev]));
      const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
      U.download(`productos_${U.dayKey(from)}_a_${U.dayKey(to)}.csv`, csv, 'text/csv;charset=utf-8');
    };
  }

  PZ.views.reportes = { title: 'Reportes', render };
})(window.PZ);
