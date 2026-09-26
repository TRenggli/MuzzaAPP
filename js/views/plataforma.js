/* ==========================================================================
   PLATAFORMA — solo para el creador del sistema.
   Crea negocios a medida (dueño, módulos, límite de sucursales), los
   suspende o reactiva y entra a darles soporte.
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  const MODS = [['delivery', '🛵 Delivery'], ['mesas', '🍽️ Mesas'], ['stock', '📦 Stock e insumos'], ['gastos', '💸 Gastos y ganancias'], ['carta', '📲 Carta online'], ['mercadopago', '💳 QR de Mercado Pago']];
  const genPass = () => {
    const a = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const b = new Uint32Array(10);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => a[x % a.length]).join('');
  };

  function render(el) {
    el.innerHTML = `
      <div class="row-flex space-between mb">
        <input type="search" class="q grow" placeholder="🔎 Buscar negocio o dueño…" style="max-width:420px">
        <button class="btn primary" data-a="new">➕ Nuevo negocio</button>
      </div>
      <div class="p-body"><div class="card empty"><span class="e-ico">🛠️</span>Cargando negocios…</div></div>`;
    el.querySelector('[data-a=new]').onclick = () => create(() => render(el));
    load(el);
  }

  async function load(el) {
    let orgs;
    try { orgs = await PZ.cloud.platformOrgs(); } catch (e) { el.querySelector('.p-body').innerHTML = `<div class="card empty">🔥 ${U.esc(e.message)}</div>`; return; }
    // si mientras cargaba se cambió de pantalla, no dibujar
    if (!el.isConnected || !el.querySelector('.p-body')) return;
    const draw = () => {
      const q = U.stripAccents(el.querySelector('.q').value.toLowerCase());
      const list = orgs.filter((o) => !q || U.stripAccents(`${o.name} ${o.owner ? o.owner.name + ' ' + o.owner.username : ''}`.toLowerCase()).includes(q));
      el.querySelector('.p-body').innerHTML = `
        <div class="kpis mb">
          <div class="kpi"><span class="k-ico">🍕</span><div class="k-label">Negocios</div><div class="k-value">${orgs.length}</div><div class="k-sub">${orgs.filter((o) => o.status === 'active').length} activos</div></div>
          <div class="kpi"><span class="k-ico">🏪</span><div class="k-label">Sucursales</div><div class="k-value">${orgs.reduce((a, o) => a + Number(o.branches), 0)}</div></div>
          <div class="kpi"><span class="k-ico">🧑‍🍳</span><div class="k-label">Usuarios</div><div class="k-value">${orgs.reduce((a, o) => a + Number(o.members), 0)}</div></div>
          <div class="kpi"><span class="k-ico">💰</span><div class="k-label">Ventas procesadas (30 días)</div><div class="k-value">${U.money(orgs.reduce((a, o) => a + Number(o.sales30), 0))}</div></div>
        </div>
        <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Negocio</th><th>Dueño</th><th>Sucursales</th><th>Usuarios</th><th class="right">Ventas 30 días</th><th>Última venta</th><th>Estado</th><th></th></tr></thead><tbody>
          ${list.map((o) => `<tr>
            <td><b>${U.esc(o.name)}</b><div class="small muted">Alta ${U.date(o.created_at)}${o.notes ? ' · ' + U.esc(o.notes) : ''}</div></td>
            <td>${o.owner ? `${U.esc(o.owner.name)}<div class="small muted">${U.esc(o.owner.username)}</div>` : '—'}</td>
            <td>${o.branches} / ${(o.features && o.features.maxBranches) || 10}</td>
            <td>${o.members}</td>
            <td class="right">${U.money(o.sales30)}</td>
            <td class="small">${o.last_order ? U.dateTime(o.last_order) : '—'}</td>
            <td><span class="badge ${o.status === 'active' ? 'ok' : 'err'}">${o.status === 'active' ? 'Activo' : 'Suspendido'}</span></td>
            <td class="actions"><button class="btn sm primary" data-in="${o.id}">Entrar</button> <button class="btn sm ghost" data-ed="${o.id}">⚙️</button></td>
          </tr>`).join('') || '<tr><td colspan="8" class="empty">Sin resultados</td></tr>'}
        </tbody></table></div></div>`;
      el.querySelectorAll('[data-in]').forEach((b) => b.onclick = () => PZ.app.supportOrg(orgs.find((o) => o.id === b.dataset.in)).catch((e) => PZ.toast(e.message, 'err')));
      el.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => settings(orgs.find((o) => o.id === b.dataset.ed), () => render(el)));
    };
    el.querySelector('.q').addEventListener('input', U.debounce(draw, 150));
    draw();
  }

  const modsHtml = (f = {}) => MODS.map(([k, l]) => `<label class="check"><input type="checkbox" name="f-${k}" ${f[k] !== false ? 'checked' : ''}> ${l}</label>`).join('');
  const readMods = (E) => Object.fromEntries(MODS.map(([k]) => [k, E.querySelector(`[name=f-${k}]`).checked]));

  /* ---------------- Crear negocio a medida ---------------- */
  function create(done) {
    const pass = genPass();
    const m = PZ.modal({
      title: '➕ Nuevo negocio',
      size: 'lg',
      body: `
        <div class="grid-2">
          <label class="field"><span>Nombre del negocio</span><input name="org" placeholder="Pizzería Don Pepe" autofocus></label>
          <label class="field"><span>Primera sucursal</span><input name="branch" value="Casa central"></label>
          <label class="field"><span>Nombre del dueño</span><input name="owner"></label>
          <label class="field"><span>Usuario del dueño (o su email)</span><input name="user" autocapitalize="off" placeholder="ej: pepe o pepe@mail.com"></label>
          <label class="field"><span>Contraseña inicial</span><input name="pass" value="${pass}"></label>
          <label class="field"><span>Máximo de sucursales</span><input name="max" inputmode="numeric" value="3"></label>
        </div>
        <div class="opt-section">Módulos incluidos</div>
        <div class="grid-2">${modsHtml()}</div>
        <div class="opt-section">Arranque</div>
        <label class="check"><input type="checkbox" name="menu" checked> Cargar menú de ejemplo (el dueño lo edita después)</label>
        <label class="check"><input type="checkbox" name="demo"> Cargar 2 semanas de ventas de demostración</label>
        <label class="field mt"><span>Notas internas (solo las ves vos)</span><input name="notes" placeholder="Ej: plan mensual, contacto, etc."></label>
        <p class="small muted">Si el negocio es de una sola persona que hace todo, alcanza con el usuario del dueño: tiene todas las funciones. Si mañana crece, el mismo dueño agrega sucursales y empleados.</p>`,
      footer: '<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Crear negocio</button>',
    });
    const E = m.el;
    const v = (n) => E.querySelector(`[name=${n}]`).value.trim();
    E.querySelector('[data-a=x]').onclick = () => m.close();
    E.querySelector('[data-a=ok]').onclick = async () => {
      const btn = E.querySelector('[data-a=ok]');
      btn.disabled = true;
      btn.textContent = 'Creando…';
      try {
        const orgName = v('org');
        const branchName = v('branch') || 'Casa central';
        const res = await PZ.cloud.platform('create_org', {
          orgName, branchName, ownerName: v('owner'), ownerUser: v('user'), ownerPassword: v('pass'), notes: v('notes'),
          features: { ...readMods(E), maxBranches: Math.max(1, Number(v('max')) || 1) },
          settings: PZ.seed.settings(orgName, branchName),
        });
        const seedMenu = E.querySelector('[name=menu]').checked;
        const seedDemo = E.querySelector('[name=demo]').checked;
        const cred = { org: orgName, user: v('user').toLowerCase(), pass: v('pass') };
        m.close();
        if (seedMenu || seedDemo) {
          PZ.app.loading('Preparando el negocio nuevo…');
          PZ.auth.useSupport({ id: res.org_id });
          await PZ.app.loadOrg(res.org_id);
          await S.open(res.org_id, res.branch_id);
          if (seedMenu) await S.seedIfEmpty({ example: true, customers: seedDemo });
          if (seedDemo) await PZ.seed.demoHistory(14);
          S.diff();
          await S.flush();
          await PZ.app.openPlatform();
        } else done();
        credentials(cred);
      } catch (e) {
        PZ.toast(e.message || 'No se pudo crear', 'err', 6000);
        btn.disabled = false;
        btn.textContent = 'Crear negocio';
      }
    };
  }

  function credentials({ org, user, pass }) {
    const url = location.origin + location.pathname;
    const text = `¡Hola! Ya está listo el sistema de ${org} 🍕\n\nEntrá a: ${url}\nUsuario: ${user}\nContraseña: ${pass}\n\nTe recomiendo cambiar la contraseña al ingresar (tocando tu nombre arriba a la derecha).`;
    const m = PZ.modal({
      title: '✅ Negocio creado',
      size: 'sm',
      body: `<p style="margin-top:0">Datos de acceso del dueño de <b>${U.esc(org)}</b>:</p>
        <div class="bank-box"><div class="bk-row"><span>Página</span><b class="small">${U.esc(url)}</b></div><div class="bk-row"><span>Usuario</span><b>${U.esc(user)}</b></div><div class="bk-row"><span>Contraseña</span><b class="mono">${U.esc(pass)}</b></div></div>
        <p class="small muted">Guardalos o mandáselos ahora: la contraseña no se vuelve a mostrar (la podés resetear desde ⚙️).</p>`,
      footer: '<button class="btn ghost" data-a="cp">📋 Copiar</button><button class="btn primary" data-a="wa">💬 WhatsApp</button>',
    });
    m.el.querySelector('[data-a=cp]').onclick = async () => { try { await navigator.clipboard.writeText(text); PZ.toast('Copiado'); } catch (e) { PZ.toast('No se pudo copiar', 'warn'); } };
    m.el.querySelector('[data-a=wa]').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  /* ---------------- Configurar un negocio ---------------- */
  function settings(o, done) {
    const f = o.features || {};
    const m = PZ.modal({
      title: '⚙️ ' + U.esc(o.name),
      body: `
        <div class="opt-section">Módulos</div>
        <div class="grid-2">${modsHtml(f)}</div>
        <div class="grid-2 mt">
          <label class="field"><span>Máximo de sucursales</span><input name="max" inputmode="numeric" value="${f.maxBranches || 10}"></label>
          <label class="field"><span>Estado</span><select name="status"><option value="active" ${o.status === 'active' ? 'selected' : ''}>Activo</option><option value="suspended" ${o.status !== 'active' ? 'selected' : ''}>Suspendido (nadie puede ingresar)</option></select></label>
        </div>
        <label class="field"><span>Notas internas</span><input name="notes" value="${U.esc(o.notes || '')}"></label>
        ${o.owner ? `<div class="opt-section">Dueño: ${U.esc(o.owner.name)} (${U.esc(o.owner.username)})</div><button class="btn ghost" data-a="reset">🔑 Generar contraseña nueva para el dueño</button>` : ''}`,
      footer: '<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Guardar</button>',
    });
    const E = m.el;
    E.querySelector('[data-a=x]').onclick = () => m.close();
    const reset = E.querySelector('[data-a=reset]');
    if (reset) reset.onclick = async () => {
      if (!(await PZ.confirm(`¿Generar una contraseña nueva para ${U.esc(o.owner.name)}? La actual deja de funcionar.`))) return;
      const pass = genPass();
      try {
        await PZ.cloud.platform('reset_password', { user_id: o.owner.user_id, password: pass });
        m.close();
        credentials({ org: o.name, user: o.owner.username, pass });
      } catch (e) { PZ.toast(e.message, 'err'); }
    };
    E.querySelector('[data-a=ok]').onclick = async () => {
      const status = E.querySelector('[name=status]').value;
      if (status !== o.status && status === 'suspended' && !(await PZ.confirm(`¿Suspender ${U.esc(o.name)}? Nadie del negocio va a poder ingresar hasta que lo reactives. Los datos se conservan.`, { danger: true, ok: 'Suspender' }))) return;
      try {
        await PZ.cloud.updateOrg(o.id, {
          status, notes: E.querySelector('[name=notes]').value.trim(),
          features: { ...f, ...readMods(E), maxBranches: Math.max(1, Number(E.querySelector('[name=max]').value) || 1) },
        });
        m.close();
        PZ.toast('Negocio actualizado');
        done();
      } catch (e) { PZ.toast(e.message, 'err'); }
    };
  }

  /* ---------------- Errores que tuvo la app en los equipos de los clientes ---------------- */
  async function errores(el) {
    el.innerHTML = '<div class="card empty"><span class="e-ico">🐞</span>Cargando…</div>';
    let rows, orgs;
    try { [rows, orgs] = await Promise.all([PZ.cloud.errors(300), PZ.cloud.platformOrgs()]); } catch (e) { el.innerHTML = `<div class="card empty">${U.esc(e.message)}</div>`; return; }
    if (!el.isConnected || PZ.app.currentView !== 'p-errores') return;
    const orgName = Object.fromEntries(orgs.map((o) => [o.id, o.name]));
    const groups = {};
    rows.forEach((r) => {
      const g = (groups[r.message] = groups[r.message] || { message: r.message, count: 0, last: r.at, rows: [] });
      g.count++;
      g.rows.push(r);
    });
    const list = Object.values(groups).sort((a, b) => new Date(b.last) - new Date(a.last));
    const day = rows.filter((r) => Date.now() - new Date(r.at) < 864e5).length;
    el.innerHTML = `
      <div class="kpis mb">
        <div class="kpi"><span class="k-ico">🐞</span><div class="k-label">Errores (últimos ${rows.length})</div><div class="k-value">${list.length} distintos</div></div>
        <div class="kpi"><span class="k-ico">⏱️</span><div class="k-label">Últimas 24 horas</div><div class="k-value" style="color:${day ? 'var(--err)' : 'var(--ok)'}">${day}</div></div>
      </div>
      <div class="card">
        ${list.length ? list.map((g) => {
          const r = g.rows[0];
          return `<details class="err-group"><summary><span class="badge ${g.count > 5 ? 'err' : 'warn'}">${g.count}×</span> <b>${U.esc(g.message)}</b><div class="small muted">Último: ${U.dateTime(g.last)} · v${U.esc(r.version || '?')} · ${U.esc(orgName[r.org_id] || 'sin negocio')}</div></summary>
            ${g.rows.slice(0, 5).map((x) => `<div class="err-row small"><b>${U.dateTime(x.at)}</b> · ${U.esc(orgName[x.org_id] || '—')} · ${U.esc(x.context || '')}<br><span class="muted">${U.esc(x.url || '')}</span>${x.stack ? `<pre>${U.esc(x.stack)}</pre>` : ''}</div>`).join('')}
          </details>`;
        }).join('') : '<div class="empty"><span class="e-ico">😎</span>Sin errores registrados</div>'}
      </div>
      <p class="small muted">Se registran solos los errores que tiene la app en el celular o compu de cada cliente (no los cortes de internet). Sirve para enterarte de un problema antes de que te llamen.</p>`;
  }

  PZ.views['p-negocios'] = { title: 'Negocios', render };
  PZ.views['p-errores'] = { title: 'Errores de la app', render: errores };
})(window.PZ);
