// @ts-check
/* ==========================================================================
   Vista: GASTOS Y GANANCIAS de la sucursal
   Los gastos se cargan acá o salen solos de la caja (retiros con categoría).
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  const CAT_ICON = { Mercadería: '🧀', Sueldos: '🧑‍🍳', Alquiler: '🏠', Servicios: '💡', Impuestos: '🏛️', Delivery: '🛵', Mantenimiento: '🔧', Publicidad: '📣', Comisiones: '💳', Otros: '📦' };
  const CAT_COLORS = { Mercadería: '#e9a23b', Sueldos: '#6c8ebf', Alquiler: '#8e44ad', Servicios: '#2a9d8f', Impuestos: '#d7263d', Delivery: '#ff6b35', Mantenimiento: '#52b788', Publicidad: '#f4a261', Comisiones: '#1d7bd7', Otros: '#999' };
  /** @type {string | null} 'YYYY-MM' */
  let month = null;
  let cat = '';
  const reports = new Map();

  function monthBounds(m) {
    const [y, mo] = m.split('-').map(Number);
    const from = new Date(y, mo - 1, 1).getTime();
    const to = new Date(y, mo, 1).getTime() - 1;
    return [from, Math.min(to, Date.now())];
  }

  function render(el) {
    if (!month) { const d = new Date(); month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
    const [from, to] = monthBounds(month);
    const key = `${from}:${to}`;
    const p = reports.get(key) || S.profit(from, to);
    if (!reports.has(key) && from < S.localSince() && navigator.onLine) {
      S.profitInRange(from, to).then((report) => { reports.set(key, report); render(el); }).catch(() => {});
    }
    const L = PZ.labels;
    const list = p.exps.filter((e) => !cat || e.category === cat);
    const months = [];
    for (let i = 0; i < 12; i++) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    const monthLabel = (m) => new Date(m + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

    el.innerHTML = `
      <div class="row-flex space-between mb">
        <select class="month" style="max-width:220px">${months.map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
        <button class="btn primary" data-a="new">➕ Cargar gasto</button>
      </div>
      <div class="kpis">
        <div class="kpi"><span class="k-ico">💰</span><div class="k-label">Ventas</div><div class="k-value">${U.money(p.sales)}</div><div class="k-sub">${p.orders.length} tickets</div></div>
        <div class="kpi"><span class="k-ico">💸</span><div class="k-label">Gastos</div><div class="k-value">${U.money(p.expenses)}</div><div class="k-sub">${p.exps.length} movimiento(s)</div></div>
        <div class="kpi"><span class="k-ico">${p.result >= 0 ? '📈' : '📉'}</span><div class="k-label">Ganancia</div><div class="k-value" style="color:${p.result >= 0 ? 'var(--ok)' : 'var(--err)'}">${U.money(p.result)}</div><div class="k-sub">Margen ${p.sales ? Math.round(p.margin * 100) + '%' : '—'}</div></div>
        <div class="kpi"><span class="k-ico">🧀</span><div class="k-label">Costo de lo vendido</div><div class="k-value">${U.money(p.cogs)}</div><div class="k-sub">Food cost ${p.sales ? Math.round((p.cogs / p.sales) * 100) + '%' : '—'} (según recetas)</div></div>
      </div>
      <div class="dash">
        <div class="card"><h3>🧾 Gastos del mes</h3>
          <div class="seg mb"><button data-c="" class="${!cat ? 'on' : ''}">Todos</button>${Object.keys(p.byCat).map((c) => `<button data-c="${U.esc(c)}" class="${cat === c ? 'on' : ''}">${CAT_ICON[c] || '📦'} ${U.esc(c)}</button>`).join('')}</div>
          ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Categoría</th><th>Detalle</th><th>Pago</th><th class="right">Monto</th><th></th></tr></thead><tbody>
            ${list.map((e) => `<tr><td class="nowrap">${U.date(e.at)}</td><td>${CAT_ICON[e.category] || '📦'} ${U.esc(e.category)}</td>
              <td>${U.esc(e.description || '')}${e.supplier ? `<div class="small muted">${U.esc(e.supplier)}</div>` : ''}${e.employeeId ? `<div class="small muted">👤 ${U.esc((S.user(e.employeeId) || {}).name || '')}</div>` : ''}${e.source === 'caja' ? ' <span class="badge">desde caja</span>' : ''}</td>
              <td class="small">${L.method[e.method] || e.method}</td><td class="right"><b>${U.money(e.amount)}</b></td>
              <td class="actions">${e.source !== 'caja' ? `<button class="btn sm ghost" data-e="${e.id}">✏️</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty small"><span class="e-ico">🧾</span>Sin gastos cargados en este mes</div>'}
        </div>
        <div class="card"><h3>📊 ¿En qué se va la plata?</h3>
          ${PZ.charts.donut(Object.entries(p.byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, color: CAT_COLORS[k] || '#999' })))}
          <div class="bank-box mt">
            <div class="bk-row"><span>Ventas</span><b>${U.money(p.sales)}</b></div>
            ${Object.entries(p.byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="bk-row"><span>− ${U.esc(k)}</span><span>${U.money(v)}</span></div>`).join('')}
            <div class="bk-row" style="border-top:2px dashed var(--line);padding-top:6px"><span><b>Ganancia</b></span><b style="color:${p.result >= 0 ? 'var(--ok)' : 'var(--err)'}">${U.money(p.result)}</b></div>
          </div>
        </div>
      </div>
      ${from < S.localSince() && !p.complete ? '<p class="small warn">⌛ Actualizando las ventas históricas del servidor. Sin conexión, este período puede estar incompleto.</p>' : ''}
      <p class="small muted">💡 Los retiros de caja con categoría (por ejemplo “pago a proveedor”) se suman solos. Cargá acá lo que se paga por transferencia: alquiler, sueldos, servicios, impuestos.</p>`;

    el.querySelector('.month').onchange = (e) => { month = e.target.value; cat = ''; render(el); };
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cat = b.dataset.c; render(el); });
    el.querySelector('[data-a=new]').onclick = () => edit(null, () => render(el));
    el.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => edit(S.data.expenses.find((x) => x.id === b.dataset.e), () => render(el)));
  }

  function edit(x, done) {
    const L = PZ.labels;
    const people = S.ctx.members.filter((m) => m.active && (m.role === 'owner' || !(m.branch_ids || []).length || m.branch_ids.includes(S.ctx.branchId)));
    const d = new Date(x ? x.at : Date.now());
    const dateVal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const m = PZ.modal({
      title: x ? '✏️ Editar gasto' : '➕ Cargar gasto',
      body: `
        <div class="opt-grid mb cats">${S.EXPENSE_CATEGORIES.map((c) => `<button class="opt ${(x ? x.category : 'Mercadería') === c ? 'on' : ''}" data-cat="${c}">${CAT_ICON[c]} ${c}</button>`).join('')}</div>
        <div class="grid-2">
          <label class="field"><span>Monto</span><input name="amount" inputmode="numeric" value="${x ? x.amount : ''}" autofocus></label>
          <label class="field"><span>Fecha</span><input name="date" type="date" value="${dateVal}"></label>
        </div>
        <label class="field"><span>Detalle</span><input name="desc" value="${U.esc(x ? x.description : '')}" placeholder="Ej: 20 kg de muzzarella"></label>
        <div class="grid-2">
          <label class="field"><span>Proveedor (opcional)</span><input name="supplier" value="${U.esc(x ? x.supplier : '')}"></label>
          <label class="field"><span>Cómo se pagó</span><select name="method">${Object.keys(L.method).map((k) => `<option value="${k}" ${x && x.method === k ? 'selected' : !x && k === 'transferencia' ? 'selected' : ''}>${L.method[k]}</option>`).join('')}</select></label>
        </div>
        <label class="field emp ${(x ? x.category : 'Mercadería') === 'Sueldos' ? '' : 'hidden'}"><span>¿A quién?</span><select name="emp"><option value="">—</option>${people.map((p) => `<option value="${p.user_id}" ${x && x.employeeId === p.user_id ? 'selected' : ''}>${U.esc(p.name)}</option>`).join('')}</select></label>
        <p class="small muted">Si lo pagaste en efectivo con plata de la caja, mejor registralo como <b>retiro</b> en Caja: así también cuadra el arqueo.</p>`,
      footer: `${x ? '<button class="btn danger" data-a="del">Borrar</button><span class="grow"></span>' : ''}<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Guardar</button>`,
    });
    const E = m.el;
    let category = x ? x.category : 'Mercadería';
    E.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => {
      category = b.dataset.cat;
      E.querySelectorAll('[data-cat]').forEach((o) => o.classList.toggle('on', o === b));
      E.querySelector('.emp').classList.toggle('hidden', category !== 'Sueldos');
    });
    const v = (n) => E.querySelector(`[name=${n}]`).value;
    E.querySelector('[data-a=x]').onclick = () => m.close();
    const del = E.querySelector('[data-a=del]');
    if (del) del.onclick = async () => {
      if (!(await PZ.confirm('¿Borrar este gasto?', { danger: true, ok: 'Borrar' }))) return;
      S.data.expenses = S.data.expenses.filter((e) => e.id !== x.id);
      S.save(); m.close(); done();
    };
    E.querySelector('[data-a=ok]').onclick = () => {
      const amount = U.parseMoney(v('amount'));
      if (!amount) return PZ.toast('Poné el monto', 'warn');
      const at = new Date(v('date') + 'T12:00').getTime() || Date.now();
      const data = { category, amount, at, description: v('desc').trim(), supplier: v('supplier').trim(), method: v('method'), employeeId: category === 'Sueldos' ? v('emp') : '' };
      if (x) Object.assign(x, data);
      else S.addExpense(data);
      S.data.expenses.sort((a, b) => b.at - a.at);
      S.log('gastos', `${x ? 'Edición' : 'Carga'} de gasto: ${category} ${U.money(amount)}`);
      S.save();
      m.close();
      PZ.toast('Gasto guardado');
      done();
    };
  }

  PZ.views.gastos = { title: 'Gastos y ganancias', render };
})(window.PZ);
