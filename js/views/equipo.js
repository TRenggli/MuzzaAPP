// @ts-check
/* ==========================================================================
   EQUIPO — personas, códigos de invitación y rendimiento
     'equipo'   → dentro de una sucursal (encargado o dueño operando)
     'n-equipo' → panel del negocio (todas las sucursales)
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  const A = () => PZ.auth;
  const RANGES = [['7d', '7 días'], ['30d', '30 días'], ['mes', 'Este mes'], ['mesant', 'Mes pasado']];
  let range = '30d';
  let orgBranch = '';

  const bounds = () => U.rangeBounds(range);
  const roleBadge = (r) => `<span class="badge ${r === 'owner' ? 'pri' : r === 'admin' ? 'warn' : ''}">${A().ROLES[r].label}</span>`;
  const branchNames = (ids) => (!ids || !ids.length ? 'Todas' : ids.map((id) => S.branchName(id) || '?').join(', '));
  const inBranch = (m, bid) => m.role === 'owner' || !(m.branch_ids || []).length || m.branch_ids.includes(bid);
  /** Enlace que abre directo el alta con el código cargado */
  const inviteLink = (code) => `${location.origin}${location.pathname}?codigo=${encodeURIComponent(code)}`;
  const shareText = (code, inv) => `¡Hola! Te sumo al equipo de ${S.ctx.org ? S.ctx.org.name : 'la pizzería'} (sucursal ${S.branchName(inv.branch_id)}) 🍕\n\nEntrá a este enlace y elegí tu usuario y contraseña:\n${inviteLink(code)}\n\nSi te pide un código: *${code}*\nVence el ${U.date(inv.expires_at)}.`;

  /* =====================================================================
     Códigos de invitación
     ===================================================================== */
  PZ.invites = {
    /** Genera un código. Si no se indica rol, se elige en un modal. */
    async create(branchId, role, done = () => {}) {
      if (!role) {
        const roles = ['cajero', 'mozo', 'cocina', 'delivery'].concat(A().isOwner() ? ['admin'] : []);
        role = await new Promise((res) => {
          let chosen = null;
          const m = PZ.modal({
            title: '🔑 Código para sumar a alguien',
            size: 'sm',
            body: `<p class="muted" style="margin-top:0">Sucursal <b>${U.esc(S.branchName(branchId))}</b>. ¿Qué va a hacer esta persona?</p>
              <div class="pick-list">${roles.map((r) => `<button class="pick" data-r="${r}"><span class="pick-ico">${{ admin: '🧑‍💼', cajero: '💵', mozo: '🍽️', cocina: '👨‍🍳', delivery: '🛵' }[r]}</span><span><b>${A().ROLES[r].label}</b><small>${{ admin: 'Maneja toda la sucursal', cajero: 'Vende, cobra, caja y pedidos', mozo: 'Atiende las mesas: abre, pide tandas y pide la cuenta', cocina: 'Solo tablero de pedidos', delivery: 'Solo tablero de pedidos' }[r]}</small></span><span class="pick-go">→</span></button>`).join('')}</div>`,
            onClose: () => res(chosen),
          });
          m.el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { chosen = b.dataset.r; m.close(); });
        });
        if (!role) return;
      }
      if (!navigator.onLine) return PZ.toast('Hace falta conexión', 'warn');
      let code;
      try { code = await PZ.cloud.createInvite(branchId, role, 7); } catch (e) { return PZ.toast(e.message, 'err'); }
      const inv = { code, branch_id: branchId, role, expires_at: new Date(Date.now() + 7 * 864e5).toISOString() };
      PZ.invites.show(inv);
      done();
    },

    show(inv) {
      const text = shareText(inv.code, inv);
      const m = PZ.modal({
        title: '🔑 Código listo',
        size: 'sm',
        body: `<p class="muted" style="margin-top:0">Para sumar un/a <b>${A().ROLES[inv.role].label}</b> en <b>${U.esc(S.branchName(inv.branch_id))}</b>. Sirve una sola vez y vence el ${U.date(inv.expires_at)}.</p>
          <div class="invite-qr">${U.qrSvg(inviteLink(inv.code), 5, 2)}<small>Escaneá con la cámara del celular</small></div>
          <div class="code-big">${U.esc(inv.code)}</div>
          <div class="invite-link"><input readonly value="${U.esc(inviteLink(inv.code))}"><button class="btn sm ghost" data-a="cplink">Copiar enlace</button></div>
          <p class="small muted">Con el enlace o el QR, la persona entra directo al alta con el código ya cargado y elige su usuario y contraseña. Al ingresar le vamos a pedir su teléfono y CUIL.</p>`,
        footer: '<button class="btn ghost" data-a="cp">📋 Copiar mensaje</button><button class="btn primary" data-a="wa">💬 Enviar por WhatsApp</button>',
      });
      m.el.querySelector('[data-a=cplink]').onclick = async () => { try { await navigator.clipboard.writeText(inviteLink(inv.code)); PZ.toast('Enlace copiado'); } catch (e) { m.el.querySelector('.invite-link input').select(); } };
      m.el.querySelector('[data-a=cp]').onclick = async () => { try { await navigator.clipboard.writeText(text); PZ.toast('Copiado'); } catch (e) { PZ.toast(inv.code, 'info', 6000); } };
      m.el.querySelector('[data-a=wa]').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    },

    async renderList(box, refresh, { branchId = '' } = {}) {
      let list;
      try { list = await PZ.cloud.invites(S.ctx.orgId); } catch (e) { box.innerHTML = `<div class="empty small">No se pudieron cargar los códigos</div>`; return; }
      if (!box.isConnected) return;
      list = list.filter((i) => !branchId || i.branch_id === branchId);
      const now = Date.now();
      const state = (i) => (i.revoked ? ['err', 'Anulado'] : i.used_at ? ['ok', 'Usado'] : new Date(i.expires_at).getTime() < now ? ['', 'Vencido'] : ['warn', 'Pendiente']);
      if (!list.length) { box.innerHTML = '<div class="empty small">Todavía no generaste códigos</div>'; return; }
      const member = (id) => S.ctx.members.find((m) => m.user_id === id);
      box.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Código</th><th>Sucursal</th><th>Rol</th><th>Estado</th><th>Vence / usado por</th><th></th></tr></thead><tbody>
        ${list.slice(0, 30).map((i) => { const [c, l] = state(i); return `<tr>
          <td><b class="mono">${U.esc(i.code)}</b></td><td>${U.esc(S.branchName(i.branch_id))}</td><td>${A().ROLES[i.role].label}</td>
          <td><span class="badge ${c}">${l}</span></td>
          <td class="small">${i.used_at ? U.esc((member(i.used_by) || {}).name || 'Alguien') + ' · ' + U.date(i.used_at) : U.date(i.expires_at)}</td>
          <td class="actions">${l === 'Pendiente' ? `<button class="btn sm ghost" data-share="${i.code}">💬</button><button class="btn sm ghost" data-rev="${i.code}">Anular</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>`;
      box.querySelectorAll('[data-share]').forEach((b) => b.onclick = () => PZ.invites.show(list.find((i) => i.code === b.dataset.share)));
      box.querySelectorAll('[data-rev]').forEach((b) => b.onclick = async () => {
        if (!(await PZ.confirm(`¿Anular el código ${b.dataset.rev}? Ya no se va a poder usar.`, { danger: true, ok: 'Anular' }))) return;
        try { await PZ.cloud.revokeInvite(b.dataset.rev); PZ.toast('Código anulado'); refresh(); } catch (e) { PZ.toast(e.message, 'err'); }
      });
    },
  };

  /* =====================================================================
     Alta y edición de personas
     ===================================================================== */
  async function reloadMembers() {
    const meta = await PZ.cloud.orgMeta(S.ctx.orgId);
    S.ctx.members = meta.members;
    S.ctx.branches = meta.branches;
    if (S.data) S.afterLoad();
  }

  function shareDriverAccess(m) {
    if (!m) return;
    const bid = (m.branch_ids && m.branch_ids[0]) || S.ctx.branchId;
    const branch = S.ctx.branches.find((b) => b.id === bid) || (S.data ? S.data.branch : null);
    const slug = branch ? branch.slug : 'diego';
    const drivers = (S.data && S.data.settings && S.data.settings.drivers) || [];
    const matched = PZ.carta ? PZ.carta.matchDriver(drivers, m.name) : null;
    const code = matched ? matched.code : (PZ.carta ? PZ.carta.generateDriverCode('DEL', 101) : 'DEL-101');
    const url = PZ.carta ? PZ.carta.repartoUrl(location.href, slug, m.name, '', code) : `reparto.html?c=${code}`;
    const orgName = S.ctx.org ? S.ctx.org.name : 'la pizzería';
    const text = `¡Hola ${m.name}! Te paso tu acceso a la App de Repartos de ${orgName} 🛵\n\nEntrá directo desde acá:\n${url}\n\nTu código único de repartidor: *${code}*`;

    const modal = PZ.modal({
      title: `🛵 Acceso para ${U.esc(m.name)}`,
      size: 'sm',
      body: `
        <p class="muted" style="margin-top:0">El repartidor entra directo sin contraseña usando su código único:</p>
        <div class="code-big" style="font-size:2rem;text-align:center;padding:12px;background:var(--bg);border-radius:10px;font-family:monospace;font-weight:900;color:var(--primary);margin-bottom:12px">${U.esc(code)}</div>
        <div class="invite-link" style="display:flex;gap:6px"><input readonly value="${U.esc(url)}" style="font-size:0.85rem;flex:1"><button class="btn sm ghost" data-cp>Copiar</button></div>
      `,
      footer: `<button class="btn ghost" data-cp-txt>📋 Copiar mensaje</button><button class="btn primary" data-wa>💬 WhatsApp</button>`,
    });

    modal.el.querySelector('[data-cp]').onclick = async () => {
      try { await navigator.clipboard.writeText(url); PZ.toast('Enlace copiado'); } catch (e) { modal.el.querySelector('input').select(); }
    };
    modal.el.querySelector('[data-cp-txt]').onclick = async () => {
      try { await navigator.clipboard.writeText(text); PZ.toast('Mensaje copiado'); } catch (e) { PZ.toast(code, 'info', 5000); }
    };
    modal.el.querySelector('[data-wa]').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  function editUser(u, done, { fixedBranch = '' } = {}) {
    const R = A().ROLES;
    const owner = A().isOwner();
    const roles = Object.keys(R).filter((k) => k !== 'owner' && (k !== 'admin' || owner));
    const branches = PZ.app.allowedBranches();
    const ids = u ? u.branch_ids || [] : fixedBranch ? [fixedBranch] : [];
    const all = u ? !ids.length : false;
    const drivers = (S.data && S.data.settings && S.data.settings.drivers) || [];
    const matched = u ? (PZ.carta ? PZ.carta.matchDriver(drivers, u.name) : null) : null;
    let initialDriverCode = matched ? matched.code : (PZ.carta ? PZ.carta.generateDriverCode('DEL', 101 + drivers.length) : `DEL-${101 + drivers.length}`);

    const m = PZ.modal({
      title: u ? '✏️ ' + U.esc(u.name) : '➕ Nueva persona',
      body: `
        <div class="grid-2">
          <label class="field"><span>Nombre</span><input name="name" value="${U.esc(u ? u.name : '')}" autofocus></label>
          <label class="field username-field"><span>Usuario para ingresar</span><input name="username" value="${U.esc(u ? u.username : '')}" autocapitalize="off" ${u ? 'disabled' : 'placeholder="ej: sofia.centro"'}></label>
          <label class="field"><span>Rol</span><select name="role">${roles.map((k) => `<option value="${k}" ${u && u.role === k ? 'selected' : !u && k === 'cajero' ? 'selected' : ''}>${R[k].label}</option>`).join('')}</select></label>
          <label class="field pass-field"><span>${u ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña (mínimo 6)'}</span><input name="pass" type="password" autocomplete="new-password"></label>
        </div>
        <div class="delivery-code-box ${u && u.role === 'delivery' ? '' : 'hidden'}" style="margin-top:12px;padding:12px;background:var(--bg);border-radius:10px;border:1px solid var(--line);">
          <div class="bold small" style="color:var(--primary);margin-bottom:4px">🛵 Identificador Único de Repartidor</div>
          <p class="small muted" style="margin:0 0 8px">El repartidor <b>no necesita usuario ni contraseña</b>. Entrará a la app de entregas solo con este código único:</p>
          <div class="row-flex" style="gap:6px">
            <input name="driver_code" value="${U.esc(initialDriverCode)}" placeholder="EJ: DEL-101" style="flex:2;font-family:monospace;font-weight:800;text-transform:uppercase">
            <button type="button" class="btn sm ghost" data-cp-code style="flex:1">📲 Copiar link</button>
          </div>
        </div>
        <div class="opt-section">Sucursales donde trabaja</div>
        ${owner ? `<label class="check"><input type="checkbox" name="all" ${all ? 'checked' : ''}> Todas las sucursales</label>` : ''}
        <div class="branch-checks ${all ? 'hidden' : ''}">${branches.map((b) => `<label class="check"><input type="checkbox" name="br" value="${b.id}" ${ids.includes(b.id) ? 'checked' : ''}> ${U.esc(b.name)}</label>`).join('')}</div>
        ${u ? `<label class="check mt"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Activo (si lo desactivás no puede ingresar)</label>` : ''}`,
      footer: `${u ? '<button class="btn danger" data-a="del">Quitar</button><span class="grow"></span>' : ''}<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Guardar</button>`,
    });
    const E = m.el;
    const v = (n) => E.querySelector(`[name=${n}]`).value.trim();
    const allBox = E.querySelector('[name=all]');
    if (allBox) allBox.onchange = () => E.querySelector('.branch-checks').classList.toggle('hidden', allBox.checked);

    const roleSel = E.querySelector('[name=role]');
    const delBox = E.querySelector('.delivery-code-box');
    const updateRoleUI = () => {
      const isDel = roleSel.value === 'delivery';
      if (delBox) delBox.classList.toggle('hidden', !isDel);
      if (isDel && !E.querySelector('[name=username]').value && E.querySelector('[name=name]').value) {
        E.querySelector('[name=username]').value = 'del.' + (PZ.carta ? PZ.carta.slugify(E.querySelector('[name=name]').value) : 'chofer');
      }
    };
    if (roleSel) roleSel.onchange = updateRoleUI;

    const cpCodeBtn = E.querySelector('[data-cp-code]');
    if (cpCodeBtn) {
      cpCodeBtn.onclick = async () => {
        const codeInput = E.querySelector('[name=driver_code]');
        const code = (codeInput ? codeInput.value.trim().toUpperCase() : '') || initialDriverCode;
        const slug = (S.data && S.data.branch ? S.data.branch.slug : '') || 'diego';
        const url = PZ.carta ? PZ.carta.repartoUrl(location.href, slug, v('name'), '', code) : `reparto.html?c=${code}`;
        try {
          await navigator.clipboard.writeText(url);
          PZ.toast(`Link copiado: ${url}`);
        } catch (e) {
          PZ.toast(url, 'info', 5000);
        }
      };
    }

    E.querySelector('[data-a=x]').onclick = () => m.close();
    const del = E.querySelector('[data-a=del]');
    if (del) del.onclick = async () => {
      if (!(await PZ.confirm(`¿Quitar a ${U.esc(u.name)}? No va a poder ingresar más. Sus ventas quedan registradas.`, { danger: true, ok: 'Quitar' }))) return;
      try { await PZ.cloud.staff('delete', { user_id: u.user_id }); await reloadMembers(); m.close(); PZ.toast('Quitado del equipo'); done(); } catch (e) { PZ.toast(e.message, 'err'); }
    };
    E.querySelector('[data-a=ok]').onclick = async () => {
      if (!navigator.onLine) return PZ.toast('Hace falta conexión', 'warn');
      const isAll = allBox && allBox.checked;
      const branchIds = isAll ? [] : Array.from(E.querySelectorAll('[name=br]:checked')).map((x) => x.value);
      if (!v('name')) return PZ.toast('Falta el nombre', 'warn');
      if (!isAll && !branchIds.length) return PZ.toast('Elegí al menos una sucursal', 'warn');
      const btn = E.querySelector('[data-a=ok]');
      btn.disabled = true;
      try {
        let pass = E.querySelector('[name=pass]').value;
        const isDel = v('role') === 'delivery';
        let uname = v('username');
        if (isDel && !uname) uname = 'del.' + (PZ.carta ? PZ.carta.slugify(v('name')) : 'chofer');
        if (isDel && !pass && !u) pass = 'MuzzaReparto!' + Math.floor(1000 + Math.random() * 9000);

        if (!u) {
          if (pass.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
          await PZ.cloud.staff('create', { name: v('name'), username: uname, password: pass, role: v('role'), branch_ids: branchIds });
        } else {
          const { error } = await PZ.cloud.sb.from('members').update({ name: v('name'), role: v('role'), branch_ids: branchIds, active: E.querySelector('[name=active]').checked }).eq('org_id', S.ctx.orgId).eq('user_id', u.user_id);
          if (error) throw error;
          if (pass) await PZ.cloud.staff('password', { user_id: u.user_id, password: pass });
        }

        // Sincronizar en la sucursal actual si es delivery
        if (isDel && S.data && S.data.settings) {
          const dCode = (E.querySelector('[name=driver_code]') ? E.querySelector('[name=driver_code]').value.trim().toUpperCase() : '') || initialDriverCode;
          S.data.settings.drivers = S.data.settings.drivers || [];
          const exIdx = S.data.settings.drivers.findIndex((d) => (typeof d === 'object' ? d.name.toLowerCase() === v('name').toLowerCase() : d.toLowerCase() === v('name').toLowerCase()));
          if (exIdx >= 0) {
            S.data.settings.drivers[exIdx] = { name: v('name'), code: dCode, active: true };
          } else {
            S.data.settings.drivers.push({ name: v('name'), code: dCode, active: true });
          }
          S.save();
        }

        await reloadMembers();
        m.close();
        PZ.toast(u ? 'Guardado' : (isDel ? `Listo. Repartidor creado con código ${initialDriverCode}` : `Listo. Ingresa con “${uname.toLowerCase()}”`), 'ok', 4000);
        done();
      } catch (e) {
        PZ.toast(e.message || 'No se pudo guardar', 'err', 5000);
      } finally { btn.disabled = false; }
    };
  }

  /* =====================================================================
     Tabla de rendimiento
     ===================================================================== */
  function perfTable(people, stats, profiles = {}) {
    const rows = people.map((m) => ({ m, s: stats[m.user_id] || {} })).sort((a, b) => (b.s.sales || 0) - (a.s.sales || 0));
    const top = rows[0] && rows[0].s.sales ? rows[0].m.user_id : null;
    return `<div class="table-wrap"><table class="tbl"><thead><tr>
      <th>Persona</th><th>Rol</th><th class="right">Cobró</th><th class="right">Tickets</th><th class="right">Ticket prom.</th>
      <th class="right">Descuentos</th><th class="right">Anulaciones</th><th class="right">Dif. de caja</th><th class="right">Sueldo pagado</th><th class="right">Vende por $1 de sueldo</th><th></th></tr></thead><tbody>
      ${rows.map(({ m, s }) => `<tr class="${m.active ? '' : 'voided'}">
        <td><div class="person">${PZ.profile.avatar(profiles[m.user_id], m.name, 36)}<div><b>${m.user_id === top ? '🏆 ' : ''}${U.esc(m.name)}</b><div class="small muted">${U.esc(m.username)}${m.last_login ? ' · últ. ingreso ' + U.date(m.last_login) : ''}</div>
          ${profiles[m.user_id] ? `<div class="small">${profiles[m.user_id].phone ? `📞 <a href="https://wa.me/${U.phoneForWa(profiles[m.user_id].phone)}" target="_blank" rel="noopener">${U.esc(profiles[m.user_id].phone)}</a>` : ''}${profiles[m.user_id].cuil ? ` · CUIL ${U.formatCuil(profiles[m.user_id].cuil)}` : ''}</div>` : '<div class="small muted">⚠️ Perfil sin completar</div>'}</div></div></td>
        <td>${m.role === 'delivery' ? '<span class="badge pri">🛵 Repartidor</span>' : roleBadge(m.role)}</td>
        <td class="right"><b>${U.money(s.sales || 0)}</b></td>
        <td class="right">${s.tickets || 0}</td>
        <td class="right">${U.money(s.tickets ? s.sales / s.tickets : 0)}</td>
        <td class="right">${U.money(s.discounts || 0)}</td>
        <td class="right">${s.voids ? `<span class="badge warn">${s.voids} · ${U.money(s.voidAmount || 0)}</span>` : '0'}</td>
        <td class="right">${s.closes ? `<span class="badge ${s.absDiff ? 'err' : 'ok'}">${s.absDiff ? U.money(s.diff) : 'Sin dif.'}</span> <span class="small muted">${s.closes} cierre(s)</span>` : '—'}</td>
        <td class="right">${s.salary ? U.money(s.salary) : '—'}</td>
        <td class="right">${s.salary && s.sales ? '$' + U.num(Math.round((s.sales / s.salary) * 10) / 10) : '—'}</td>
        <td class="actions">
          ${m.role === 'delivery' ? `<button class="btn sm ghost" data-share-driver="${m.user_id}" title="Acceso para el repartidor">🛵</button>` : ''}
          ${m.role !== 'owner' && (A().isOwner() || m.role !== 'admin') && m.user_id !== A().current.id ? `<button class="btn sm ghost" data-e="${m.user_id}">✏️</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }

  const help = `<p class="small muted"><b>Cobró</b>: ventas que esa persona cobró en el período. <b>Anulaciones</b>: ventas que anuló. <b>Dif. de caja</b>: suma de sobrantes y faltantes en los cierres que hizo. <b>Sueldo pagado</b>: gastos de categoría “Sueldos” asignados a esa persona (en Gastos y ganancias).</p>`;

  /* ---------- Vista de sucursal ---------- */
  function branchView(el) {
    const bid = S.ctx.branchId;
    const people = S.ctx.members.filter((m) => inBranch(m, bid));
    const [from, to] = bounds();
    const stats = S.employeeStats(from, to);
    el.innerHTML = `
      <div class="row-flex space-between mb">
        <div class="seg">${RANGES.map(([k, l]) => `<button data-range="${k}" class="${range === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="row-flex"><button class="btn primary" data-a="code">🔑 Generar código</button><button class="btn ghost" data-a="new">➕ Crear usuario</button></div>
      </div>
      <div class="card"><h3>🧑‍🍳 Equipo de ${U.esc(S.branchName())} <span class="badge">${people.length}</span></h3><div class="perf">${perfTable(people, stats)}</div>${help}</div>
      <div class="card mt"><h3>🔑 Códigos de esta sucursal</h3><div class="inv-list"><div class="empty small">Cargando…</div></div></div>`;
    el.querySelectorAll('[data-range]').forEach((b) => b.onclick = () => { range = b.dataset.range; branchView(el); });
    el.querySelector('[data-a=code]').onclick = () => PZ.invites.create(bid, null, () => branchView(el));
    el.querySelector('[data-a=new]').onclick = () => editUser(null, () => branchView(el), { fixedBranch: bid });
    const bindEdit = () => {
      el.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => editUser(S.ctx.members.find((m) => m.user_id === b.dataset.e), () => branchView(el)));
      el.querySelectorAll('[data-share-driver]').forEach((b) => b.onclick = () => shareDriverAccess(S.ctx.members.find((m) => m.user_id === b.dataset.shareDriver)));
    };
    PZ.cloud.profiles(people.map((m) => m.user_id)).then((profs) => {
      const box = el.querySelector('.perf');
      if (!box) return;
      box.innerHTML = perfTable(people, stats, profs);
      bindEdit();
    }).catch(() => {});
    PZ.invites.renderList(el.querySelector('.inv-list'), () => branchView(el), { branchId: bid });
  }

  /* ---------- Vista del negocio ---------- */
  function orgView(el) {
    const bs = S.ctx.branches;
    el.innerHTML = `
      <div class="row-flex space-between mb">
        <div class="seg">${RANGES.map(([k, l]) => `<button data-range="${k}" class="${range === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="row-flex">
          <select class="org-branch" style="max-width:220px"><option value="">Todas las sucursales</option>${bs.map((b) => `<option value="${b.id}" ${orgBranch === b.id ? 'selected' : ''}>${U.esc(b.name)}</option>`).join('')}</select>
          <button class="btn primary" data-a="code">🔑 Generar código</button><button class="btn ghost" data-a="new">➕ Crear usuario</button>
        </div>
      </div>
      <div class="e-body"><div class="card empty"><span class="e-ico">🍕</span>Calculando el rendimiento del equipo…</div></div>
      <div class="card mt"><h3>🔑 Códigos generados</h3><div class="inv-list"><div class="empty small">Cargando…</div></div></div>`;
    el.querySelectorAll('[data-range]').forEach((b) => b.onclick = () => { range = b.dataset.range; orgView(el); });
    el.querySelector('.org-branch').onchange = (e) => { orgBranch = e.target.value; orgView(el); };
    el.querySelector('[data-a=code]').onclick = async () => {
      const bid = orgBranch || (bs.filter((b) => b.active).length === 1 ? bs.find((b) => b.active).id : await pickOne());
      if (bid) PZ.invites.create(bid, null, () => orgView(el));
    };
    el.querySelector('[data-a=new]').onclick = () => editUser(null, () => orgView(el), { fixedBranch: orgBranch });
    PZ.invites.renderList(el.querySelector('.inv-list'), () => orgView(el), { branchId: orgBranch });
    loadOrg(el);
  }

  function pickOne() {
    return new Promise((res) => {
      let chosen = null;
      const m = PZ.modal({
        title: '¿Para qué sucursal?', size: 'sm',
        body: `<div class="pick-list">${S.ctx.branches.filter((b) => b.active).map((b) => `<button class="pick" data-id="${b.id}"><span class="pick-ico">🏪</span><span><b>${U.esc(b.name)}</b></span><span class="pick-go">→</span></button>`).join('')}</div>`,
        onClose: () => res(chosen),
      });
      m.el.querySelectorAll('.pick').forEach((b) => b.onclick = () => { chosen = b.dataset.id; m.close(); });
    });
  }

  async function loadOrg(el) {
    const box = el.querySelector('.e-body');
    if (!navigator.onLine) { box.innerHTML = '<div class="card empty">Necesita conexión</div>'; return; }
    const [from, to] = bounds();
    let fin;
    try { fin = await PZ.cloud.finance(S.ctx.orgId, from, to); } catch (e) { box.innerHTML = `<div class="card empty">${U.esc(e.message)}</div>`; return; }
    if (!el.isConnected) return;
    const stats = {};
    const get = (id) => (stats[id] = stats[id] || { sales: 0, tickets: 0, discounts: 0, voids: 0, voidAmount: 0, closes: 0, absDiff: 0, diff: 0, salary: 0 });
    (fin.by_employee || []).filter((r) => !orgBranch || r.branch_id === orgBranch).forEach((r) => { if (!r.user_id) return; const s = get(r.user_id); s.sales += Number(r.sales); s.tickets += Number(r.tickets); s.discounts += Number(r.discounts); });
    (fin.voids || []).forEach((r) => { if (r.user_id) { const s = get(r.user_id); s.voids += Number(r.voids); s.voidAmount += Number(r.amount); } });
    (fin.salaries || []).forEach((r) => { if (r.user_id) get(r.user_id).salary += Number(r.amount); });
    (fin.cash_closes || []).forEach((r) => { if (r.user_id) { const s = get(r.user_id); s.closes += Number(r.closes); s.absDiff += Number(r.abs_diff); s.diff += Number(r.diff); } });
    const people = S.ctx.members.filter((m) => !orgBranch || inBranch(m, orgBranch));
    let profs = {};
    try { profs = await PZ.cloud.profiles(people.map((m) => m.user_id)); } catch (e) { /* sin perfiles */ }
    box.innerHTML = `<div class="card"><h3>🧑‍🍳 ${orgBranch ? 'Equipo de ' + U.esc(S.branchName(orgBranch)) : 'Todo el equipo'} <span class="badge">${people.length}</span></h3>
      ${perfTable(people, stats, profs)}
      <p class="small muted"><b>Sucursales:</b> ${people.map((m) => `${U.esc(m.name)} → ${U.esc(m.role === 'owner' ? 'Todas' : branchNames(m.branch_ids))}`).join(' · ')}</p>${help}</div>`;
    box.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => editUser(S.ctx.members.find((m) => m.user_id === b.dataset.e), () => orgView(el)));
    box.querySelectorAll('[data-share-driver]').forEach((b) => b.onclick = () => shareDriverAccess(S.ctx.members.find((m) => m.user_id === b.dataset.shareDriver)));
  }

  PZ.views.equipo = { title: 'Equipo de la sucursal', render: branchView };
  PZ.views['n-equipo'] = { title: 'Equipo', render: orgView };
})(window.PZ);
