// @ts-check
/* ==========================================================================
   Vista: STOCK — insumos, alertas de faltantes y lista de compras
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;

  function render(el) {
    const ings = S.data.ingredients;
    const low = S.lowStock();
    const value = ings.reduce((a, i) => a + Math.max(0, i.stock) * (i.cost || 0), 0);
    el.innerHTML = `
      <div class="kpis mb">
        <div class="kpi"><span class="k-ico">📦</span><div class="k-label">Insumos</div><div class="k-value">${ings.length}</div></div>
        <div class="kpi"><span class="k-ico">⚠️</span><div class="k-label">Por reponer</div><div class="k-value" style="color:${low.length ? 'var(--err)' : 'var(--ok)'}">${low.length}</div></div>
        <div class="kpi"><span class="k-ico">💲</span><div class="k-label">Valor del stock</div><div class="k-value">${U.money(value)}</div></div>
      </div>
      <div class="row-flex mb">
        ${PZ.auth.isAdmin() ? '<button class="btn primary" data-a="new">➕ Nuevo insumo</button>' : ''}
        <button class="btn accent" data-a="shop" ${low.length ? '' : 'disabled'}>🛒 Lista de compras (${low.length})</button>
      </div>
      <div class="card">
        ${ings.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Insumo</th><th class="right">Stock</th><th class="right">Mínimo</th><th>Estado</th><th></th></tr></thead><tbody>
          ${ings.map((i) => {
            const pct = i.min ? Math.min(100, (i.stock / (i.min * 3)) * 100) : 100;
            const st = i.stock <= 0 ? ['err', 'Sin stock'] : i.stock <= i.min ? ['warn', 'Reponer'] : ['ok', 'OK'];
            return `<tr><td><b>${U.esc(i.name)}</b>${i.cost ? `<div class="small muted">${U.money(i.cost)} / ${i.unit}</div>` : ''}
              <div class="hb-track" style="background:var(--bg-2);height:6px;border-radius:9px;margin-top:4px;max-width:180px"><div style="height:100%;width:${Math.max(0, pct)}%;border-radius:9px;background:var(--${st[0] === 'ok' ? 'ok' : st[0]})"></div></div></td>
              <td class="right nowrap"><b>${U.num(i.stock)}</b> ${i.unit}</td><td class="right nowrap">${U.num(i.min)} ${i.unit}</td>
              <td><span class="badge ${st[0]}">${st[1]}</span></td>
              <td class="actions"><button class="btn sm ok" data-in="${i.id}">＋ Entrada</button> <button class="btn sm ghost" data-out="${i.id}">− Ajuste</button>${PZ.auth.isAdmin() ? ` <button class="btn sm ghost" data-e="${i.id}">✏️</button>` : ''}</td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="empty">Sin insumos cargados</div>'}
      </div>
      <div class="card mt"><h3>🕘 Últimos movimientos</h3>
        ${S.data.stockMoves.length ? S.data.stockMoves.slice(0, 15).map((m) => { const i = ings.find((x) => x.id === m.ingredientId); return `<div class="list-row"><span>${m.delta > 0 ? '⬆️' : '⬇️'}</span><div class="grow"><b>${U.esc(i ? i.name : '?')}</b> <span class="muted small">${U.esc(m.reason || '')}</span></div><span class="small muted">${U.dateTime(m.at)}</span><b>${m.delta > 0 ? '+' : ''}${U.num(m.delta)} ${i ? i.unit : ''}</b></div>`; }).join('') : '<div class="empty small">Sin movimientos manuales</div>'}
      </div>
      <p class="small muted">💡 El stock baja solo al vender si el producto tiene receta (Menú → editar producto).</p>`;

    const on = (a, fn) => { const b = el.querySelector(`[data-a=${a}]`); if (b) b.onclick = fn; };
    on('new', () => edit(null, () => render(el)));
    on('shop', () => shopping());
    el.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => edit(ings.find((i) => i.id === b.dataset.e), () => render(el)));
    el.querySelectorAll('[data-in]').forEach((b) => b.onclick = () => move(b.dataset.in, 1, () => render(el)));
    el.querySelectorAll('[data-out]').forEach((b) => b.onclick = () => move(b.dataset.out, -1, () => render(el)));
  }

  function move(id, sign, done) {
    const i = S.data.ingredients.find((x) => x.id === id);
    const m = PZ.modal({
      title: `${sign > 0 ? '⬆️ Entrada' : '⬇️ Ajuste / merma'} · ${U.esc(i.name)}`,
      size: 'sm',
      body: `<label class="field"><span>Cantidad (${i.unit})</span><input class="q" inputmode="decimal" autofocus></label>
             <label class="field"><span>Motivo</span><input class="r" value="${sign > 0 ? 'Compra' : 'Merma'}"></label>`,
      footer: `<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Guardar</button>`,
    });
    m.el.querySelector('[data-a=x]').onclick = () => m.close();
    m.el.querySelector('[data-a=ok]').onclick = () => {
      const q = Number(m.el.querySelector('.q').value.replace(',', '.'));
      if (!q) return;
      S.stockMove(id, sign * Math.abs(q), m.el.querySelector('.r').value.trim());
      m.close(); done();
    };
  }

  function edit(i, done) {
    const m = PZ.modal({
      title: i ? '✏️ ' + U.esc(i.name) : '➕ Nuevo insumo',
      body: `
        <label class="field"><span>Nombre</span><input name="name" value="${U.esc(i ? i.name : '')}" autofocus></label>
        <div class="grid-3">
          <label class="field"><span>Unidad</span><select name="unit">${['kg', 'lt', 'u', 'g', 'ml'].map((u) => `<option ${i && i.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
          <label class="field"><span>Stock actual</span><input name="stock" inputmode="decimal" value="${i ? i.stock : 0}"></label>
          <label class="field"><span>Mínimo (alerta)</span><input name="min" inputmode="decimal" value="${i ? i.min : 0}"></label>
        </div>
        <label class="field"><span>Costo por unidad</span><input name="cost" inputmode="numeric" value="${i ? i.cost || 0 : 0}"></label>`,
      footer: `${i ? '<button class="btn danger" data-a="del">Eliminar</button><span class="grow"></span>' : ''}<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Guardar</button>`,
    });
    const v = (n) => m.el.querySelector(`[name=${n}]`).value;
    const num = (n) => Number(String(v(n)).replace(',', '.')) || 0;
    m.el.querySelector('[data-a=x]').onclick = () => m.close();
    const del = m.el.querySelector('[data-a=del]');
    if (del) del.onclick = async () => {
      if (!(await PZ.confirm('¿Eliminar este insumo? Se quita de las recetas.', { danger: true }))) return;
      S.data.ingredients = S.data.ingredients.filter((x) => x.id !== i.id);
      S.data.products.forEach((p) => { p.recipe = (p.recipe || []).filter((r) => r.ingredientId !== i.id); });
      S.save(); m.close(); done();
    };
    m.el.querySelector('[data-a=ok]').onclick = () => {
      const data = { name: v('name').trim(), unit: v('unit'), stock: num('stock'), min: num('min'), cost: U.parseMoney(v('cost')) };
      if (!data.name) return PZ.toast('Falta el nombre', 'warn');
      if (i) Object.assign(i, data);
      else S.data.ingredients.push({ id: U.uid('i-'), ...data });
      S.save(); m.close(); done();
    };
  }

  function shopping() {
    const low = S.lowStock();
    const lines = low.map((i) => `• ${i.name}: comprar ~${U.num(Math.max(i.min * 3 - i.stock, i.min))} ${i.unit} (quedan ${U.num(i.stock)})`);
    const text = `🛒 Lista de compras · ${S.data.settings.business.name}\n${U.date(Date.now())}\n\n${lines.join('\n')}`;
    const m = PZ.modal({
      title: '🛒 Lista de compras',
      body: `<pre style="white-space:pre-wrap;font-family:inherit;background:var(--bg-2);padding:14px;border-radius:14px;margin:0">${U.esc(text)}</pre>`,
      footer: `<button class="btn ghost" data-a="cp">📋 Copiar</button><button class="btn primary" data-a="wa">💬 Enviar por WhatsApp</button>`,
    });
    m.el.querySelector('[data-a=cp]').onclick = async () => { try { await navigator.clipboard.writeText(text); PZ.toast('Copiada'); } catch (e) { PZ.toast('No se pudo copiar', 'warn'); } };
    m.el.querySelector('[data-a=wa]').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  PZ.views.stock = { title: 'Stock de insumos', render };
})(window.PZ);
