// @ts-check
/* ==========================================================================
   Vista: CARTA ONLINE — la carta que ven los clientes en el celular
     · publicar, dirección (link y QR), WhatsApp que recibe los pedidos, horario
     · diseño: colores, letra, logo, portada y fotos de productos
     · vista previa en vivo (y "ver como cliente" en otra pestaña)
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  const C = PZ.carta;
  let tab = 'publicar';
  const previews = new Set();   // ventanas de vista previa abiertas
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let sendTimer;

  const TABS = [['publicar', '📣 Publicar'], ['diseno', '🎨 Diseño'], ['pedidos', '🧾 Pedidos y pagos'], ['productos', '🍕 Productos y fotos']];

  /** Completa lo que falte SIN reemplazar el objeto (los campos del panel escriben sobre él) */
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  function fillDefaults(target, def) {
    Object.keys(def).forEach((k) => {
      if (target[k] === undefined) target[k] = def[k];
      else if (isObj(def[k]) && isObj(target[k])) fillDefaults(target[k], def[k]);
    });
    return target;
  }
  /** Configuración de la carta de esta sucursal (siempre el mismo objeto) */
  function cfg() {
    const st = S.data.settings;
    if (!isObj(st.online)) st.online = C.defaults();
    return fillDefaults(st.online, C.defaults());
  }
  const branch = () => S.branch() || {};
  const slug = () => branch().slug || '';
  const publicUrl = () => (slug() ? C.cartaUrl(location.origin + location.pathname, slug()) : '');

  /** La carta armada con los datos de este equipo (igual a lo que devuelve la base) */
  function localMenu() {
    const st = S.data.settings;
    const o = cfg();
    const b = st.business || {};
    const prods = S.data.products.filter((p) => p.active && p.online !== false && p.variants.length);
    return {
      branch: { id: S.ctx.branchId, name: branch().name || '', slug: slug() || null, org: S.ctx.org ? S.ctx.org.name : '' },
      settings: {
        business: { name: b.name, slogan: b.slogan, address: b.address, city: b.city, phone: b.phone, instagram: b.instagram },
        online: o,
        halfPricing: st.halfPricing || 'max',
        zones: PZ.auth.feature('delivery') ? st.zones.map((z) => ({ id: z.id, name: z.name, fee: Number(z.fee) || 0 })) : [],
        transfer: o.payments.transferencia ? { alias: st.payments.alias, cbu: st.payments.cbu, holder: st.payments.holder, bank: st.payments.bank } : null,
        logo: o.logo || (st.ticket.showLogo !== false ? st.ticket.logo : null),
      },
      open: C.isOpen(o),
      categories: S.data.categories.filter((c) => prods.some((p) => p.categoryId === c.id)).map((c) => ({ id: c.id, name: c.name, icon: c.icon, allowHalf: !!c.allowHalf })),
      products: prods.map((p) => ({
        id: p.id, categoryId: p.categoryId, name: p.name, desc: p.desc || '', color: p.color, photo: p.photo || '', ...(p.photoPos ? { photoPos: p.photoPos } : {}), active: true,
        allowHalf: p.allowHalf !== false, ...(Array.isArray(p.halfWith) ? { halfWith: p.halfWith } : {}),
        variants: p.variants.map((v) => ({ id: v.id, name: v.name, price: Number(v.price) || 0 })),
      })),
      extras: S.data.extras.map((x) => ({ id: x.id, name: x.name, price: Number(x.price) || 0 })),
    };
  }

  /** Manda la carta a las vistas previas abiertas */
  function sendPreview() {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      const menu = localMenu();
      previews.forEach((w) => { try { w.postMessage({ type: 'pz-carta-preview', menu }, location.origin); } catch (e) { previews.delete(w); } });
    }, 120);
  }
  function onMessage(e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'pz-carta-ready' || !e.source) return;
    previews.add(e.source);
    sendPreview();
  }

  const changed = (rerender) => { S.save(); sendPreview(); if (rerender) rerender(); };

  /** Requisitos para publicar @returns {[boolean, string][]} */
  function checks() {
    const o = cfg();
    const visible = S.data.products.filter((p) => p.active && p.online !== false).length;
    return [
      [!!slug(), 'Elegí la dirección de la carta'],
      [!!C.waNumber(o.whatsapp), 'Cargá el WhatsApp que recibe los pedidos'],
      [Object.values(o.types).some(Boolean), 'Elegí al menos una forma de pedir (retiro, delivery o mesa)'],
      [Object.values(o.payments).some(Boolean), 'Elegí al menos un medio de pago'],
      [visible > 0, `Tener productos visibles en la carta (${visible})`],
    ];
  }

  /* ======================= Render ======================= */
  function render(el) {
    const o = cfg();
    const web = PZ.web ? PZ.web.all() : [];
    const today = web.filter((w) => new Date(w.created_at).getTime() >= U.startOfDay().getTime());
    el.innerHTML = `
      <div class="carta-admin">
        <div class="ca-main">
          <div class="kpis mb">
            <div class="kpi"><div class="k-label">Estado</div><div class="k-value" style="font-size:1.2em">${o.enabled ? (C.isOpen(o) ? '🟢 Abierta' : o.paused ? '⏸️ Pausada' : '🌙 Cerrada') : '⚪ Sin publicar'}</div></div>
            <div class="kpi"><div class="k-label">Pedidos web hoy</div><div class="k-value">${today.length}</div></div>
            <div class="kpi"><div class="k-label">Por confirmar</div><div class="k-value">${PZ.web ? PZ.web.pending().length : 0}</div></div>
          </div>
          <div class="row-flex mb" style="gap:8px">
            <button class="btn ghost sm" data-a="mprev">👀 Vista previa</button>
            ${o.enabled && slug() ? '<button class="btn ghost sm" data-a="view">🔗 Abrir la carta publicada</button>' : ''}
            ${PZ.web && PZ.web.pending().length ? '<a class="btn primary sm" href="#/pedidos">📲 Ver pedidos por confirmar</a>' : ''}
          </div>
          <div class="tabs-nav">${TABS.map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <div class="tab-body"></div>
        </div>
        <aside class="ca-preview">
          <div class="phone-frame"><iframe title="Vista previa de la carta" src="carta.html?preview=1"></iframe></div>
          <p class="center small muted">Vista previa en vivo · probá tocar productos</p>
        </aside>
      </div>`;
    el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; render(el); });
    el.querySelector('[data-a=mprev]').onclick = () => previewModal();
    const v = el.querySelector('[data-a=view]');
    if (v) v.onclick = () => window.open(publicUrl(), '_blank', 'noopener');
    SECTIONS[tab](el.querySelector('.tab-body'), () => render(el));
  }

  /** Enlaza inputs con data-x="ruta" dentro de la config de la carta */
  function bindX(root, rerender) {
    const o = cfg();
    root.querySelectorAll('[data-x]').forEach((inp) => {
      const path = inp.dataset.x.split('.');
      const get = () => path.reduce((a, k) => (a ? a[k] : undefined), o);
      const set = (val) => { let a = o; path.slice(0, -1).forEach((k) => { a = a[k]; }); a[path[path.length - 1]] = val; };
      const cur = get();
      if (inp.type === 'checkbox') inp.checked = !!cur; else inp.value = cur ?? '';
      const instant = inp.type === 'checkbox' || inp.type === 'time' || inp.tagName === 'SELECT';
      inp.addEventListener(instant ? 'change' : 'input', U.debounce(() => {
        let val = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (inp.dataset.num !== undefined) val = U.parseMoney(val);
        if (path[0] === 'enabled' && val) {
          const miss = checks().filter(([ok]) => !ok);
          if (miss.length) { inp.checked = false; return PZ.toast('Para publicar falta: ' + miss[0][1].toLowerCase(), 'warn', 4500); }
        }
        set(val);
        changed(inp.dataset.rerender !== undefined ? rerender : null);
      }, instant ? 0 : 350));
    });
  }

  const sw = (path, extra = '') => `<label class="switch"><input type="checkbox" data-x="${path}" ${extra}><i></i></label>`;

  const SECTIONS = {
    /* ---------------- Publicar ---------------- */
    publicar(b, rerender) {
      const o = cfg();
      const req = checks();
      const url = publicUrl();
      const suggested = C.slugify(`${S.data.settings.business.name || ''} ${branch().name || ''}`);
      const wa = C.waNumber(o.whatsapp);
      b.innerHTML = `
        <div class="card">
          <div class="big-switch ${o.enabled ? 'on' : ''}"><span>${o.enabled ? '🟢 Carta publicada' : '⚪ Carta sin publicar'}<small class="muted" style="display:block;font-weight:700;font-size:.78em">${o.enabled ? 'Los clientes ya pueden ver la carta y pedir.' : 'Nadie la ve hasta que la publiques.'}</small></span>${sw('enabled', 'data-rerender')}</div>
          <ul class="req-list">${req.map(([ok, t]) => `<li class="${ok ? '' : 'no'}">${ok ? '✅' : '⬜'} ${U.esc(t)}</li>`).join('')}</ul>
        </div>

        <div class="card mt"><h3>🔗 Dirección de tu carta</h3>
          <div class="slug-row"><span title="${U.esc(location.origin + location.pathname.replace(/[^/]*$/, ''))}">…/carta.html?l=</span><input class="slug" value="${U.esc(slug() || suggested)}" maxlength="40" autocapitalize="off" autocomplete="off" spellcheck="false" aria-label="Dirección"></div>
          <div class="row-flex mt"><button class="btn primary sm" data-a="slug">${slug() ? 'Cambiar dirección' : 'Guardar dirección'}</button><span class="small muted">Solo minúsculas, números y guiones.${slug() ? ' Si la cambiás, el link y los QR viejos dejan de andar.' : ''}</span></div>
          ${url ? `<div class="carta-link mt"><span>🔗</span><a href="${U.esc(url)}" target="_blank" rel="noopener">${U.esc(url)}</a></div>
            <div class="row-flex mt" style="gap:6px">
              <button class="btn ghost sm" data-a="copy">📋 Copiar link</button>
              <button class="btn ghost sm" data-a="share">💬 Compartir por WhatsApp</button>
              <button class="btn ghost sm" data-a="qr">🔳 QR para imprimir</button>
              ${o.types.mesa ? '<button class="btn ghost sm" data-a="tables">🍽️ QR por mesa</button>' : ''}
            </div>` : ''}
        </div>

        <div class="card mt"><h3>💬 WhatsApp que recibe los pedidos</h3>
          <p class="muted small" style="margin-top:0">El celular de quien atiende. Cada cliente manda su pedido a este número (además, el pedido aparece en <b>Pedidos</b>).</p>
          <label class="field"><span>Número con característica</span><input data-x="whatsapp" inputmode="tel" placeholder="Ej: 11 5555-1234" autocomplete="off"></label>
          <div class="row-flex small wa-check">${wa ? `✅ Se usa <b>+${wa.slice(0, 2)} ${wa.slice(2, 3)} ${wa.slice(3)}</b> <button class="btn ghost sm" data-a="watest">Probar</button>` : '<span class="muted">Escribí el número y te mostramos cómo queda.</span>'}</div>
        </div>

        <div class="card mt"><h3>🕒 Cuándo se puede pedir</h3>
          <div class="big-switch ${o.paused ? 'on' : ''}" style="font-size:.95em"><span>⏸️ Pausar pedidos<small class="muted" style="display:block;font-weight:700;font-size:.8em">Para una noche con mucha demora. La carta se sigue viendo.</small></span>${sw('paused', 'data-rerender')}</div>
          <div class="seg mt"><button data-hm="always" class="${o.hours.mode !== 'schedule' ? 'on' : ''}">Siempre</button><button data-hm="schedule" class="${o.hours.mode === 'schedule' ? 'on' : ''}">En un horario</button></div>
          ${o.hours.mode === 'schedule' ? `
            <div class="opt-section">Días</div>
            <div class="day-chips">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button data-day="${d}" class="${o.hours.days.includes(d) ? 'on' : ''}">${C.DAYS[d]}</button>`).join('')}</div>
            <div class="grid-2 mt">
              <label class="field"><span>Desde</span><input type="time" data-x="hours.from" data-rerender></label>
              <label class="field"><span>Hasta</span><input type="time" data-x="hours.to" data-rerender></label>
            </div>
            <p class="small muted">Si cerrás después de medianoche (ej. 19:00 a 01:00) también funciona. Ahora: <b>${C.isOpen(o) ? 'abierta' : 'cerrada'}</b>.</p>` : ''}
        </div>`;
      bindX(b, rerender);
      const on = (a, fn) => { const x = b.querySelector(`[data-a=${a}]`); if (x) x.onclick = fn; };
      const waBox = b.querySelector('[data-x=whatsapp]');
      waBox.addEventListener('input', U.debounce(() => {
        const n = C.waNumber(waBox.value);
        b.querySelector('.wa-check').innerHTML = n ? `✅ Se usa <b>+${n.slice(0, 2)} ${n.slice(2, 3)} ${n.slice(3)}</b> <button class="btn ghost sm" data-a="watest">Probar</button>` : '<span class="muted">Revisá el número: tiene que tener característica (ej. 11, 351, 3624).</span>';
        on('watest', () => window.open(C.waLink(waBox.value, 'Prueba de la carta online 🍕'), '_blank', 'noopener'));
      }, 400));
      on('watest', () => window.open(C.waLink(cfg().whatsapp, 'Prueba de la carta online 🍕'), '_blank', 'noopener'));
      on('slug', async () => {
        const v = b.querySelector('.slug').value.trim().toLowerCase();
        if (!C.validSlug(v)) return PZ.toast('Usá de 3 a 40 letras minúsculas, números o guiones (sin espacios ni tildes)', 'warn', 4500);
        if (v === slug()) return PZ.toast('Esa ya es la dirección');
        if (slug() && !(await PZ.confirm('Si cambiás la dirección, el link y los QR que ya repartiste dejan de funcionar. ¿Cambiar igual?'))) return;
        try {
          await PZ.cloud.setSlug(S.ctx.branchId, v);
          branch().slug = v;
          PZ.toast('Dirección guardada');
          sendPreview();
          rerender();
        } catch (e) { PZ.toast(e.message, 'err', 5000); }
      });
      b.querySelector('.slug').addEventListener('input', (e) => { e.target.value = e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''); });
      on('copy', async () => { try { await navigator.clipboard.writeText(url); PZ.toast('Link copiado'); } catch (e) { PZ.toast('No se pudo copiar', 'warn'); } });
      on('share', () => window.open(`https://wa.me/?text=${encodeURIComponent(`¡Mirá nuestra carta y pedí online! 🍕\n${url}`)}`, '_blank', 'noopener'));
      on('qr', () => qrPoster());
      on('tables', () => tableQrs());
      b.querySelectorAll('[data-hm]').forEach((x) => x.onclick = () => { cfg().hours.mode = x.dataset.hm; changed(rerender); });
      b.querySelectorAll('[data-day]').forEach((x) => x.onclick = () => {
        const d = Number(x.dataset.day);
        const h = cfg().hours;
        h.days = h.days.includes(d) ? h.days.filter((y) => y !== d) : h.days.concat(d).sort();
        changed(rerender);
      });
    },

    /* ---------------- Diseño ---------------- */
    diseno(b, rerender) {
      const o = cfg();
      const t = o.theme;
      b.innerHTML = `
        <div class="card"><h3>🎨 Estilo listo para usar</h3>
          <div class="carta-theme">${C.THEMES.map((x) => `<button data-th="${x.id}" class="${t.preset === x.id ? 'on' : ''}" style="background:${x.bg};color:${x.dark ? '#f7efe6' : '#1d1b19'}"><div class="sw"><i style="background:${x.primary}"></i><i style="background:${x.accent}"></i><i style="background:${x.bg}"></i></div>${U.esc(x.name)}</button>`).join('')}</div>
          <div class="opt-section">O elegí cada color</div>
          <div class="color-row">
            <label>Principal<input type="color" data-c="primary" value="${U.esc(t.primary)}"></label>
            <label>Detalles<input type="color" data-c="accent" value="${U.esc(t.accent)}"></label>
            <label>Fondo<input type="color" data-c="bg" value="${U.esc(t.bg)}"></label>
          </div>
          <p class="small muted">El color de las letras se ajusta solo para que siempre se lea bien.</p>
          <div class="grid-2 mt">
            <label class="field"><span>Letra</span><select data-x="theme.font">${Object.entries(C.FONTS).map(([k, f]) => `<option value="${k}">${U.esc(f.name)}</option>`).join('')}</select></label>
            <label class="field"><span>Productos</span><select data-x="theme.layout"><option value="grilla">En grilla (fotos grandes)</option><option value="lista">En lista (compacta)</option></select></label>
          </div>
          <label class="check"><input type="checkbox" data-x="showPhotos"> Mostrar las fotos de los productos</label>
        </div>

        <div class="card mt"><h3>🖼️ Logo y portada</h3>
          <div class="img-slot"><div class="img-prev round" style="${o.logo ? `background-image:url('${U.esc(o.logo)}')` : ''}">${o.logo ? '' : '🍕'}</div>
            <div><b>Logo</b><div class="small muted">Cuadrado, se ve redondo. ${!o.logo && S.data.settings.ticket.logo ? 'Si no subís uno se usa el del ticket.' : ''}</div>
              <div class="row-flex mt" style="gap:6px"><label class="btn ghost sm">📷 Subir logo<input type="file" accept="image/*" data-up="logo" hidden></label>${o.logo ? '<button class="btn ghost sm" data-rm="logo">Quitar</button>' : ''}</div></div></div>
          <div class="img-slot mt"><div class="img-prev" style="${o.cover ? `background-image:url('${U.esc(o.cover)}')` : `background:${U.esc(t.primary)}`}"></div>
            <div><b>Portada</b><div class="small muted">Una foto horizontal del local o de una pizza. Sin portada se usa el color principal.</div>
              <div class="row-flex mt" style="gap:6px"><label class="btn ghost sm">📷 Subir portada<input type="file" accept="image/*" data-up="cover" hidden></label>${o.cover ? '<button class="btn ghost sm" data-rm="cover">Quitar</button>' : ''}</div></div></div>
        </div>

        <div class="card mt"><h3>👋 Mensaje de bienvenida</h3>
          <label class="field"><span>Aparece arriba de la carta</span><input data-x="welcome" maxlength="140" placeholder="Ej: ¡Pizza a la piedra desde 1998! Hacé tu pedido 🍕"></label>
        </div>`;
      bindX(b, rerender);
      b.querySelectorAll('[data-th]').forEach((x) => x.onclick = () => {
        const th = C.THEMES.find((y) => y.id === x.dataset.th);
        Object.assign(cfg().theme, { preset: th.id, primary: th.primary, accent: th.accent, bg: th.bg, dark: th.dark });
        changed(rerender);
      });
      b.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('input', U.debounce(() => {
        const th = cfg().theme;
        th[x.dataset.c] = x.value;
        th.preset = 'propio';
        b.querySelectorAll('[data-th]').forEach((y) => y.classList.remove('on'));
        changed();
      }, 150)));
      b.querySelectorAll('[data-up]').forEach((x) => x.onchange = async () => {
        const f = x.files[0];
        if (!f) return;
        const kind = x.dataset.up;
        try {
          PZ.toast('Subiendo foto…', 'info', 1500);
          const blob = await U.imageBlob(f, kind === 'cover' ? 1400 : 400, 0.84);
          cfg()[kind] = await PZ.cloud.uploadMenuImage(blob, kind);
          changed(rerender);
          PZ.toast('Listo');
        } catch (e) { PZ.toast('No se pudo subir: ' + e.message, 'err', 5000); }
      });
      b.querySelectorAll('[data-rm]').forEach((x) => x.onclick = () => { cfg()[x.dataset.rm] = ''; changed(rerender); });
    },

    /* ---------------- Pedidos y pagos ---------------- */
    pedidos(b, rerender) {
      const o = cfg();
      const st = S.data.settings;
      const del = PZ.auth.feature('delivery');
      const mesas = PZ.auth.feature('mesas');
      b.innerHTML = `
        <div class="card"><h3>🧾 ¿Cómo pueden pedir?</h3>
          <label class="check"><input type="checkbox" data-x="types.retiro" data-rerender> 🥡 Retiro en el local</label>
          ${del ? '<label class="check"><input type="checkbox" data-x="types.delivery" data-rerender> 🛵 Delivery</label>' : ''}
          ${mesas ? '<label class="check"><input type="checkbox" data-x="types.mesa" data-rerender> 🍽️ Desde la mesa (con un QR en cada mesa)</label>' : ''}
          ${del && o.types.delivery ? `<div class="opt-section">Zonas de envío</div>
            ${st.zones.length ? `<div class="bank-box">${st.zones.map((z) => `<div class="bk-row"><span>${U.esc(z.name)}</span><b>${U.money(z.fee)}</b></div>`).join('')}</div>` : '<p class="small muted">Sin zonas: el costo de envío se arregla por WhatsApp.</p>'}
            <a class="btn ghost sm mt" href="#/config" data-a="zones">✏️ Editar zonas</a>` : ''}
        </div>
        <div class="card mt"><h3>💳 ¿Cómo pueden pagar?</h3>
          <p class="muted small" style="margin-top:0">El cliente avisa cómo va a pagar. El cobro se registra al entregar, como cualquier pedido.</p>
          <label class="check"><input type="checkbox" data-x="payments.efectivo" data-rerender> 💵 Efectivo (le preguntamos con cuánto paga)</label>
          <label class="check"><input type="checkbox" data-x="payments.transferencia" data-rerender> 🏦 Transferencia</label>
          ${o.payments.transferencia && !(st.payments.alias || st.payments.cbu) ? '<div class="alert-row">⚠️ Cargá el alias o CBU en Configuración → Cobros para mostrárselo al cliente.</div>' : ''}
          <label class="check"><input type="checkbox" data-x="payments.tarjeta" data-rerender> 💳 Tarjeta al recibir o retirar (posnet)</label>
        </div>
        <div class="card mt"><h3>📏 Pedido mínimo</h3>
          <label class="field" style="max-width:260px"><span>Monto mínimo (0 = sin mínimo)</span><input data-x="minOrder" data-num inputmode="numeric"></label>
        </div>
        <div class="card mt"><h3>⏱️ Demoras estimadas</h3>
          <p class="muted small" style="margin-top:0">Se muestran en los distintivos de la carta y en la confirmación por WhatsApp.</p>
          <div class="grid-2">
            <label class="field"><span>🥡 Retiro en local (minutos)</span><input data-x="pickupMinutes" data-num inputmode="numeric" placeholder="15"></label>
            <label class="field"><span>🛵 Delivery (minutos)</span><input data-x="deliveryMinutes" data-num inputmode="numeric" placeholder="40"></label>
          </div>
        </div>
        <div class="card mt"><h3>📍 Datos pedidos al cliente en Delivery</h3>
          <p class="muted small" style="margin-top:0">Elegí qué campos adicionales solicitarle al cliente al pedir envío a domicilio.</p>
          <label class="check"><input type="checkbox" data-x="deliveryFields.separateAddress" data-rerender> Separar dirección en calle y número</label>
          <label class="check"><input type="checkbox" data-x="deliveryFields.floorDept" data-rerender> Piso / Departamento</label>
          <label class="check"><input type="checkbox" data-x="deliveryFields.crossStreets" data-rerender> Entre qué calles</label>
          <label class="check"><input type="checkbox" data-x="deliveryFields.notes" data-rerender> Observaciones de entrega (timbre, portón, etc.)</label>
        </div>`;
      bindX(b, rerender);
      const z = b.querySelector('[data-a=zones]');
      if (z) z.onclick = () => { PZ.configTab = 'delivery'; };
    },

    /* ---------------- Productos y fotos ---------------- */
    productos(b, rerender) {
      b.innerHTML = `<p class="muted" style="margin-top:0">Elegí qué se ve en la carta y agregá fotos: los productos con foto se piden mucho más 😋. Los <b>agotados</b> no se muestran.</p>
        ${S.data.categories.map((c) => {
          const ps = S.data.products.filter((p) => p.categoryId === c.id);
          if (!ps.length) return '';
          return `<div class="card mb"><h3>${c.icon} ${U.esc(c.name)}</h3>
            ${ps.map((p) => `<div class="list-row">
              <div class="thumb">${PZ.carta.pic(p, c.icon)}</div>
              <div class="grow"><b>${U.esc(p.name)}</b>${p.active ? '' : ' <span class="badge warn">Agotado</span>'}<div class="small muted">${p.variants.map((v) => `${U.esc(v.name)} ${U.money(v.price)}`).join(' · ')}</div></div>
              <button class="btn ghost sm" data-pl="${p.id}" title="Pegar el link de una foto">🔗</button>
              <label class="btn ghost sm" title="Subir una foto">📷<input type="file" accept="image/*" data-ph="${p.id}" hidden></label>
              ${p.photo ? `<button class="btn ghost sm" data-rp="${p.id}" title="Quitar foto">🗑️</button>` : ''}
              <label class="switch" title="Mostrar en la carta"><input type="checkbox" data-on="${p.id}" ${p.online !== false ? 'checked' : ''}><i></i></label>
            </div>`).join('')}
          </div>`;
        }).join('')}`;
      b.querySelectorAll('[data-on]').forEach((x) => x.onchange = () => { S.product(x.dataset.on).online = x.checked; changed(); });
      b.querySelectorAll('[data-rp]').forEach((x) => x.onclick = () => { const p = S.product(x.dataset.rp); p.photo = ''; delete p.photoPos; changed(rerender); });
      b.querySelectorAll('[data-pl]').forEach((x) => x.onclick = async () => {
        const p = S.product(x.dataset.pl);
        const raw = await PZ.prompt('Link de la imagen (https://…). Sirven links compartidos de Google Drive o Dropbox si son públicos.', { title: `🔗 Foto de ${U.esc(p.name)}`, value: p.photo || '', type: 'url' });
        if (raw == null) return;
        const url = PZ.carta.imageUrl(raw);
        if (raw.trim() && !url) return PZ.toast('Eso no es un link de imagen (tiene que empezar con https://)', 'warn', 5000);
        const ok = !url || await new Promise((res) => { const i = new Image(); i.referrerPolicy = 'no-referrer'; i.onload = () => res(true); i.onerror = () => res(false); i.src = url; });
        if (!ok && !(await PZ.confirm('No se pudo abrir esa imagen (¿el link es público?). Mientras no cargue se verá el ícono. ¿Guardarla igual?', { ok: 'Guardar igual' }))) return;
        p.photo = url;
        if (!url) delete p.photoPos;
        S.log('menú', `Foto de ${p.name}`);
        changed(rerender);
        PZ.toast(url ? 'Foto guardada' : 'Foto quitada');
      });
      b.querySelectorAll('[data-ph]').forEach((x) => x.onchange = async () => {
        const f = x.files[0];
        if (!f) return;
        try {
          PZ.toast('Subiendo foto…', 'info', 1500);
          const p = S.product(x.dataset.ph);
          p.photo = await PZ.cloud.uploadMenuImage(await U.imageBlob(f, 900, 0.82), 'p-' + p.id);
          S.log('menú', `Foto de ${p.name}`);
          changed(rerender);
          PZ.toast('Foto lista');
        } catch (e) { PZ.toast('No se pudo subir: ' + e.message, 'err', 5000); }
      });
    },
  };

  /* ======================= Vista previa en ventana ======================= */
  function previewModal() {
    PZ.modal({
      title: '👀 Así la ven tus clientes',
      body: '<div class="phone-frame"><iframe title="Vista previa de la carta" src="carta.html?preview=1"></iframe></div>',
    });
  }

  /* ======================= QR para imprimir ======================= */
  function printPage(title, inner) {
    const w = window.open('', '_blank');
    if (!w) return PZ.toast('Permití las ventanas emergentes para imprimir', 'warn');
    const t = cfg().theme;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${U.esc(title)}</title>
      <style>
        body{margin:0;font-family:system-ui,sans-serif;color:#1d1b19}
        .poster{width:100%;max-width:560px;margin:24px auto;text-align:center;border:10px solid ${t.primary};border-radius:28px;padding:28px}
        .poster h1{margin:0 0 4px;font-size:34px;color:${t.primary}} .poster p{margin:6px 0;font-size:20px;font-weight:700}
        .poster svg{width:320px;height:320px} .poster small{display:block;margin-top:8px;color:#666;word-break:break-all}
        .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;padding:14px}
        .tq{border:6px solid ${t.primary};border-radius:18px;padding:12px;text-align:center;break-inside:avoid}
        .tq b{font-size:22px;color:${t.primary}} .tq svg{width:200px;height:200px}
        @media print{.poster{margin:0 auto}}
      </style></head><body>${inner}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 450);
  }

  function qrPoster() {
    const url = publicUrl();
    const name = S.data.settings.business.name || '';
    const m = PZ.modal({
      title: '🔳 QR de la carta',
      size: 'sm',
      body: `<div class="qr-box"><div class="qr-frame">${U.qrSvg(url, 6, 1)}</div><b>${U.esc(name)}</b><span class="small muted">Pegalo en la vidriera, el mostrador o las cajas de pizza.</span></div>`,
      footer: '<button class="btn ghost" data-a="x">Cerrar</button><button class="btn primary" data-a="p">🖨️ Imprimir cartel</button>',
    });
    m.el.querySelector('[data-a=x]').onclick = () => m.close();
    m.el.querySelector('[data-a=p]').onclick = () => printPage(`QR ${name}`, `<div class="poster"><h1>${U.esc(name)}</h1><p>📱 Escaneá y pedí online</p>${U.qrSvg(url, 8, 1)}<p>Te llega la confirmación por WhatsApp</p><small>${U.esc(url)}</small></div>`);
  }

  async function tableQrs() {
    const n = Number(await PZ.prompt('¿Cuántas mesas tiene el local?', { value: '10', type: 'number', title: '🍽️ QR por mesa' }));
    if (!n || n < 1) return;
    const url = publicUrl();
    const items = Array.from({ length: Math.min(n, 60) }, (_, i) => `<div class="tq"><b>Mesa ${i + 1}</b>${U.qrSvg(`${url}&mesa=${i + 1}`, 5, 1)}<div>Escaneá y pedí desde tu mesa</div></div>`).join('');
    printPage('QR por mesa', `<div class="grid">${items}</div>`);
  }

  PZ.views.online = {
    title: 'Carta online',
    render(el) {
      window.addEventListener('message', onMessage);
      render(el);
      const off = PZ.web ? PZ.web.onChange(() => { if (!document.querySelector('.modal-back') && !el.contains(document.activeElement)) render(el); }) : () => {};
      return () => { window.removeEventListener('message', onMessage); previews.clear(); off(); };
    },
  };
})(window.PZ);
