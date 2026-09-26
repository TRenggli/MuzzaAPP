// @ts-check
/* ==========================================================================
   PERFIL — cada persona edita sus datos: foto, nombre completo, teléfono,
   CUIL, correo y contraseña. Teléfono y CUIL son obligatorios para quien
   trabaja en una sucursal.
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  const A = () => PZ.auth;

  /** Recorta al centro y achica la foto a 256×256 (JPEG) */
  async function squareJpeg(file, size = 256) {
    const img = await U.loadImage(await U.readFileAsDataURL(file));
    const side = Math.min(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  }

  const P = (PZ.profile = {
    /** perfil de quien usa este equipo (foto, teléfono, CUIL, email)
     * @type {{ user_id?: string, full_name?: string, phone?: string, cuil?: string, email?: string, avatar_url?: string | null } | null} */
    me: null,

    async load() {
      try { P.me = await PZ.cloud.myProfile(); } catch (e) { P.me = P.me || null; }
      return P.me;
    },

    /** Foto o inicial con color */
    avatar(profile, name = '', size = 32) {
      const url = profile && profile.avatar_url;
      const letter = U.esc((name || '?').trim()[0] || '?').toUpperCase();
      return url
        ? `<span class="avatar img" style="width:${size}px;height:${size}px"><img src="${U.esc(url)}" alt="" loading="lazy"></span>`
        : `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${letter}</span>`;
    },

    missing(p) {
      const out = [];
      if (!p || !String(p.full_name || '').trim()) out.push('nombre completo');
      if (!p || String(p.phone || '').replace(/\D/g, '').length < 8) out.push('teléfono');
      if (!p || !U.validCuil(p.cuil)) out.push('CUIL');
      return out;
    },

    /** Al ingresar: si trabaja en un negocio y le faltan datos, se los pide */
    async ensureComplete() {
      if (A().platform || !A().current || A().current.support || !navigator.onLine) return;
      const p = await P.load();
      if (p && !P.missing(p).length) return;
      P.open({ required: true });
    },

    open({ required = false } = {}) {
      /** @type {NonNullable<typeof P.me>} */
      const p = P.me || {};
      const u = A().current;
      const name = (u && !u.support && u.name) || (A().me && A().me.user_metadata && A().me.user_metadata.name) || '';
      const loginIsEmail = A().me && !(A().me.email || '').endsWith('@' + window.PZ_CONFIG.staffDomain);
      const where = u && !u.support
        ? `${A().ROLES[u.role].label} · ${U.esc(S.ctx.org ? S.ctx.org.name : '')} · ${u.role === 'owner' || !u.branchIds.length ? 'todas las sucursales' : u.branchIds.map((id) => U.esc(S.branchName(id))).join(', ')}`
        : 'Administración de la plataforma';
      const m = PZ.modal({
        title: required ? '👋 Completá tu perfil' : '👤 Mi perfil',
        dismissable: !required,
        body: `
          ${required ? `<div class="alert-row">Antes de empezar necesitamos tus datos. Faltan: <b>${P.missing(p).join(', ')}</b>.</div>` : ''}
          <div class="profile-head">
            <div class="ph-avatar">${P.avatar(p, p.full_name || name, 84)}</div>
            <div>
              <b style="font-size:1.1em">${U.esc(p.full_name || name)}</b>
              <div class="small muted">${where}</div>
              <div class="row-flex mt" style="gap:6px">
                <label class="btn sm ghost">📷 ${p.avatar_url ? 'Cambiar foto' : 'Subir foto'}<input type="file" accept="image/*" data-a="photo" hidden></label>
                ${p.avatar_url ? '<button class="btn sm ghost" data-a="rmphoto">Quitar</button>' : ''}
              </div>
            </div>
          </div>
          <div class="grid-2 mt">
            <label class="field"><span>Nombre y apellido completo *</span><input name="full_name" value="${U.esc(p.full_name || name)}" autocomplete="name"></label>
            <label class="field"><span>Teléfono / WhatsApp *</span><input name="phone" value="${U.esc(p.phone || '')}" inputmode="tel" autocomplete="tel" placeholder="11 5555-1234"></label>
            <label class="field"><span>CUIL *</span><input name="cuil" value="${U.esc(p.cuil ? U.formatCuil(p.cuil) : '')}" inputmode="numeric" placeholder="20-12345678-9" maxlength="13"><small class="cuil-hint muted"></small></label>
            <div></div>
          </div>
          <button class="btn primary block" data-a="save">💾 Guardar mis datos</button>
          ${required ? '' : `
          <div class="opt-section">Correo</div>
          <div class="row-flex"><input name="email" type="email" class="grow" value="${U.esc(p.email || (loginIsEmail ? A().me.email : '') || '')}" placeholder="tu@correo.com" autocomplete="email"><button class="btn ghost" data-a="email">Guardar correo</button></div>
          <p class="small muted">${loginIsEmail ? 'Es el correo con el que ingresás: si lo cambiás, vas a ingresar con el nuevo.' : `Ingresás con tu usuario <b>${U.esc(u ? u.username : '')}</b>. El correo queda como contacto.`}</p>
          <div class="opt-section">Contraseña</div>
          <div class="grid-2"><input name="p1" type="password" placeholder="Nueva contraseña (mínimo 8)" autocomplete="new-password"><input name="p2" type="password" placeholder="Repetila" autocomplete="new-password"></div>
          <button class="btn ghost mt" data-a="pass">🔑 Cambiar contraseña</button>`}`,
        footer: required ? '<button class="btn ghost" data-a="out">Salir</button>' : '',
      });
      const E = m.el;
      const v = (n) => (E.querySelector(`[name=${n}]`) || {}).value || '';
      const cuil = E.querySelector('[name=cuil]');
      const hint = E.querySelector('.cuil-hint');
      cuil.addEventListener('input', () => {
        const d = U.cuilDigits(cuil.value).slice(0, 11);
        cuil.value = d.length > 10 ? U.formatCuil(d) : d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d;
        hint.textContent = d.length === 11 ? (U.validCuil(d) ? '✓ CUIL válido' : '✗ El dígito verificador no coincide') : '';
        hint.style.color = d.length === 11 && U.validCuil(d) ? 'var(--ok)' : 'var(--err)';
      });
      cuil.dispatchEvent(new Event('input'));

      const on = (a, fn) => { const b = E.querySelector(`[data-a=${a}]`); if (b) b.onclick = fn; };
      on('out', () => { m.close(); PZ.app.logout(); });
      on('save', async () => {
        const data = { full_name: v('full_name').trim(), phone: v('phone').trim(), cuil: U.cuilDigits(v('cuil')) };
        const miss = P.missing(data);
        if (miss.length) return PZ.toast('Revisá: ' + miss.join(', '), 'warn');
        try {
          await PZ.cloud.saveProfile(data);
          P.me = { ...P.me, ...data };
          PZ.toast('Datos guardados');
          m.close();
          PZ.app.refreshAvatar();
        } catch (e) { PZ.toast(e.message, 'err'); }
      });
      const photo = E.querySelector('[data-a=photo]');
      photo.onchange = async () => {
        const f = photo.files[0];
        if (!f) return;
        try {
          PZ.toast('Subiendo foto…', 'info');
          const url = await PZ.cloud.uploadAvatar(await squareJpeg(f));
          await PZ.cloud.saveProfile({ avatar_url: url });
          P.me = { ...P.me, avatar_url: url };
          E.querySelector('.ph-avatar').innerHTML = P.avatar(P.me, name, 84);
          PZ.app.refreshAvatar();
          PZ.toast('Foto actualizada');
        } catch (e) { PZ.toast(e.message || 'No se pudo subir la foto', 'err'); }
      };
      on('rmphoto', async () => {
        await PZ.cloud.saveProfile({ avatar_url: null });
        P.me = { ...P.me, avatar_url: null };
        E.querySelector('.ph-avatar').innerHTML = P.avatar(P.me, name, 84);
        PZ.app.refreshAvatar();
      });
      on('email', async () => {
        try {
          const r = await PZ.cloud.changeEmail(v('email'));
          P.me = { ...P.me, email: v('email').trim().toLowerCase() };
          PZ.toast(r.login ? `Listo. Desde ahora ingresás con ${r.login}` : 'Correo guardado', 'ok', 4500);
        } catch (e) { PZ.toast(e.message, 'err'); }
      });
      on('pass', async () => {
        if (v('p1').length < 8) return PZ.toast('Mínimo 8 caracteres', 'warn');
        if (v('p1') !== v('p2')) return PZ.toast('Las contraseñas no coinciden', 'warn');
        try { await PZ.cloud.updateMyPassword(v('p1')); PZ.toast('Contraseña actualizada'); E.querySelector('[name=p1]').value = E.querySelector('[name=p2]').value = ''; } catch (e) { PZ.toast(e.message, 'err'); }
      });
    },
  });
})(window.PZ);
