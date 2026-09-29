// @ts-check
/* ==========================================================================
   Panel del NEGOCIO (dueño): resumen en vivo, sucursales, finanzas,
   menú modelo y datos del negocio. Nada de esto opera la caja: para eso el
   dueño "entra a operar" en una sucursal sin cerrar sesión.
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  const C = () => PZ.cloud;
  const PALETTE = ['#d7263d', '#2a9d8f', '#e9a23b', '#6c8ebf', '#8e44ad', '#52b788', '#ff6b35', '#1d3557'];
  const RANGES = [['hoy', 'Hoy'], ['7d', '7 días'], ['30d', '30 días'], ['mes', 'Este mes'], ['mesant', 'Mes pasado']];
  let range = '7d';
  let reqId = 0;

  const bounds = () => U.rangeBounds(range);
  const rangeSeg = () => `<div class="seg">${RANGES.map(([k, l]) => `<button data-range="${k}" class="${range === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const bindRange = (el, rerender) => el.querySelectorAll('[data-range]').forEach((b) => b.onclick = () => { range = b.dataset.range; rerender(); });
  const branches = () => S.ctx.branches.slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  const colorOf = (id) => PALETTE[Math.max(0, S.ctx.branches.findIndex((b) => b.id === id)) % PALETTE.length];
  const addr = (b) => (b.settings && b.settings.business && b.settings.business.address) || '';
  const pct = (x) => (isFinite(x) ? Math.round(x * 100) + '%' : '—');
  const offlineCard = '<div class="card empty"><span class="e-ico">📴</span>El panel del negocio necesita conexión a internet.</div>';
  const loadingCard = (msg) => `<div class="card empty"><span class="e-ico">🍕</span>${msg}</div>`;
  const errorCard = (e) => `<div class="card empty"><span class="e-ico">🔥</span>No se pudo cargar: ${U.esc(e.message || e)}</div>`;

  /* =====================================================================
     RESUMEN
     ===================================================================== */
  function resumen(el) {
    const org = S.ctx.org || {};
    el.innerHTML = `
      <div class="hero">
        <div class="hero-pizza">${PZ.brandLogo(240)}</div>
        <h1>${U.esc(org.name || 'Tu negocio')}</h1>
        <p>${S.ctx.branches.filter((b) => b.active).length} sucursal(es) · ${new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <div class="row-flex"><button class="btn lg" data-a="operate">🍕 Operar en una sucursal</button><a class="btn ghost" href="#/n-finanzas">💹 Ver ganancias</a></div>
      </div>
      <div class="row-flex space-between mb">${rangeSeg()}<span class="muted small">Se actualiza solo cuando hay ventas nuevas</span></div>
      <div class="r-body">${loadingCard('Juntando los números de todas las sucursales…')}</div>`;
    el.querySelector('[data-a=operate]').onclick = () => PZ.app.branchPicker();
    bindRange(el, () => resumen(el));
    loadResumen(el);
  }

  async function loadResumen(el) {
    const my = ++reqId;
    const body = el.querySelector('.r-body');
    if (!navigator.onLine) { body.innerHTML = offlineCard; return; }
    const [from, to] = bounds();
    let rep, live, fin;
    try {
      [rep, live, fin] = await Promise.all([C().report(S.ctx.orgId, from, to), C().live(S.ctx.orgId), C().finance(S.ctx.orgId, from, to)]);
    } catch (e) { body.innerHTML = errorCard(e); return; }
    if (my !== reqId || !el.isConnected) return;
    const Ch = PZ.charts;
    const L = PZ.labels;
    const bs = branches();
    const fb = Object.fromEntries((fin.by_branch || []).map((b) => [b.branch_id, b]));
    const sales = (fin.by_branch || []).reduce((a, b) => a + Number(b.sales), 0);
    const tickets = (fin.by_branch || []).reduce((a, b) => a + Number(b.tickets), 0);
    const expenses = (fin.by_branch || []).reduce((a, b) => a + Number(b.expenses), 0);
    const today = live.today || {};
    const todaySales = Object.values(today).reduce((a, t) => a + Number(t.sales), 0);
    const openCash = new Set(live.open_cash || []);
    const active = live.active_orders || {};
    const low = live.low_stock || {};
    const lastClose = live.last_close || {};
    const gastosOn = PZ.auth.feature('gastos');

    // Alertas para el dueño
    const alerts = [];
    bs.filter((b) => b.active).forEach((b) => {
      const lc = lastClose[b.id];
      if (lc && Number(lc.diff) !== 0) alerts.push(`💰 <b>${U.esc(b.name)}</b>: el último cierre de caja dio ${Number(lc.diff) > 0 ? 'sobrante' : 'faltante'} de ${U.money(Math.abs(lc.diff))}`);
      if (low[b.id]) alerts.push(`📦 <b>${U.esc(b.name)}</b>: ${low[b.id]} insumo(s) por debajo del mínimo`);
      if (Number(active[b.id] || 0) >= 8) alerts.push(`🔥 <b>${U.esc(b.name)}</b>: ${active[b.id]} pedidos en curso ahora`);
      const f = fb[b.id];
      if (gastosOn && f && Number(f.sales) > 0 && Number(f.sales) - Number(f.expenses) < 0) alerts.push(`📉 <b>${U.esc(b.name)}</b>: en este período gastó más de lo que vendió`);
    });

    const days = [];
    for (let d = U.startOfDay(from).getTime(); d <= to; d += 864e5) days.push(U.dayKey(d));
    const dayMap = {};
    (rep.by_day || []).forEach((r) => { dayMap[r.day] = dayMap[r.day] || {}; dayMap[r.day][r.branch_id] = Number(r.sales); });
    const hours = Array.from({ length: 24 }, (_, h) => ({ label: h + 'h', value: 0 }));
    (rep.by_hour || []).forEach((r) => { hours[r.hour].value = Number(r.sales); });
    const firstH = hours.findIndex((h) => h.value > 0);
    const lastH = 23 - hours.slice().reverse().findIndex((h) => h.value > 0);

    body.innerHTML = `
      <div class="kpis">
        <div class="kpi"><span class="k-ico">☀️</span><div class="k-label">Vendido hoy (todas)</div><div class="k-value">${U.money(todaySales)}</div><div class="k-sub">${Object.values(active).reduce((a, n) => a + Number(n), 0)} pedidos en curso · ${openCash.size} caja(s) abierta(s)</div></div>
        <div class="kpi"><span class="k-ico">💰</span><div class="k-label">Ventas del período</div><div class="k-value">${U.money(sales)}</div><div class="k-sub">${tickets} tickets · promedio ${U.money(tickets ? sales / tickets : 0)}</div></div>
        ${gastosOn ? `<div class="kpi"><span class="k-ico">💸</span><div class="k-label">Gastos del período</div><div class="k-value">${U.money(expenses)}</div><div class="k-sub">${sales ? pct(expenses / sales) + ' de lo vendido' : '&nbsp;'}</div></div>
        <div class="kpi"><span class="k-ico">📈</span><div class="k-label">Resultado</div><div class="k-value" style="color:${sales - expenses >= 0 ? 'var(--ok)' : 'var(--err)'}">${U.money(sales - expenses)}</div><div class="k-sub">Margen ${sales ? pct((sales - expenses) / sales) : '—'}</div></div>` : ''}
      </div>
      ${alerts.length ? `<div class="card mt"><h3>🔔 Para prestar atención</h3>${alerts.map((a) => `<div class="alert-row">${a}</div>`).join('')}</div>` : ''}
      <div class="branch-grid mt">
        ${bs.map((b) => {
          const f = fb[b.id] || { sales: 0, tickets: 0, expenses: 0 };
          const t = today[b.id] || { sales: 0, tickets: 0 };
          const share = sales ? (Number(f.sales) / sales) * 100 : 0;
          const res = Number(f.sales) - Number(f.expenses);
          return `<div class="branch-card ${b.active ? '' : 'inactive'}" style="--bc:${colorOf(b.id)}">
            <div class="row-flex space-between"><h3>🏪 ${U.esc(b.name)}</h3>${b.active ? '' : '<span class="badge err">Inactiva</span>'}</div>
            ${addr(b) ? `<div class="small muted">📍 ${U.esc(addr(b))}</div>` : ''}
            <div class="bc-sales">${U.money(f.sales)}</div>
            <div class="small muted">${f.tickets} tickets en el período · hoy ${U.money(t.sales)}</div>
            <div class="bc-bar"><i style="width:${share}%"></i></div>
            <div class="small muted">${Math.round(share)}% de las ventas del negocio</div>
            ${gastosOn ? `<div class="bc-res"><span>Gastos ${U.money(f.expenses)}</span><b style="color:${res >= 0 ? 'var(--ok)' : 'var(--err)'}">${res >= 0 ? '▲' : '▼'} ${U.money(res)}</b></div>` : ''}
            <div class="row-flex mt" style="gap:6px">
              <span class="badge ${openCash.has(b.id) ? 'ok' : ''}">${openCash.has(b.id) ? '● Caja abierta' : '○ Caja cerrada'}</span>
              <span class="badge ${active[b.id] ? 'warn' : ''}">🔥 ${active[b.id] || 0} en curso</span>
              ${low[b.id] ? `<span class="badge err">📦 ${low[b.id]} faltantes</span>` : ''}
            </div>
            ${b.active ? `<button class="btn sm primary mt block" data-go="${b.id}">🍕 Operar en ${U.esc(b.name)}</button>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="card mt"><h3>📅 Ventas por día y sucursal</h3>
        ${Ch.stacked(days.map((d) => ({ label: d.slice(8) + '/' + d.slice(5, 7), values: bs.map((b) => (dayMap[d] || {})[b.id] || 0) })), bs.map((b) => ({ label: b.name, color: colorOf(b.id) })))}
      </div>
      <div class="dash">
        <div class="card"><h3>🏆 Productos más vendidos (todas)</h3>${Ch.hbars((rep.top_products || []).map((p) => ({ label: `${p.name} (${U.num(p.qty)})`, value: Number(p.revenue) })), { money: true })}</div>
        <div class="card"><h3>💳 Medios de pago</h3>${Ch.donut((rep.by_method || []).map((m) => ({ label: L.method[m.method] || m.method, value: Number(m.amount), color: Ch.methodColors[m.method] || '#999' })))}</div>
      </div>
      <div class="dash">
        <div class="card"><h3>⏰ Horarios pico</h3>${firstH >= 0 ? Ch.bars(hours.slice(firstH, lastH + 1)) : '<div class="empty small">Sin ventas en el período</div>'}</div>
        <div class="card"><h3>🛵 Tipo de pedido</h3>${Ch.donut((rep.by_type || []).map((t) => ({ label: L.type[t.type] || t.type, value: Number(t.sales), color: { mostrador: '#f4a261', delivery: '#e63946', retiro: '#2a9d8f', mesa: '#6c8ebf' }[t.type] || '#999' })))}</div>
      </div>`;
    body.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => PZ.app.openBranch(b.dataset.go).catch((e) => PZ.toast(e.message, 'err')));
  }

  /* =====================================================================
     SUCURSALES (alta, edición, encargados y códigos)
     ===================================================================== */
  function sucursales(el) {
    const org = S.ctx.org || {};
    const max = (org.features && org.features.maxBranches) || 10;
    const bs = branches();
    const admins = (bid) => S.ctx.members.filter((m) => m.role === 'admin' && m.active && (m.branch_ids || []).includes(bid));
    const staff = (bid) => S.ctx.members.filter((m) => !['owner', 'admin'].includes(m.role) && m.active && (!(m.branch_ids || []).length || m.branch_ids.includes(bid)));
    el.innerHTML = `
      <div class="row-flex space-between mb">
        <div class="muted">${bs.length} de ${max} sucursales de tu plan</div>
        <button class="btn primary" data-a="new" ${bs.length >= max ? 'disabled title="Llegaste al máximo de tu plan"' : ''}>➕ Nueva sucursal</button>
      </div>
      <div class="branch-grid">
        ${bs.map((b) => `<div class="branch-card ${b.active ? '' : 'inactive'}" style="--bc:${colorOf(b.id)}">
          <div class="row-flex space-between"><h3>🏪 ${U.esc(b.name)}</h3><span class="badge ${b.active ? 'ok' : 'err'}">${b.active ? 'Activa' : 'Inactiva'}</span></div>
          ${addr(b) ? `<div class="small muted">📍 ${U.esc(addr(b))}</div>` : ''}
          <div class="opt-section" style="margin-top:12px">Encargado/a</div>
          ${admins(b.id).length ? admins(b.id).map((m) => `<div class="list-row"><span class="avatar sm">${U.esc(m.name[0])}</span><div class="grow"><b>${U.esc(m.name)}</b><div class="small muted">${U.esc(m.username)}</div></div></div>`).join('') : '<div class="small muted">Sin encargado todavía</div>'}
          <div class="small muted mt">${staff(b.id).length} empleado(s)</div>
          <div class="row-flex mt" style="gap:6px">
            ${b.active ? `<button class="btn sm primary" data-code="${b.id}">🔑 Código para encargado</button>` : ''}
            <button class="btn sm ghost" data-edit="${b.id}">✏️ Editar</button>
            ${b.active ? `<button class="btn sm ghost" data-go="${b.id}">🍕 Operar</button>` : ''}
          </div>
        </div>`).join('')}
      </div>
      <div class="card mt"><h3>🔑 Códigos generados</h3><div class="inv-list">${loadingCard('Cargando…')}</div></div>`;
    el.querySelector('[data-a=new]').onclick = () => newBranch(() => sucursales(el));
    el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editBranch(S.branch(b.dataset.edit), () => sucursales(el)));
    el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => PZ.app.openBranch(b.dataset.go));
    el.querySelectorAll('[data-code]').forEach((b) => b.onclick = () => PZ.invites.create(b.dataset.code, 'admin', () => sucursales(el)));
    PZ.invites.renderList(el.querySelector('.inv-list'), () => sucursales(el));
  }

  async function copyBranchDocs(srcBranch, dstBranch, col, transform = (x) => x) {
    const { data, error } = await C().sb.from('docs').select('id, data').eq('org_id', S.ctx.orgId).eq('branch_id', srcBranch).eq('col', col);
    if (error) throw error;
    if (!data.length) return 0;
    await C().upsertDocs(data.map((r) => {
      const local = r.id.slice(r.id.indexOf('/') + 1);
      return { org_id: S.ctx.orgId, col, id: `${dstBranch}/${local}`, branch_id: dstBranch, data: transform({ ...r.data }) };
    }));
    return data.length;
  }

  function newBranch(done) {
    const bs = S.ctx.branches.filter((b) => b.active);
    const m = PZ.modal({
      title: '➕ Nueva sucursal',
      body: `
        <label class="field"><span>Nombre de la sucursal</span><input name="name" placeholder="Ej: Centro, Barrio Norte" autofocus></label>
        <div class="grid-2">
          <label class="field"><span>Dirección</span><input name="address"></label>
          <label class="field"><span>Teléfono / WhatsApp</span><input name="phone" inputmode="tel"></label>
        </div>
        <label class="field"><span>Menú y precios</span><select name="menu"><option value="model">Copiar el menú modelo del negocio</option>${bs.map((b) => `<option value="${b.id}">Copiar el menú de ${U.esc(b.name)}</option>`).join('')}<option value="">Empezar sin menú</option></select></label>
        <label class="field"><span>Configuración (ticket, cobros, zonas de envío)</span><select name="cfg">${bs.map((b) => `<option value="${b.id}">Copiar de ${U.esc(b.name)}</option>`).join('')}<option value="">Configuración por defecto</option></select></label>
        <label class="check"><input type="checkbox" name="ings" checked> Copiar la lista de insumos (con stock en cero)</label>
        <label class="check"><input type="checkbox" name="code" checked> Generar el código para el encargado</label>
        <p class="small muted">Cada sucursal tiene sus propios datos: menú, precios, clientes, caja, pedidos, stock y gastos. Vos los ves todos desde este panel.</p>`,
      footer: '<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Crear sucursal</button>',
    });
    const E = m.el;
    const v = (n) => E.querySelector(`[name=${n}]`).value.trim();
    E.querySelector('[data-a=x]').onclick = () => m.close();
    E.querySelector('[data-a=ok]').onclick = async () => {
      const name = v('name');
      if (!name) return PZ.toast('Poné un nombre', 'warn');
      if (!navigator.onLine) return PZ.toast('Hace falta conexión', 'warn');
      const btn = E.querySelector('[data-a=ok]');
      btn.disabled = true;
      btn.textContent = 'Creando…';
      try {
        const src = S.branch(v('cfg'));
        const settings = src ? JSON.parse(JSON.stringify(src.settings || {})) : PZ.seed.settings(S.ctx.org ? S.ctx.org.name : '', name);
        settings.business = { ...(settings.business || {}), address: v('address'), phone: v('phone'), branchLabel: name };
        settings.ticket = { ...(settings.ticket || {}), pos: S.ctx.branches.length + 1 };
        const { data: nb, error } = await C().sb.from('branches').insert({ org_id: S.ctx.orgId, name, settings }).select().single();
        if (error) throw new Error(/quota|row-level/i.test(error.message) ? 'Llegaste al máximo de sucursales de tu plan' : error.message);
        S.ctx.branches.push(nb);
        const menuSrc = v('menu');
        if (menuSrc === 'model') {
          const model = await C().menuModel(S.ctx.orgId);
          if (model && (model.categories || []).length) await C().writeBranchMenu(S.ctx.orgId, nb.id, model);
        } else if (menuSrc) {
          await C().writeBranchMenu(S.ctx.orgId, nb.id, await C().branchMenu(S.ctx.orgId, menuSrc));
        }
        const ingSrc = src || S.ctx.branches.find((b) => b.active && b.id !== nb.id);
        if (E.querySelector('[name=ings]').checked && ingSrc) await copyBranchDocs(ingSrc.id, nb.id, 'ingredient', (x) => ({ ...x, stock: 0 }));
        m.close();
        PZ.celebrate();
        PZ.toast(`Sucursal “${name}” creada`);
        if (E.querySelector('[name=code]').checked) PZ.invites.create(nb.id, 'admin', done);
        else done();
      } catch (e) {
        PZ.toast(e.message || 'No se pudo crear', 'err', 5000);
        btn.disabled = false;
        btn.textContent = 'Crear sucursal';
      }
    };
  }

  function editBranch(b, done) {
    const bz = (b.settings && b.settings.business) || {};
    const canDelete = S.ctx.branches && S.ctx.branches.length > 1;
    const m = PZ.modal({
      title: '✏️ ' + U.esc(b.name),
      body: `
        <label class="field"><span>Nombre de la sucursal</span><input name="name" value="${U.esc(b.name)}"></label>
        <label class="field"><span>Link de la carta (dirección web)</span>
          <div class="row-flex" style="gap:4px">
            <span class="muted small" style="white-space:nowrap">…carta.html?l=</span>
            <input name="slug" value="${U.esc(b.slug || '')}" placeholder="ej: palermo" maxlength="40">
          </div>
        </label>
        <div class="grid-2">
          <label class="field"><span>Dirección</span><input name="address" value="${U.esc(bz.address || '')}"></label>
          <label class="field"><span>Teléfono</span><input name="phone" value="${U.esc(bz.phone || '')}"></label>
        </div>
        <label class="check"><input type="checkbox" name="active" ${b.active ? 'checked' : ''}> Sucursal activa (si la desactivás, sus empleados no pueden ingresar)</label>
        ${canDelete ? '<div class="alert-row err mt" style="font-size:0.85em">⚠️ ¿Querés eliminar esta sucursal? Se borrarán sus pedidos y configuraciones.</div>' : ''}`,
      footer: `
        ${canDelete ? '<button class="btn danger sm" data-a="del" style="margin-right:auto">🗑️ Borrar sucursal</button>' : ''}
        <button class="btn ghost" data-a="x">Cancelar</button>
        <button class="btn primary" data-a="ok">Guardar</button>`,
    });
    const E = m.el;
    const v = (n) => E.querySelector(`[name=${n}]`).value.trim();
    E.querySelector('[data-a=x]').onclick = () => m.close();

    const delBtn = E.querySelector('[data-a=del]');
    if (delBtn) {
      delBtn.onclick = async () => {
        if (!(await PZ.confirm(`¿Estás seguro de BORRAR la sucursal "${b.name}"?\nSe borrarán todas sus ventas, mesas y configuraciones locales. Esta acción no se puede deshacer.`, { danger: true, ok: 'Borrar definitivamente' }))) return;
        try {
          PZ.toast('Borrando sucursal…', 'info');
          await PZ.cloud.deleteBranch(b.id);
          S.ctx.branches = S.ctx.branches.filter((x) => x.id !== b.id);
          m.close();
          PZ.toast('Sucursal eliminada');
          if (S.ctx.branchId === b.id && S.ctx.branches.length) {
            await PZ.app.openBranch(S.ctx.branches[0].id);
          } else {
            done();
          }
        } catch (e) {
          PZ.toast('No se pudo borrar: ' + e.message, 'err', 5000);
        }
      };
    }

    E.querySelector('[data-a=ok]').onclick = async () => {
      const name = v('name');
      if (!name) return PZ.toast('Poné un nombre para la sucursal', 'warn');
      const slugVal = v('slug').toLowerCase();
      if (slugVal && !PZ.carta.validSlug(slugVal)) {
        return PZ.toast('El link debe tener entre 3 y 40 caracteres (solo letras minúsculas, números y guiones)', 'warn');
      }

      const settings = JSON.parse(JSON.stringify(b.settings || {}));
      settings.business = { ...(settings.business || {}), address: v('address'), phone: v('phone') };
      const patch = { name, settings, active: E.querySelector('[name=active]').checked };

      try {
        if (slugVal !== (b.slug || '')) {
          await PZ.cloud.setSlug(b.id, slugVal || null);
          b.slug = slugVal || null;
        }
        await C().updateBranch(b.id, patch);
        Object.assign(b, patch);

        // Actualizar en el contexto local y en la barra superior
        const target = S.ctx.branches.find((x) => x.id === b.id);
        if (target) Object.assign(target, { name, slug: b.slug, active: b.active });

        // Si es la sucursal actual, actualizar el chip del header
        const chip = document.querySelector('.bc-txt');
        if (chip && S.ctx.branchId === b.id) chip.textContent = name;
        const brandSub = document.querySelector('.brand-txt small');
        if (brandSub && S.ctx.branchId === b.id) brandSub.textContent = name;

        m.close();
        PZ.toast('Sucursal actualizada');
        done();
      } catch (error) {
        PZ.toast(error.message, 'err');
      }
    };
  }

  /* =====================================================================
     FINANZAS (ganancias y gastos de todo el negocio)
     ===================================================================== */
  let finBranch = '';
  function finanzas(el) {
    el.innerHTML = `
      <div class="row-flex space-between mb">${rangeSeg()}
        <select class="fin-branch" style="max-width:240px"><option value="">Todas las sucursales</option>${branches().map((b) => `<option value="${b.id}" ${finBranch === b.id ? 'selected' : ''}>${U.esc(b.name)}</option>`).join('')}</select>
      </div>
      <div class="f-body">${loadingCard('Calculando ganancias…')}</div>`;
    bindRange(el, () => finanzas(el));
    el.querySelector('.fin-branch').onchange = (e) => { finBranch = e.target.value; finanzas(el); };
    loadFinanzas(el);
  }

  async function loadFinanzas(el) {
    const my = ++reqId;
    const body = el.querySelector('.f-body');
    if (!navigator.onLine) { body.innerHTML = offlineCard; return; }
    const [from, to] = bounds();
    let fin;
    try { fin = await C().finance(S.ctx.orgId, from, to); } catch (e) { body.innerHTML = errorCard(e); return; }
    if (my !== reqId || !el.isConnected) return;
    const Ch = PZ.charts;
    const rows = (fin.by_branch || []).filter((b) => !finBranch || b.branch_id === finBranch).map((b) => ({
      ...b, sales: Number(b.sales), cogs: Number(b.cogs), expenses: Number(b.expenses), tickets: Number(b.tickets),
    }));
    const T = rows.reduce((a, b) => ({ sales: a.sales + b.sales, cogs: a.cogs + b.cogs, expenses: a.expenses + b.expenses, tickets: a.tickets + b.tickets }), { sales: 0, cogs: 0, expenses: 0, tickets: 0 });
    const result = T.sales - T.expenses;
    const cats = {};
    (fin.expenses_by_branch_category || []).filter((x) => !finBranch || x.branch_id === finBranch).forEach((x) => { cats[x.category] = (cats[x.category] || 0) + Number(x.amount); });
    const CAT_COLORS = { Mercadería: '#e9a23b', Sueldos: '#6c8ebf', Alquiler: '#8e44ad', Servicios: '#2a9d8f', Impuestos: '#d7263d', Delivery: '#ff6b35', Mantenimiento: '#52b788', Publicidad: '#f4a261', Comisiones: '#1d7bd7', Otros: '#999' };
    const byDay = (fin.by_day || []);
    const best = rows.slice().sort((a, b) => (b.sales - b.expenses) - (a.sales - a.expenses));

    body.innerHTML = `
      <div class="kpis">
        <div class="kpi"><span class="k-ico">💰</span><div class="k-label">Ingresos (ventas)</div><div class="k-value">${U.money(T.sales)}</div><div class="k-sub">${T.tickets} tickets</div></div>
        <div class="kpi"><span class="k-ico">💸</span><div class="k-label">Gastos</div><div class="k-value">${U.money(T.expenses)}</div><div class="k-sub">${T.sales ? pct(T.expenses / T.sales) + ' de lo vendido' : '&nbsp;'}</div></div>
        <div class="kpi"><span class="k-ico">${result >= 0 ? '📈' : '📉'}</span><div class="k-label">Ganancia (ventas − gastos)</div><div class="k-value" style="color:${result >= 0 ? 'var(--ok)' : 'var(--err)'}">${U.money(result)}</div><div class="k-sub">Margen ${T.sales ? pct(result / T.sales) : '—'}</div></div>
        <div class="kpi"><span class="k-ico">🧀</span><div class="k-label">Costo de lo vendido (recetas)</div><div class="k-value">${U.money(T.cogs)}</div><div class="k-sub">Food cost ${T.sales ? pct(T.cogs / T.sales) : '—'} · teórico</div></div>
      </div>
      <div class="card mt"><h3>🏪 Resultado por sucursal</h3>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Sucursal</th><th class="right">Ventas</th><th class="right">Gastos</th><th class="right">Ganancia</th><th class="right">Margen</th><th class="right">Food cost</th><th class="right">Ticket prom.</th></tr></thead><tbody>
          ${best.map((b, i) => { const r = b.sales - b.expenses; return `<tr>
            <td><b>${i === 0 && best.length > 1 && r > 0 ? '🏆 ' : ''}${U.esc(b.name)}</b>${b.active ? '' : ' <span class="badge err">Inactiva</span>'}</td>
            <td class="right">${U.money(b.sales)}</td><td class="right">${U.money(b.expenses)}</td>
            <td class="right"><b style="color:${r >= 0 ? 'var(--ok)' : 'var(--err)'}">${U.money(r)}</b></td>
            <td class="right">${b.sales ? pct(r / b.sales) : '—'}</td><td class="right">${b.sales ? pct(b.cogs / b.sales) : '—'}</td>
            <td class="right">${U.money(b.tickets ? b.sales / b.tickets : 0)}</td></tr>`; }).join('')}
        </tbody></table></div>
      </div>
      <div class="dash">
        <div class="card"><h3>📅 Ventas vs. gastos por día</h3>${Ch.grouped(byDay.map((d) => ({ label: String(d.day).slice(8) + '/' + String(d.day).slice(5, 7), values: [Number(d.sales), Number(d.expenses)] })), [{ label: 'Ventas', color: '#2a9d8f' }, { label: 'Gastos', color: '#d7263d' }])}</div>
        <div class="card"><h3>🧾 ¿En qué se gasta?</h3>${Ch.donut(Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, color: CAT_COLORS[k] || '#999' })))}</div>
      </div>
      <div class="card mt"><h3>ℹ️ Cómo se calcula</h3>
        <p class="small muted" style="margin:0"><b>Ganancia</b> = todo lo cobrado − todos los gastos cargados (compras de mercadería, sueldos, alquiler, servicios, impuestos, etc.). Los gastos se cargan en cada sucursal en <b>Gastos y ganancias</b>, o desde la caja al registrar un retiro.<br>
        <b>Costo de lo vendido</b> es una referencia teórica calculada con las recetas y el costo de los insumos: sirve para saber si los precios cubren la mercadería (lo sano en pizzería suele estar entre 25% y 35%).</p>
      </div>`;
  }

  /* =====================================================================
     MENÚ MODELO
     ===================================================================== */
  function menuModelo(el) {
    el.innerHTML = loadingCard('Cargando el menú modelo…');
    (async () => {
      let model;
      try { model = await C().menuModel(S.ctx.orgId); } catch (e) { el.innerHTML = errorCard(e); return; }
      if (!el.isConnected) return;
      const has = model && (model.categories || []).length;
      const bs = branches().filter((b) => b.active);
      el.innerHTML = `
        <div class="card mb">
          <p style="margin-top:0">El <b>menú modelo</b> es el menú “oficial” del negocio. Se copia a cada sucursal nueva y lo podés mandar a las que quieras. Después, cada sucursal maneja su propia copia (puede tener precios distintos).</p>
          <div class="row-flex">
            <button class="btn ghost" data-a="take">📥 Usar el menú de una sucursal como modelo</button>
            <button class="btn primary" data-a="apply" ${has ? '' : 'disabled'}>📤 Enviar el modelo a sucursales</button>
            <button class="btn accent" data-a="prices">📈 Aumentar precios en sucursales</button>
          </div>
          ${has ? `<p class="small muted mb" style="margin-bottom:0">Última actualización: ${model.updatedAt ? U.dateTime(model.updatedAt) : '—'} · ${model.products.length} productos</p>` : ''}
        </div>
        ${has ? model.categories.map((c) => {
          const ps = model.products.filter((p) => p.categoryId === c.id);
          if (!ps.length) return '';
          return `<div class="card mb"><h3>${c.icon} ${U.esc(c.name)} <span class="badge">${ps.length}</span></h3>
            <div class="table-wrap"><table class="tbl"><thead><tr><th>Producto</th><th>Precios</th></tr></thead><tbody>
            ${ps.map((p) => `<tr><td><b>${U.esc(p.name)}</b><div class="small muted">${U.esc(p.desc || '')}</div></td><td>${p.variants.map((v) => `<span class="badge">${U.esc(v.name)} ${U.money(v.price)}</span>`).join(' ')}</td></tr>`).join('')}
            </tbody></table></div></div>`;
        }).join('') : '<div class="card empty"><span class="e-ico">📋</span>Todavía no hay menú modelo. Tomá el de una sucursal.</div>'}
        <p class="small muted">Para editar productos uno por uno, entrá a operar en una sucursal → Menú y precios, y después usá “Usar el menú de una sucursal como modelo”.</p>`;
      el.querySelector('[data-a=take]').onclick = () => {
        pickBranches('📥 ¿De qué sucursal tomo el menú?', bs, { single: true }, async ([bid]) => {
          const menu = await C().branchMenu(S.ctx.orgId, bid);
          if (!menu.products.length) throw new Error('Esa sucursal no tiene menú');
          await C().saveMenuModel(S.ctx.orgId, menu);
          PZ.toast('Menú modelo actualizado');
          menuModelo(el);
        });
      };
      const ap = el.querySelector('[data-a=apply]');
      if (ap) ap.onclick = () => applyModel(model, bs, () => menuModelo(el));
      el.querySelector('[data-a=prices]').onclick = () => bulkPrices(bs, () => menuModelo(el));
    })();
  }

  /** Modal para elegir una o varias sucursales */
  function pickBranches(title, list, { single = false, extra = '' } = {}, onOk) {
    const m = PZ.modal({
      title,
      body: `${extra}<div class="opt-section">${single ? 'Sucursal' : 'Sucursales'}</div>
        ${list.map((b, i) => `<label class="check"><input type="${single ? 'radio' : 'checkbox'}" name="b" value="${b.id}" ${single ? (i === 0 ? 'checked' : '') : 'checked'}> ${U.esc(b.name)}</label>`).join('')}`,
      footer: '<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Aceptar</button>',
    });
    m.el.querySelector('[data-a=x]').onclick = () => m.close();
    m.el.querySelector('[data-a=ok]').onclick = async () => {
      const ids = Array.from(m.el.querySelectorAll('[name=b]:checked')).map((x) => x.value);
      if (!ids.length) return PZ.toast('Elegí al menos una sucursal', 'warn');
      const btn = m.el.querySelector('[data-a=ok]');
      btn.disabled = true;
      btn.textContent = 'Aplicando…';
      try { await onOk(ids, m.el); m.close(); } catch (e) { PZ.toast(e.message, 'err', 5000); btn.disabled = false; btn.textContent = 'Aceptar'; }
    };
  }

  function applyModel(model, bs, done) {
    pickBranches('📤 Enviar el menú modelo', bs, {
      extra: `<label class="field"><span>¿Cómo?</span><select name="mode">
        <option value="prices">Solo actualizar precios de los productos que ya tienen</option>
        <option value="add">Agregar los productos que les falten (no toca lo demás)</option>
        <option value="replace">Reemplazar el menú completo por el modelo</option></select></label>`,
    }, async (ids, E) => {
      const mode = E.querySelector('[name=mode]').value;
      if (mode === 'replace' && !(await PZ.confirm(`Se reemplaza el menú completo de ${ids.length} sucursal(es). Los productos que no estén en el modelo se borran. ¿Continuar?`, { danger: true, ok: 'Reemplazar' }))) throw new Error('Cancelado');
      for (const bid of ids) {
        if (mode === 'replace') { await C().writeBranchMenu(S.ctx.orgId, bid, model, { replace: true }); continue; }
        const cur = await C().branchMenu(S.ctx.orgId, bid);
        if (mode === 'add') {
          ['categories', 'products', 'extras'].forEach((k) => {
            const have = new Set(cur[k].map((x) => x.id));
            model[k].forEach((x) => { if (!have.has(x.id)) cur[k].push(JSON.parse(JSON.stringify(x))); });
          });
        } else {
          cur.products.forEach((p) => {
            const mp = model.products.find((x) => x.id === p.id);
            if (!mp) return;
            p.variants.forEach((v) => { const mv = mp.variants.find((x) => x.id === v.id); if (mv) v.price = mv.price; });
          });
          cur.extras.forEach((x) => { const mx = model.extras.find((y) => y.id === x.id); if (mx) x.price = mx.price; });
        }
        await C().writeBranchMenu(S.ctx.orgId, bid, cur);
      }
      PZ.toast(`Listo: menú enviado a ${ids.length} sucursal(es)`);
      done();
    });
  }

  function bulkPrices(bs, done) {
    pickBranches('📈 Aumentar precios', bs, {
      extra: `<div class="grid-2">
        <label class="field"><span>Porcentaje</span><input name="pct" inputmode="decimal" placeholder="Ej: 8" autofocus></label>
        <label class="field"><span>Redondear a</span><select name="round"><option value="100">$100</option><option value="500" selected>$500</option><option value="1000">$1.000</option></select></label></div>
        <label class="check"><input type="checkbox" name="model" checked> Aplicar también al menú modelo</label>`,
    }, async (ids, E) => {
      const p = Number(String(E.querySelector('[name=pct]').value).replace(',', '.'));
      if (!p) throw new Error('Poné un porcentaje');
      const r = Number(E.querySelector('[name=round]').value);
      const calc = (x) => Math.max(0, Math.round((x * (1 + p / 100)) / r) * r);
      const bump = (menu) => { menu.products.forEach((pr) => pr.variants.forEach((v) => { v.price = calc(v.price); })); menu.extras.forEach((x) => { x.price = calc(x.price); }); return menu; };
      for (const bid of ids) await C().writeBranchMenu(S.ctx.orgId, bid, bump(await C().branchMenu(S.ctx.orgId, bid)));
      if (E.querySelector('[name=model]').checked) {
        const model = await C().menuModel(S.ctx.orgId);
        if (model && model.products) await C().saveMenuModel(S.ctx.orgId, bump(model));
      }
      PZ.toast(`Precios aumentados ${p}% en ${ids.length} sucursal(es)`);
      done();
    });
  }

  /* =====================================================================
     NEGOCIO (datos y plan)
     ===================================================================== */
  function negocio(el) {
    const org = S.ctx.org || {};
    const f = org.features || {};
    const mods = [['delivery', '🛵 Delivery'], ['mesas', '🍽️ Mesas'], ['stock', '📦 Stock'], ['gastos', '💸 Gastos y ganancias']];
    el.innerHTML = `
      <div class="dash" style="margin-top:0">
        <div class="card"><h3>🏢 Tu negocio</h3>
          <label class="field"><span>Nombre del negocio</span><input class="org-name" value="${U.esc(org.name || '')}"></label>
          <button class="btn primary" data-a="save">Guardar</button>
          <div class="bank-box mt">
            <div class="bk-row"><span>Sucursales</span><b>${S.ctx.branches.length} de ${f.maxBranches || 10}</b></div>
            <div class="bk-row"><span>Personas en el equipo</span><b>${S.ctx.members.filter((m) => m.active).length}</b></div>
            <div class="bk-row"><span>Cliente desde</span><b>${org.created_at ? U.date(org.created_at) : '—'}</b></div>
          </div>
        </div>
        <div class="card"><h3>🧩 Módulos de tu plan</h3>
          ${mods.map(([k, l]) => `<div class="list-row"><span class="grow">${l}</span><span class="badge ${f[k] !== false ? 'ok' : ''}">${f[k] !== false ? 'Incluido' : 'No incluido'}</span></div>`).join('')}
          <p class="small muted">Para sumar módulos o sucursales, hablá con el administrador del sistema.</p>
        </div>
      </div>`;
    el.querySelector('[data-a=save]').onclick = async () => {
      const name = el.querySelector('.org-name').value.trim();
      if (!name) return;
      try {
        await C().updateOrg(S.ctx.orgId, { name });
        S.ctx.org.name = name;
        PZ.toast('Guardado');
        PZ.app.renderShell();
        PZ.app.route();
      } catch (e) { PZ.toast(e.message, 'err'); }
    };
  }

  PZ.views['n-resumen'] = { title: 'Resumen del negocio', live: true, render: resumen };
  PZ.views['n-sucursales'] = { title: 'Sucursales', live: true, render: sucursales };
  PZ.views['n-finanzas'] = { title: 'Finanzas', render: finanzas };
  PZ.views['n-menu'] = { title: 'Menú modelo', render: menuModelo };
  PZ.views['n-config'] = { title: 'Negocio', render: negocio };
})(window.PZ);
