// @ts-check
/* ==========================================================================
   Vista: MENÚ Y PRECIOS — productos, categorías, agregados, aumentos masivos
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  let tab = 'productos';

  function render(el) {
    if (!PZ.auth.isAdmin()) { el.innerHTML = '<div class="card empty">Solo administradores</div>'; return; }
    el.innerHTML = `
      <div class="tabs-nav">
        ${[['productos', '🍕 Productos'], ['categorias', '🗂️ Categorías'], ['extras', '➕ Agregados y condimentos'], ['carta', '📜 Carta para clientes']].map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <div class="tab-body"></div>`;
    el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; render(el); });
    const body = el.querySelector('.tab-body');
    ({ productos, categorias, extras, carta })[tab](body, el);
  }

  /* ---------------- Productos ---------------- */
  function productos(body, el) {
    body.innerHTML = `
      <div class="row-flex space-between mb">
        <div class="row-flex"><button class="btn primary" data-a="new">➕ Nuevo producto</button><button class="btn accent" data-a="bulk">📈 Aumentar precios</button></div>
        <span class="muted small">Tocá ✏️ para editar precios, tamaños y receta.</span>
      </div>
      ${S.data.categories.map((c) => {
        const ps = S.data.products.filter((p) => p.categoryId === c.id);
        return `<div class="card mb"><h3>${c.icon} ${U.esc(c.name)} <span class="badge">${ps.length}</span></h3>
          ${ps.length ? `<div class="table-wrap"><table class="tbl"><tbody>${ps.map((p) => `<tr>
            <td style="width:34px">${c.allowHalf ? `<span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:${p.color || 'var(--accent)'};border:3px solid var(--crust)"></span>` : c.icon}</td>
            <td><b>${U.esc(p.name)}</b>${c.allowHalf && p.allowHalf === false ? ' <span class="badge muted" style="font-size:0.75em;vertical-align:middle">Solo entera</span>' : ''}<div class="small muted">${U.esc(p.desc || '')}</div></td>
            <td class="nowrap">${p.variants.map((v) => `<span class="badge">${U.esc(v.name)} ${U.money(v.price)}</span>`).join(' ')}</td>
            <td><label class="check" style="margin:0"><input type="checkbox" data-av="${p.id}" ${p.active ? 'checked' : ''}> ${p.active ? 'Disponible' : 'Agotado'}</label></td>
            <td class="actions"><button class="btn sm ghost" data-e="${p.id}">✏️</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty small">Sin productos</div>'}
        </div>`;
      }).join('')}`;
    body.querySelector('[data-a=new]').onclick = () => editProduct(null, () => render(el));
    body.querySelector('[data-a=bulk]').onclick = () => bulk(() => render(el));
    body.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => editProduct(S.product(b.dataset.e), () => render(el)));
    body.querySelectorAll('[data-av]').forEach((b) => b.onchange = () => { S.product(b.dataset.av).active = b.checked; S.save(); render(el); });
  }

  function editProduct(p, done) {
    const isNew = !p;
    const draft = p ? JSON.parse(JSON.stringify(p)) : { id: U.uid('p-'), categoryId: S.data.categories[0].id, name: '', desc: '', active: true, color: '#ffd166', variants: [{ id: 'u', name: 'Unidad', price: 0, factor: 1 }], recipe: [] };
    const m = PZ.modal({
      title: isNew ? '➕ Nuevo producto' : '✏️ ' + U.esc(p.name),
      size: 'lg',
      body: `
        <div class="grid-2">
          <label class="field"><span>Nombre</span><input name="name" value="${U.esc(draft.name)}" autofocus></label>
          <label class="field"><span>Categoría</span><select name="cat">${S.data.categories.map((c) => `<option value="${c.id}" ${c.id === draft.categoryId ? 'selected' : ''}>${c.icon} ${U.esc(c.name)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Descripción</span><input name="desc" value="${U.esc(draft.desc || '')}"></label>
        <div class="grid-2">
          <label class="field"><span>Color (para pizzas)</span><input name="color" type="color" value="${draft.color || '#ffd166'}" style="height:44px;padding:4px"></label>
          ${PZ.auth.feature('carta') ? `<div class="field"><span>Carta online</span>
            <div class="img-slot"><div class="thumb photo-prev">${draft.photo ? `<img src="${U.esc(draft.photo)}" alt="">` : '📷'}</div>
              <label class="btn ghost sm">Foto<input type="file" accept="image/*" name="photo" hidden></label>
              <label class="check" style="margin:0"><input type="checkbox" name="online" ${draft.online !== false ? 'checked' : ''}> Se ve en la carta</label></div></div>` : ''}
        </div>
        <div class="half-opt-wrap" style="margin: 6px 0 12px">
          <label class="check" style="margin:0"><input type="checkbox" name="allowHalf" ${draft.allowHalf !== false ? 'checked' : ''}> 🍕 Permitir mitad y mitad con otras pizzas</label>
          <div class="small muted" style="margin-left:24px">Desmarcalo si es una pizza especial, calzón o rellena que solo se vende entera.</div>
        </div>
        <div class="opt-section">Tamaños y precios</div>
        <div class="vars"></div>
        <button class="btn sm ghost" data-a="addv">➕ Agregar tamaño</button>
        <div class="opt-section">Receta (descuenta stock automáticamente al vender)</div>
        <div class="rec"></div>
        <button class="btn sm ghost" data-a="addr">➕ Agregar ingrediente</button>`,
      footer: `${!isNew ? '<button class="btn danger" data-a="del">Eliminar</button><span class="grow"></span>' : ''}<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Guardar</button>`,
    });
    const E = m.el;
    const drawVars = () => {
      E.querySelector('.vars').innerHTML = draft.variants.map((v, i) => `
        <div class="row-flex" style="margin-bottom:8px">
          <input data-vn="${i}" value="${U.esc(v.name)}" placeholder="Nombre (ej: Grande)" style="flex:2">
          <input data-vp="${i}" value="${v.price}" inputmode="numeric" placeholder="Precio" style="flex:1">
          <input data-vf="${i}" value="${v.factor || 1}" inputmode="decimal" title="Proporción de receta (ej: chica 0.6)" style="width:80px">
          ${draft.variants.length > 1 ? `<button class="icon-btn" data-vr="${i}">🗑️</button>` : ''}
        </div>`).join('') + '<div class="small muted" style="margin:-2px 0 8px">La última columna es la proporción de la receta (grande = 1, chica ≈ 0.6).</div>';
      E.querySelectorAll('[data-vn]').forEach((i) => i.oninput = () => { draft.variants[i.dataset.vn].name = i.value; });
      E.querySelectorAll('[data-vp]').forEach((i) => i.oninput = () => { draft.variants[i.dataset.vp].price = U.parseMoney(i.value); });
      E.querySelectorAll('[data-vf]').forEach((i) => i.oninput = () => { draft.variants[i.dataset.vf].factor = Number(i.value.replace(',', '.')) || 1; });
      E.querySelectorAll('[data-vr]').forEach((b) => b.onclick = () => { draft.variants.splice(Number(b.dataset.vr), 1); drawVars(); });
    };
    const ings = S.data.ingredients;
    const drawRec = () => {
      E.querySelector('.rec').innerHTML = draft.recipe.length ? draft.recipe.map((r, i) => `
        <div class="row-flex" style="margin-bottom:8px">
          <select data-ri="${i}" style="flex:2">${ings.map((g) => `<option value="${g.id}" ${g.id === r.ingredientId ? 'selected' : ''}>${U.esc(g.name)} (${g.unit})</option>`).join('')}</select>
          <input data-rq="${i}" value="${r.qty}" inputmode="decimal" style="flex:1" placeholder="Cantidad">
          <button class="icon-btn" data-rr="${i}">🗑️</button>
        </div>`).join('') : '<p class="small muted">Sin receta. Opcional: sirve para que el stock baje solo.</p>';
      E.querySelectorAll('[data-ri]').forEach((s) => s.onchange = () => { draft.recipe[s.dataset.ri].ingredientId = s.value; });
      E.querySelectorAll('[data-rq]').forEach((s) => s.oninput = () => { draft.recipe[s.dataset.rq].qty = Number(s.value.replace(',', '.')) || 0; });
      E.querySelectorAll('[data-rr]').forEach((b) => b.onclick = () => { draft.recipe.splice(Number(b.dataset.rr), 1); drawRec(); });
    };
    drawVars(); drawRec();
    const photoIn = E.querySelector('[name=photo]');
    if (photoIn) photoIn.onchange = async () => {
      const f = photoIn.files[0];
      if (!f) return;
      if (!navigator.onLine) return PZ.toast('Para subir fotos hace falta internet', 'warn');
      try {
        PZ.toast('Subiendo foto…', 'info', 1500);
        draft.photo = await PZ.cloud.uploadMenuImage(await U.imageBlob(f, 900, 0.82), 'p-' + draft.id);
        E.querySelector('.photo-prev').innerHTML = `<img src="${U.esc(draft.photo)}" alt="">`;
      } catch (e) { PZ.toast('No se pudo subir: ' + e.message, 'err', 5000); }
    };
    const catSelect = /** @type {HTMLSelectElement | null} */ (E.querySelector('[name=cat]'));
    const halfWrap = /** @type {HTMLElement | null} */ (E.querySelector('.half-opt-wrap'));
    const syncHalfOpt = () => {
      const c = catSelect ? S.category(catSelect.value) : null;
      if (halfWrap) halfWrap.style.display = c && c.allowHalf ? '' : 'none';
    };
    if (catSelect) catSelect.onchange = syncHalfOpt;
    syncHalfOpt();

    E.querySelector('[data-a=addv]').onclick = () => { draft.variants.push({ id: U.uid('v'), name: '', price: 0, factor: 1 }); drawVars(); };
    E.querySelector('[data-a=addr]').onclick = () => { if (!ings.length) return PZ.toast('Primero cargá ingredientes en Stock', 'warn'); draft.recipe.push({ ingredientId: ings[0].id, qty: 0 }); drawRec(); };
    E.querySelector('[data-a=x]').onclick = () => m.close();
    const del = E.querySelector('[data-a=del]');
    if (del) del.onclick = async () => {
      if (!(await PZ.confirm(`¿Eliminar ${U.esc(p.name)}? Las ventas anteriores no se modifican.`, { danger: true, ok: 'Eliminar' }))) return;
      S.data.products = S.data.products.filter((x) => x.id !== p.id);
      S.save(); m.close(); done();
    };
    E.querySelector('[data-a=ok]').onclick = () => {
      draft.name = E.querySelector('[name=name]').value.trim();
      draft.desc = E.querySelector('[name=desc]').value.trim();
      draft.categoryId = E.querySelector('[name=cat]').value;
      draft.color = E.querySelector('[name=color]').value;
      const onl = E.querySelector('[name=online]');
      if (onl) draft.online = onl.checked;
      const hfIn = /** @type {HTMLInputElement | null} */ (E.querySelector('[name=allowHalf]'));
      if (hfIn) draft.allowHalf = hfIn.checked;
      draft.variants = draft.variants.filter((v) => v.name.trim() || draft.variants.length === 1);
      draft.recipe = draft.recipe.filter((r) => r.qty > 0);
      if (!draft.name) return PZ.toast('Falta el nombre', 'warn');
      if (draft.variants.some((v) => !v.price)) return PZ.toast('Todos los tamaños necesitan precio', 'warn');
      if (isNew) S.data.products.push(draft);
      else Object.assign(p, draft);
      S.log('menú', `${isNew ? 'Alta' : 'Edición'} de ${draft.name}`);
      S.save(); m.close(); PZ.toast('Producto guardado'); done();
    };
  }

  function bulk(done) {
    const m = PZ.modal({
      title: '📈 Aumento masivo de precios',
      size: 'sm',
      body: `
        <label class="field"><span>Porcentaje (usá negativo para bajar)</span><input class="pct" inputmode="decimal" placeholder="Ej: 8" autofocus></label>
        <label class="field"><span>Aplicar a</span><select class="cat"><option value="">Todo el menú</option>${S.data.categories.map((c) => `<option value="${c.id}">${c.icon} ${U.esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Redondear a</span><select class="round"><option value="100">$100</option><option value="500" selected>$500</option><option value="1000">$1.000</option><option value="1">Sin redondeo</option></select></label>
        <label class="check"><input type="checkbox" class="ext"> Incluir agregados y envíos</label>
        <div class="preview small muted"></div>`,
      footer: `<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Aplicar aumento</button>`,
    });
    const E = m.el;
    const calc = (price) => {
      const pct = Number(E.querySelector('.pct').value.replace(',', '.')) || 0;
      const r = Number(E.querySelector('.round').value);
      return Math.max(0, Math.round((price * (1 + pct / 100)) / r) * r);
    };
    const prev = () => {
      const p = S.data.products.find((x) => !E.querySelector('.cat').value || x.categoryId === E.querySelector('.cat').value);
      E.querySelector('.preview').textContent = p ? `Ejemplo: ${p.name} ${U.money(p.variants[0].price)} → ${U.money(calc(p.variants[0].price))}` : '';
    };
    E.querySelectorAll('input,select').forEach((i) => i.addEventListener('input', prev));
    E.querySelector('[data-a=x]').onclick = () => m.close();
    E.querySelector('[data-a=ok]').onclick = async () => {
      const pct = E.querySelector('.pct').value;
      if (!pct) return;
      const cat = E.querySelector('.cat').value;
      if (!(await PZ.confirm(`¿Aplicar ${pct}% a ${cat ? S.category(cat).name : 'todo el menú'}?`))) return;
      S.data.products.filter((x) => !cat || x.categoryId === cat).forEach((p) => p.variants.forEach((v) => { v.price = calc(v.price); }));
      if (E.querySelector('.ext').checked) {
        S.data.extras.forEach((x) => { x.price = calc(x.price); });
        S.data.settings.zones.forEach((z) => { z.fee = calc(z.fee); });
      }
      S.log('menú', `Aumento de precios ${pct}% (${cat ? S.category(cat).name : 'todo'})`);
      S.save(); m.close(); PZ.toast('Precios actualizados'); done();
    };
  }

  /* ---------------- Categorías ---------------- */
  function categorias(body, el) {
    body.innerHTML = `
      <div class="card">
        <p class="muted" style="margin-top:0">Las categorías con “mitad y mitad” permiten combinar gustos y agregados (ideal para pizzas).</p>
        <div class="table-wrap"><table class="tbl"><tbody>
          ${S.data.categories.map((c, i) => `<tr>
            <td style="width:70px"><input data-ic="${c.id}" value="${c.icon}" style="text-align:center;font-size:1.3em;padding:6px"></td>
            <td><input data-nm="${c.id}" value="${U.esc(c.name)}"></td>
            <td class="nowrap"><label class="check" style="margin:0"><input type="checkbox" data-hf="${c.id}" ${c.allowHalf ? 'checked' : ''}> Mitad y mitad</label></td>
            <td class="actions">
              <button class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Subir">⬆️</button>
              <button class="icon-btn" data-down="${i}" ${i === S.data.categories.length - 1 ? 'disabled' : ''} title="Bajar">⬇️</button>
              <button class="icon-btn" data-del="${c.id}" title="Eliminar">🗑️</button>
            </td></tr>`).join('')}
        </tbody></table></div>
        <button class="btn primary mt" data-a="add">➕ Nueva categoría</button>
      </div>`;
    const cat = (id) => S.category(id);
    body.querySelectorAll('[data-ic]').forEach((i) => i.onchange = () => { cat(i.dataset.ic).icon = i.value || '🍽️'; S.save(); });
    body.querySelectorAll('[data-nm]').forEach((i) => i.onchange = () => { cat(i.dataset.nm).name = i.value.trim() || 'Sin nombre'; S.save(); });
    body.querySelectorAll('[data-hf]').forEach((i) => i.onchange = () => { cat(i.dataset.hf).allowHalf = i.checked; S.save(); });
    body.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.up);
      const arr = S.data.categories;
      [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      arr.forEach((c, idx) => { c._i = idx; });
      S.save(); render(el);
    });
    body.querySelectorAll('[data-down]').forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.down);
      const arr = S.data.categories;
      [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
      arr.forEach((c, idx) => { c._i = idx; });
      S.save(); render(el);
    });
    body.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const n = S.data.products.filter((p) => p.categoryId === b.dataset.del).length;
      if (n) return PZ.toast(`Tiene ${n} producto(s). Movelos o eliminalos primero.`, 'warn');
      if (!(await PZ.confirm('¿Eliminar la categoría?', { danger: true }))) return;
      S.data.categories = S.data.categories.filter((c) => c.id !== b.dataset.del);
      S.save(); render(el);
    });
    body.querySelector('[data-a=add]').onclick = () => { S.data.categories.push({ id: U.uid('c-'), name: 'Nueva categoría', icon: '🍽️', allowHalf: false }); S.save(); render(el); };
  }

  /* ---------------- Agregados y condimentos ---------------- */
  function extras(body, el) {
    const on = S.data.settings.online = S.data.settings.online || {};
    if (!Array.isArray(on.condiments)) {
      on.condiments = [
        { id: 'oregano', name: 'Orégano', default: true },
        { id: 'chimi', name: 'Chimi', default: true },
      ];
    }
    body.innerHTML = `
      <div class="card mb">
        <h3>🌿 Condimentos de la casa</h3>
        <p class="muted" style="margin-top:0">Condimentos sin cargo que se ofrecen en cada pizza. Marcá los que vienen <b>incluidos por defecto</b> (para que el cliente o mozo pueda pedir sacarlos), o dejalos desmarcados si son <b>opcionales</b> (para pedir agregarlos).</p>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Nombre</th><th style="width:200px">Viene con la pizza</th><th style="width:40px"></th></tr></thead>
          <tbody>
            ${on.condiments.map((c, i) => `<tr>
              <td><input data-cn="${i}" value="${U.esc(c.name)}" placeholder="Ej: Orégano, Chimi, Ajo…"></td>
              <td><label class="check" style="margin:0"><input type="checkbox" data-cd="${i}" ${c.default !== false ? 'checked' : ''}> Incluido</label></td>
              <td class="actions"><button class="icon-btn" data-cdel="${i}" title="Eliminar">🗑️</button></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <button class="btn primary mt" data-a="add-c">➕ Nuevo condimento</button>
      </div>

      <div class="card">
        <h3>➕ Agregados con costo (Extras)</h3>
        <p class="muted" style="margin-top:0">Se cobran como adicional al elegir una pizza (ej: Extra muzzarella, Extra jamón).</p>
        ${S.data.extras.map((x) => `<div class="row-flex" style="margin-bottom:8px">
          <input data-xn="${x.id}" value="${U.esc(x.name)}" placeholder="Nombre del agregado" style="flex:2">
          <input data-xp="${x.id}" value="${x.price}" inputmode="numeric" placeholder="Precio" style="flex:1">
          <button class="icon-btn" data-xd="${x.id}">🗑️</button></div>`).join('')}
        <button class="btn primary mt" data-a="add-x">➕ Nuevo agregado</button>
      </div>`;

    // Handlers para condimentos
    body.querySelectorAll('[data-cn]').forEach((inp) => {
      const input = /** @type {HTMLInputElement} */ (inp);
      input.onchange = () => {
        on.condiments[Number(input.dataset.cn)].name = input.value.trim() || 'Condimento';
        S.save();
      };
    });
    body.querySelectorAll('[data-cd]').forEach((chk) => {
      const check = /** @type {HTMLInputElement} */ (chk);
      check.onchange = () => {
        on.condiments[Number(check.dataset.cd)].default = check.checked;
        S.save();
      };
    });
    body.querySelectorAll('[data-cdel]').forEach((btn) => {
      const b = /** @type {HTMLElement} */ (btn);
      b.onclick = () => {
        on.condiments.splice(Number(b.dataset.cdel), 1);
        S.save(); render(el);
      };
    });
    const addC = /** @type {HTMLElement | null} */ (body.querySelector('[data-a=add-c]'));
    if (addC) {
      addC.onclick = () => {
        on.condiments.push({ id: U.uid('cond-'), name: 'Nuevo condimento', default: true });
        S.save(); render(el);
      };
    }

    // Handlers para agregados con costo
    const ex = (id) => S.data.extras.find((x) => x.id === id);
    body.querySelectorAll('[data-xn]').forEach((inp) => {
      const input = /** @type {HTMLInputElement} */ (inp);
      input.onchange = () => { const x = ex(input.dataset.xn); if (x) x.name = input.value; S.save(); };
    });
    body.querySelectorAll('[data-xp]').forEach((inp) => {
      const input = /** @type {HTMLInputElement} */ (inp);
      input.onchange = () => { const x = ex(input.dataset.xp); if (x) x.price = U.parseMoney(input.value); S.save(); };
    });
    body.querySelectorAll('[data-xd]').forEach((btn) => {
      const b = /** @type {HTMLElement} */ (btn);
      b.onclick = () => { S.data.extras = S.data.extras.filter((x) => x.id !== b.dataset.xd); S.save(); render(el); };
    });
    const addX = /** @type {HTMLElement | null} */ (body.querySelector('[data-a=add-x]'));
    if (addX) {
      addX.onclick = () => { S.data.extras.push({ id: U.uid('e'), name: 'Nuevo agregado', price: 0 }); S.save(); render(el); };
    }
  }

  /* ---------------- Carta imprimible / para compartir ---------------- */
  function carta(body) {
    const b = S.data.settings.business;
    const norm = (s) => String(s || '').trim().toLowerCase();

    // Ranks comunes para ordenar columnas de menor a mayor
    const KNOWN_RANKS = {
      'u': 1, 'unidad': 1, 'porción': 1, 'porcion': 1, 'individual': 1, 'chica': 2,
      'media': 3, 'mediana': 3, 'media docena': 4,
      'grande': 5, 'docena': 6, 'familiar': 7, 'gigante': 8,
    };

    const html = `
      <div style="text-align:center;margin-bottom:14px">${PZ.brandLogo(70)}<h1 style="color:var(--primary);margin:6px 0 2px">${U.esc(b.name)}</h1><div class="muted">${U.esc(b.slogan)} · ${U.esc(b.phone)}</div></div>
      ${S.data.categories.map((c) => {
        const ps = S.data.products.filter((p) => p.categoryId === c.id && p.active);
        if (!ps.length) return '';

        // Recolectar columnas agrupadas por nombre normalizado (evita duplicar "Media docena" y "Media Docena")
        /** @type {Map<string, { key: string, label: string, avgPrice: number, count: number }>} */
        const colMap = new Map();
        ps.forEach((p) => {
          (p.variants || []).forEach((v) => {
            const raw = String(v.name || '').trim();
            if (!raw) return;
            const key = norm(raw);
            const price = Number(v.price) || 0;
            if (!colMap.has(key)) {
              const label = raw.charAt(0).toUpperCase() + raw.slice(1);
              colMap.set(key, { key, label, avgPrice: price, count: 1 });
            } else {
              const cur = colMap.get(key);
              if (cur) {
                cur.avgPrice = (cur.avgPrice * cur.count + price) / (cur.count + 1);
                cur.count += 1;
              }
            }
          });
        });

        // Ordenar columnas de forma natural: menor porción/tamaño primero, o por precio promedio ascendente
        const cols = Array.from(colMap.values()).sort((x, y) => {
          const rx = KNOWN_RANKS[x.key] || 99;
          const ry = KNOWN_RANKS[y.key] || 99;
          if (rx !== ry) return rx - ry;
          return x.avgPrice - y.avgPrice;
        });

        const multiCol = cols.length > 1;

        return `
          <div style="margin-top:22px;page-break-inside:avoid">
            <h3 style="margin:0 0 8px;border-bottom:3px dotted var(--primary);padding-bottom:4px;display:flex;align-items:center;gap:8px">
              <span>${c.icon}</span> <span>${U.esc(c.name)}</span>
              ${c.allowHalf ? '<span class="badge" style="font-size:0.7em;font-weight:normal;margin-left:auto">🍕 Permite mitad y mitad</span>' : ''}
            </h3>
            <table class="tbl carta-tbl" style="width:100%;table-layout:fixed;border-collapse:collapse">
              <thead>
                <tr>
                  <th style="text-align:left;padding:8px 6px">Producto</th>
                  ${multiCol ? cols.map((col) => `<th class="right col-price" style="width:115px;text-align:right;padding:8px 6px">${U.esc(col.label)}</th>`).join('') : '<th class="right col-price" style="width:120px;text-align:right;padding:8px 6px">Precio</th>'}
                </tr>
              </thead>
              <tbody>
                ${ps.map((p) => {
                  const vars = p.variants || [];
                  const soloEntera = c.allowHalf && p.allowHalf === false;
                  const nameCell = `<td style="padding:10px 6px;vertical-align:middle">
                    <b>${U.esc(p.name)}</b>
                    ${soloEntera ? ' <span class="badge muted" style="font-size:0.75em;vertical-align:middle">Solo entera</span>' : ''}
                    ${p.desc ? `<div class="small muted" style="margin-top:2px">${U.esc(p.desc)}</div>` : ''}
                  </td>`;

                  if (!multiCol) {
                    const price = vars[0] ? vars[0].price : 0;
                    return `<tr>${nameCell}<td class="right nowrap col-price" style="width:120px;text-align:right;padding:10px 6px;font-weight:bold">${U.money(price)}</td></tr>`;
                  }

                  // Si la categoría tiene múltiples columnas pero este producto solo tiene 1 variante que no coincide con las columnas
                  const matchesAny = vars.some((v) => cols.some((col) => norm(v.name) === col.key));
                  if (vars.length === 1 && !matchesAny) {
                    return `<tr>${nameCell}<td colspan="${cols.length}" class="right nowrap col-price" style="text-align:right;padding:10px 6px"><b>${U.money(vars[0].price)}</b>${vars[0].name ? ` <small class="muted">(${U.esc(vars[0].name)})</small>` : ''}</td></tr>`;
                  }

                  const priceCells = cols.map((col) => {
                    const v = vars.find((x) => norm(x.name) === col.key);
                    return `<td class="right nowrap col-price" style="width:115px;text-align:right;padding:10px 6px">${v ? `<b>${U.money(v.price)}</b>` : '<span class="muted" style="opacity:0.4">—</span>'}</td>`;
                  }).join('');

                  return `<tr>${nameCell}${priceCells}</tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`;
      }).join('')}`;
    body.innerHTML = `
      <div class="row-flex mb"><button class="btn primary" data-a="print">🖨️ Imprimir / guardar PDF</button><span class="muted small">Ideal para pegar en el local o mandar por WhatsApp como PDF.</span></div>
      <div class="card carta">${html}</div>`;
    body.querySelector('[data-a=print]').onclick = () => {
      const w = window.open('', '_blank');
      if (!w) return PZ.toast('Permití las ventanas emergentes para imprimir', 'warn');
      const css = Array.from(document.styleSheets).map((s) => { try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n'); } catch (e) { return ''; } }).join('\n');
      w.document.write(`<!doctype html><html data-theme="${PZ.app.theme()}"><head><meta charset="utf-8"><title>Carta ${U.esc(b.name)}</title><style>${css} body{padding:24px;background:#fff} .card{box-shadow:none;border:0}</style></head><body><div class="card">${html}</div></body></html>`);
      w.document.close();
      setTimeout(() => w.print(), 400);
    };
  }

  PZ.views.menu = { title: 'Menú y precios', render };
})(window.PZ);
