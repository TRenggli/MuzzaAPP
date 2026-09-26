// @ts-check
/* ==========================================================================
   Vista: VENTAS — historial, reimpresión, anulaciones y exportación
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  const f = { from: '', to: '', method: '', type: '', q: '', state: '' };
  let source = [];   // ventas del período (del equipo o traídas de la nube)
  let reqId = 0;

  const period = () => [
    f.from ? new Date(f.from + 'T00:00').getTime() : U.startOfDay().getTime() - 6 * 864e5,
    f.to ? new Date(f.to + 'T23:59:59').getTime() : Date.now() + 864e5,
  ];

  function filtered() {
    const q = U.stripAccents(f.q.toLowerCase().trim());
    return source.filter((o) => {
      if (f.type && o.type !== f.type) return false;
      if (f.method && !(o.payments || []).some((p) => p.method === f.method)) return false;
      if (f.state === 'paid' && (!o.paid || o.voided)) return false;
      if (f.state === 'unpaid' && (o.paid || o.voided)) return false;
      if (f.state === 'void' && !o.voided) return false;
      if (q) {
        const hay = U.stripAccents(`${o.number} ${o.ticketNumber || ''} ${o.customerName} ${o.phone} ${o.items.map((i) => i.name).join(' ')}`.toLowerCase());
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => b.createdAt - a.createdAt);
  }

  function render(el) {
    const L = PZ.labels;
    if (!f.from) f.from = U.dayKey(Date.now() - 6 * 864e5);
    if (!f.to) f.to = U.dayKey(Date.now());
    el.innerHTML = `
      <div class="card mb">
        <div class="grid-3">
          <label class="field"><span>Desde</span><input type="date" data-f="from" value="${f.from}"></label>
          <label class="field"><span>Hasta</span><input type="date" data-f="to" value="${f.to}"></label>
          <label class="field"><span>Buscar</span><input type="search" data-f="q" value="${U.esc(f.q)}" placeholder="Nº, cliente, producto…"></label>
          <label class="field"><span>Medio de pago</span><select data-f="method"><option value="">Todos</option>${Object.keys(L.method).map((k) => `<option value="${k}" ${f.method === k ? 'selected' : ''}>${L.method[k]}</option>`).join('')}</select></label>
          <label class="field"><span>Tipo</span><select data-f="type"><option value="">Todos</option>${Object.keys(L.type).map((k) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${L.type[k]}</option>`).join('')}</select></label>
          <label class="field"><span>Estado</span><select data-f="state"><option value="">Todos</option><option value="paid" ${f.state === 'paid' ? 'selected' : ''}>Cobrados</option><option value="unpaid" ${f.state === 'unpaid' ? 'selected' : ''}>Sin cobrar</option><option value="void" ${f.state === 'void' ? 'selected' : ''}>Anulados</option></select></label>
        </div>
        <div class="row-flex space-between"><div class="summary"></div><button class="btn ghost sm" data-a="csv">⬇️ Exportar Excel (CSV)</button></div>
      </div>
      <div class="card"><div class="list"></div></div>`;
    el.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener(inp.type === 'search' ? 'input' : 'change', U.debounce(() => {
      f[inp.dataset.f] = inp.value;
      if (inp.dataset.f === 'from' || inp.dataset.f === 'to') load(el); else drawList(el);
    }, 200)));
    el.querySelector('[data-a=csv]').onclick = () => exportCsv();
    load(el);
  }

  async function load(el) {
    const my = ++reqId;
    const [from, to] = period();
    const box = el.querySelector('.list');
    if (from < S.localSince() && navigator.onLine) box.innerHTML = '<div class="empty"><span class="e-ico">☁️</span>Buscando ventas anteriores en la nube…</div>';
    try { source = await S.ordersInRange(from, to); } catch (e) { box.innerHTML = `<div class="empty">No se pudieron traer las ventas: ${U.esc(e.message)}</div>`; return; }
    if (my !== reqId || !el.isConnected) return;
    drawList(el);
  }

  function drawList(el) {
    const L = PZ.labels;
    const list = filtered();
    const valid = list.filter((o) => o.paid && !o.voided);
    el.querySelector('.summary').innerHTML = `<b>${list.length}</b> pedidos · cobrado <b>${U.money(valid.reduce((a, o) => a + o.total, 0))}</b>`;
    const box = el.querySelector('.list');
    if (!list.length) { box.innerHTML = '<div class="empty"><span class="e-ico">🧾</span>No hay ventas con esos filtros</div>'; return; }
    box.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Pedido</th><th>Comprobante</th><th>Cliente / tipo</th><th>Pago</th><th class="right">Total</th><th></th></tr></thead><tbody>
      ${list.slice(0, 400).map((o) => `<tr class="${o.voided ? 'voided' : ''}">
        <td class="nowrap">${U.date(o.createdAt)} <span class="muted small">${U.time(o.createdAt)}</span></td>
        <td>#${o.number}</td>
        <td class="nowrap small">${o.ticketNumber ? PZ.ticket.ticketId(o) : '<span class="badge warn">Sin cobrar</span>'}</td>
        <td>${L.typeIcon[o.type]} ${U.esc(o.customerName || L.type[o.type])}</td>
        <td>${o.voided ? '<span class="badge err">Anulado</span>' : (o.payments || []).map((p) => `<span class="badge">${L.methodIcon[p.method]} ${L.method[p.method].split(' ')[0]}</span>`).join(' ')}</td>
        <td class="right"><b>${U.money(o.total)}</b></td>
        <td class="actions"><button class="btn sm ghost" data-v="${o.id}" title="Ver / reimprimir">🧾</button>${!o.voided ? `<button class="btn sm ghost" data-x="${o.id}" title="Anular">🚫</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>${list.length > 400 ? '<p class="small muted center">Mostrando los primeros 400. Acotá las fechas para ver más.</p>' : ''}`;
    box.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => PZ.ticket.preview(list.find((x) => x.id === b.dataset.v)));
    box.querySelectorAll('[data-x]').forEach((b) => b.onclick = async () => {
      const o = list.find((x) => x.id === b.dataset.x);
      if (await PZ.voidFlow(o, 'Anular')) drawList(el);
    });
  }

  function exportCsv() {
    const L = PZ.labels;
    const rows = [['Fecha', 'Hora', 'Pedido', 'Comprobante', 'Tipo', 'Cliente', 'Telefono', 'Items', 'Subtotal', 'Descuento', 'Envio', 'Total', 'Medio de pago', 'Estado']];
    filtered().forEach((o) => rows.push([
      U.date(o.createdAt), U.time(o.createdAt), o.number, o.ticketNumber ? PZ.ticket.ticketId(o) : '', L.type[o.type], o.customerName, o.phone,
      o.items.map((i) => `${i.qty}x ${i.name}${i.variantName ? ' ' + i.variantName : ''}`).join(' | '),
      o.subtotal, (o.discountAmount || 0) + (o.cashDiscount || 0), o.deliveryFee || 0, o.total,
      (o.payments || []).map((p) => L.method[p.method]).join(' + '), o.voided ? 'Anulado' : o.paid ? 'Cobrado' : 'Sin cobrar',
    ]));
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    U.download(`ventas_${f.from}_a_${f.to}.csv`, csv, 'text/csv;charset=utf-8');
  }

  PZ.views.historial = { title: 'Historial de ventas', render };
})(window.PZ);
