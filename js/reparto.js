// @ts-check
/* ==========================================================================
   MuzzaAPP · Panel del repartidor (entregas + GPS en vivo)

   El repartidor es un empleado con rol "Delivery": entra con su usuario y
   contraseña (la misma sesión de la app). Ve sus entregas y las que están sin
   asignar, sale a entregar, comparte su ubicación con el cliente y marca lo
   entregado. Todo el control de quién ve qué lo hace el servidor
   (reparto_orders / reparto_status / report_delivery_location).
   ========================================================================== */
(function () {
  const root = /** @type {HTMLElement} */ (document.getElementById('reparto'));
  const CFG = window.PZ_CONFIG;
  const U = window.PZ.util;

  /** Mismo origen y misma clave que la app: comparten la sesión */
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pz-auth' },
  });

  const ROLES_OK = ['owner', 'admin', 'cajero', 'delivery'];
  const ROLE_LABEL = { owner: 'Dueño/a', admin: 'Encargado/a', cajero: 'Cajero/a', delivery: 'Delivery' };
  const STATUS = {
    pendiente: { text: '🧑‍🍳 En cocina', cls: '' },
    horno: { text: '🔥 En el horno', cls: 'warn' },
    listo: { text: '✅ Listo para salir', cls: 'ok' },
    en_camino: { text: '🛵 En camino', cls: 'err' },
  };

  /** @type {{ id: string, name: string, role: string } | null} */
  let me = null;
  /** @type {any[]} */
  let branches = [];
  /** @type {any} */
  let branch = null;
  /** @type {any[]} */
  let deliveries = [];
  let lastJson = '[]';
  let offlineNote = false;
  let started = false;
  let firstLoad = true;
  /** @type {Set<string>} */
  let known = new Set();

  /** @type {number | null} */
  let watchId = null;
  /** @type {any} */
  let lastGps = null;
  /** @type {any} */
  let wakeLock = null;
  /** @type {any} */
  let titleFlashTimer = null;

  const esc = U.esc;
  const money = U.money;

  /* ---------------- Pantallas simples ---------------- */
  function shell(inner) {
    root.innerHTML = `
      <div style="text-align:center;padding:36px 0 18px;">
        <span style="font-size:3.4rem">🛵</span>
        <h1 style="margin:10px 0 6px;font-size:1.7rem">MuzzaAPP · Reparto</h1>
      </div>
      <div class="card" style="padding:22px 18px;text-align:center">${inner}</div>`;
  }

  function showLoading(msg = 'Cargando entregas…') {
    shell(`<div class="spin-pizza" style="font-size:2.4rem">🛵</div><p>${esc(msg)}</p>`);
  }

  function showNoSession(msg = '') {
    shell(`
      <p class="bold" style="font-size:1.15rem;margin-top:0">Entrá con tu usuario</p>
      <p class="muted">${esc(msg || 'Para ver tus entregas tenés que ingresar con el usuario y la contraseña que te dio el encargado.')}</p>
      <a class="btn primary lg block" href="index.html?next=reparto">Ingresar 🛵</a>`);
  }

  function showError(msg, retry = true) {
    shell(`
      <p class="bold" style="margin-top:0">No se pudo abrir el reparto</p>
      <p class="muted">${esc(msg)}</p>
      ${retry ? '<button class="btn primary block" id="retry">Reintentar</button>' : ''}
      <button class="btn ghost block" style="margin-top:8px" id="out">Salir</button>`);
    const r = document.getElementById('retry');
    if (r) r.onclick = () => init();
    const o = document.getElementById('out');
    if (o) o.onclick = signOut;
  }

  function pickBranch() {
    root.innerHTML = `
      <div style="text-align:center;padding:30px 0 12px"><span style="font-size:3rem">🏪</span><h2 style="margin:8px 0 0">¿En qué sucursal estás?</h2></div>
      <div class="pick-list">${branches.map((b) => `<button class="pick" data-id="${esc(b.id)}"><span class="pick-ico">🏪</span><span><b>${esc(b.name)}</b></span><span class="pick-go">→</span></button>`).join('')}</div>
      <p class="center small" style="margin-top:14px"><a href="#" id="out">Salir</a></p>`;
    root.querySelectorAll('.pick').forEach((b) => {
      /** @type {HTMLElement} */ (b).onclick = () => choose(/** @type {HTMLElement} */ (b).dataset.id || '');
    });
    const o = document.getElementById('out');
    if (o) o.onclick = (e) => { e.preventDefault(); signOut(); };
  }

  async function signOut() {
    stopGps();
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* sin conexión: igual se borra acá */ }
    try { localStorage.removeItem('pz-reparto-branch'); } catch (e) { /* noop */ }
    location.href = 'index.html';
  }

  /* ---------------- Arranque ---------------- */
  async function init() {
    showLoading('Abriendo tu sesión…');
    try {
      const { data } = await sb.auth.getSession();
      const session = data.session;
      if (!session) return showNoSession();
      const uid = session.user.id;

      const [mem, br] = await Promise.all([
        sb.from('members').select('org_id, name, role, active').eq('user_id', uid).eq('active', true),
        sb.from('branches').select('id, name, org_id, business:settings->business').eq('active', true).order('created_at'),
      ]);
      if (mem.error) throw mem.error;
      if (br.error) throw br.error;

      const okOrgs = new Map((mem.data || []).filter((m) => ROLES_OK.includes(m.role)).map((m) => [m.org_id, m]));
      if (!okOrgs.size) return showError('Tu usuario no tiene un rol que use el reparto. Hablá con el encargado.', false);
      branches = (br.data || []).filter((b) => okOrgs.has(b.org_id));
      if (!branches.length) return showError('No tenés sucursales asignadas. Hablá con el encargado.', false);

      /** el nombre y el rol salen de la sucursal elegida */
      me = { id: uid, name: '', role: '' };
      branches.forEach((b) => { b.member = okOrgs.get(b.org_id); });

      let saved = '';
      try { saved = localStorage.getItem('pz-reparto-branch') || ''; } catch (e) { /* noop */ }
      const start = branches.find((b) => b.id === saved) || (branches.length === 1 ? branches[0] : null);
      if (start) return choose(start.id);
      pickBranch();
    } catch (e) {
      console.warn('reparto init', e);
      const msg = /** @type {any} */ (e) && /** @type {any} */ (e).message;
      if (!navigator.onLine || /fetch|network/i.test(String(msg))) showError('No hay conexión. Revisá tu internet y probá de nuevo.');
      else showError(String(msg || 'Error inesperado'));
    }
  }

  async function choose(id) {
    branch = branches.find((b) => b.id === id);
    if (!branch || !me) return;
    me.name = branch.member.name || '';
    me.role = branch.member.role;
    try { localStorage.setItem('pz-reparto-branch', id); } catch (e) { /* noop */ }
    firstLoad = true;
    known = new Set();
    deliveries = [];
    lastJson = '[]';
    showLoading();
    await loadDeliveries();
    render();
    if (!started) {
      started = true;
      setupRefresh();
      setupWakeLock();
    }
  }

  /** La lista se refresca cada 15 s, al volver internet y al volver a la pantalla */
  function setupRefresh() {
    const refresh = () => { if (branch && !document.hidden) loadDeliveries().then((changed) => { if (changed) render(); }); };
    setInterval(refresh, 15000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
  }

  /* ---------------- Datos ---------------- */
  function flashTabTitle(msg) {
    if (!document.hidden) return;
    clearInterval(titleFlashTimer);
    const orig = document.title;
    let on = false;
    titleFlashTimer = setInterval(() => {
      if (!document.hidden) { clearInterval(titleFlashTimer); document.title = orig; return; }
      document.title = (on = !on) ? msg : orig;
    }, 1000);
  }

  /** @returns {Promise<boolean>} true si algo cambió y hay que redibujar */
  async function loadDeliveries() {
    const { data, error } = await sb.rpc('reparto_orders', { p_branch: branch.id });
    if (error) {
      if (/sesi[oó]n|jwt|not authenticated/i.test(error.message || '') || error.code === 'PGRST301') { showNoSession('Tu sesión venció. Ingresá de nuevo.'); return false; }
      const was = offlineNote;
      offlineNote = true;
      console.warn('reparto_orders', error);
      return !was;
    }
    const wasOffline = offlineNote;
    offlineNote = false;
    const list = /** @type {any[]} */ (Array.isArray(data) ? data : []).map((o) => ({
      id: o.id,
      number: o.number,
      address: o.address || '',
      customerName: o.customerName || '',
      phone: o.phone || '',
      notes: o.notes || '',
      items: o.items || [],
      total: o.total || 0,
      paid: !!o.paid,
      payment: o.payment || 'efectivo',
      collect: o.collect && typeof o.collect === 'object' ? o.collect : null,
      status: o.status,
      driver: o.driver || '',
      driverId: o.driverId || '',
    }));

    if (!firstLoad && me && me.role === 'delivery') {
      const fresh = list.filter((d) => !known.has(d.id) && d.status !== 'en_camino');
      if (fresh.length) {
        const first = fresh[0];
        const pz = /** @type {any} */ (window.PZ);
        if (pz && pz.notify) {
          pz.notify(`🛵 ¡Nuevo pedido! (#${first.number})`, {
            body: `📍 ${first.address} · ${first.customerName || 'Cliente'}\n💵 Total: ${money(first.total)}`,
            vibrate: [250, 100, 250, 100, 400],
            notes: [784, 1046, 1318],
            tag: `muzza-delivery-${first.id}`,
          });
        }
        flashTabTitle(`(¡NUEVO!) 🛵 Pedido #${first.number}`);
      }
    }
    firstLoad = false;
    known = new Set(list.map((d) => d.id));
    const json = JSON.stringify(list);
    const changed = json !== lastJson || wasOffline;
    lastJson = json;
    deliveries = list;
    return changed;
  }

  /* ---------------- Pantalla principal ---------------- */
  function render() {
    if (!branch || !me) return;
    const biz = (branch.business && branch.business.name) || branch.name;
    const city = (branch.business && branch.business.city) || '';
    const hasNotifs = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    const streaming = watchId != null;
    const onlyMine = me.role === 'delivery';

    root.innerHTML = `
      <div class="driver-top">
        <div>
          <div class="small muted">${esc(biz)}${branches.length > 1 ? ` · <a href="#" id="change-branch">${esc(branch.name)} ▾</a>` : ''}</div>
          <div class="bold" style="font-size:1.15rem;display:flex;align-items:center;flex-wrap:wrap;gap:6px">
            <span>🛵 ${esc(me.name || 'Repartidor')}</span>
            ${onlyMine ? '' : `<span class="badge">${esc(ROLE_LABEL[me.role] || me.role)} · viendo todos</span>`}
            <button class="btn sm ghost" id="sign-out" style="padding:2px 8px;font-size:0.75rem">Salir</button>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
            ${hasNotifs
              ? '<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.75rem;font-weight:700;color:var(--ok);background:rgba(127,176,105,0.15);padding:3px 8px;border-radius:6px;border:1px solid var(--ok);">🔔 Avisos activos</span>'
              : '<button class="btn sm ghost" id="enable-notifs-btn" style="padding:2px 8px;font-size:0.75rem;">🔔 Activar avisos</button>'}
          </div>
        </div>
        <div class="gps-pill ${streaming ? 'on' : 'off'}" id="gps-indicator">
          <i class="gps-dot"></i>
          <span>${streaming ? 'GPS Activo' : 'GPS Detenido'}</span>
        </div>
      </div>

      ${offlineNote ? '<div class="badge warn block" style="margin-top:10px;text-align:center;padding:8px">📴 Sin conexión: se muestra lo último que se cargó</div>' : ''}

      ${lastGps && streaming ? `
        <div style="margin-top:10px;padding:8px 12px;background:var(--card);border-radius:10px;border:1px solid var(--line);font-size:0.8rem;display:flex;justify-content:space-between;">
          <span>📍 Precisión: ±${Math.round(lastGps.accuracy || 0)}m</span>
          <span>⚡ Velocidad: ${Math.round((lastGps.speed || 0) * 3.6)} km/h</span>
        </div>` : ''}

      <div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0">Entregas (${deliveries.length})</h3>
        <button class="btn sm ghost" id="refresh-btn">🔄 Actualizar</button>
      </div>

      ${deliveries.length === 0 ? `
        <div class="card" style="text-align:center;padding:40px 16px;margin-top:14px;">
          <span style="font-size:2.4rem">✨</span>
          <p class="bold" style="margin:8px 0 4px">No hay entregas pendientes</p>
          <p class="muted small">${onlyMine ? 'Los pedidos que te asignen, o que estén sin asignar, aparecen acá automáticamente.' : 'Los deliveries activos de la sucursal aparecen acá automáticamente.'}</p>
        </div>` : deliveries.map((d) => renderDeliveryCard(d, city)).join('')}
    `;

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    on('sign-out', signOut);
    on('refresh-btn', () => { loadDeliveries().then(render); });
    on('change-branch', (e) => { e.preventDefault(); stopGps(); pickBranch(); });
    on('enable-notifs-btn', async () => {
      const pz = /** @type {any} */ (window.PZ);
      if (!pz || !pz.requestNotificationPermission) return;
      const res = await pz.requestNotificationPermission();
      if (res === 'granted') {
        pz.notify('🔔 ¡Avisos activados!', { body: 'Te vamos a avisar con sonido y vibración cuando haya un pedido nuevo.', notes: [784, 1046, 1318] });
        render();
      } else {
        alert('Las notificaciones están bloqueadas en tu navegador. Podés habilitarlas desde el candado de la barra de direcciones.');
      }
    });
    root.querySelectorAll('[data-action]').forEach((b) => {
      const btn = /** @type {HTMLElement} */ (b);
      btn.onclick = () => handleAction(btn.dataset.action || '', btn.dataset.id || '', btn);
    });
  }

  function renderDeliveryCard(/** @type {any} */ d, /** @type {string} */ city) {
    const isRoute = d.status === 'en_camino';
    const st = STATUS[d.status] || { text: d.status, cls: '' };
    const cashDue = d.collect && Number(d.collect.amount) > 0 ? Number(d.collect.amount) : d.total;
    const cashTendered = d.collect ? Number(d.collect.tendered) || 0 : 0;
    const cashChange = Math.max(0, cashTendered - cashDue);
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(d.address + (city ? ', ' + city : ''))}`;
    const first = d.customerName ? d.customerName.split(' ')[0] : '';
    const waUrl = d.phone ? `https://wa.me/${U.phoneForWa(d.phone)}?text=${encodeURIComponent(`¡Hola ${first}! Soy ${me ? me.name : 'el repartidor'} de ${branch ? branch.name : ''}, estoy yendo con tu pedido 🛵`)}` : '';
    const mine = d.driverId && me && d.driverId === me.id;
    const who = mine ? '' : d.driver ? `<div class="small muted" style="margin-bottom:6px">🛵 ${esc(d.driver)}</div>` : '<div class="small muted" style="margin-bottom:6px">🛵 Sin asignar</div>';
    const streaming = watchId != null;

    return `
      <div class="delivery-card ${isRoute ? 'in-route' : ''}" id="card-${esc(d.id)}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div>
            <span class="bold" style="font-size:1.1rem">#${esc(d.number)}</span>
            <span class="muted small" style="margin-left:6px">${esc(d.customerName)}</span>
          </div>
          <span class="del-badge badge ${st.cls}">${st.text}</span>
        </div>
        ${who}
        <div style="font-size:0.95rem;font-weight:700;margin-bottom:6px">📍 ${esc(d.address)}</div>
        <div class="small muted" style="margin-bottom:10px">
          ${(d.items || []).map((/** @type {any} */ it) => `${esc(it.qty)}x ${esc(it.name)}`).join(' · ')}
        </div>
        ${d.notes ? `<div class="small" style="margin-bottom:8px">📝 ${esc(d.notes)}</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg);border-radius:8px;font-size:0.85rem">
          <span>${d.paid ? '💳 Ya pagado' : (d.payment === 'efectivo' || d.collect ? '💵 Cobrar en efectivo:' : '💳 A cobrar (' + esc(d.payment) + '):')}</span>
          <b style="font-size:1rem;color:var(--primary)">${d.paid ? 'PAGADO' : money(cashDue)}</b>
        </div>
        ${!d.paid && cashChange > 0 ? `<div class="small" style="margin-top:4px;font-weight:700">Paga con ${money(cashTendered)} · llevá ${money(cashChange)} de vuelto</div>` : ''}

        <div class="action-grid">
          <a href="${esc(mapsUrl)}" target="_blank" rel="noopener" class="btn sm ghost" style="text-align:center">🗺️ Abrir GPS Maps</a>
          ${waUrl ? `<a href="${esc(waUrl)}" target="_blank" rel="noopener" class="btn sm ghost" style="text-align:center">💬 WhatsApp</a>` : ''}
        </div>

        <div style="margin-top:10px;display:grid;gap:8px">
          ${d.status === 'listo' ? `<button class="btn sm primary block" data-action="start" data-id="${esc(d.id)}">🛵 Salir a entregar (activar GPS)</button>` : ''}
          ${isRoute ? `<button class="btn sm ok block" data-action="delivered" data-id="${esc(d.id)}">🏁 Ya lo entregué</button>` : ''}
          ${isRoute && !streaming ? '<button class="btn sm ghost block" data-action="gps" data-id="">📍 Activar GPS</button>' : ''}
          ${d.status === 'pendiente' || d.status === 'horno' ? '<div class="small muted" style="text-align:center">Todavía está en cocina. Cuando esté listo vas a poder salir.</div>' : ''}
        </div>
      </div>`;
  }

  /* ---------------- Acciones ---------------- */
  async function handleAction(/** @type {string} */ action, /** @type {string} */ orderId, /** @type {HTMLElement} */ btn) {
    if (action === 'gps') { startGps(); render(); return; }
    const o = deliveries.find((x) => x.id === orderId);
    if (!o || !branch) return;
    btn.setAttribute('disabled', 'true');

    const target = action === 'start' ? 'en_camino' : 'entregado';
    const { error } = await sb.rpc('reparto_status', { p_branch: branch.id, p_order_id: String(orderId), p_status: target });
    if (error) {
      console.warn('reparto_status', error);
      alert(/sesi[oó]n/i.test(error.message || '') ? 'Tu sesión venció. Ingresá de nuevo.' : error.message || 'No se pudo actualizar el pedido. Probá de nuevo.');
      await loadDeliveries();
      render();
      return;
    }
    if (target === 'en_camino') {
      o.status = 'en_camino';
      if (me) { o.driverId = me.id; o.driver = me.name; }
      startGps();
    } else {
      deliveries = deliveries.filter((x) => x.id !== orderId);
      if (!deliveries.some((x) => x.status === 'en_camino')) stopGps();
    }
    lastJson = JSON.stringify(deliveries);
    render();
  }

  /* ---------------- GPS ---------------- */
  /** Comparte la posición de todos los pedidos que están en camino */
  function startGps() {
    if (!navigator.geolocation) { alert('Tu teléfono no soporta geolocalización.'); return; }
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        lastGps = pos.coords;
        updateGpsPill(true);
        if (!branch) return;
        deliveries.filter((d) => d.status === 'en_camino').forEach((d) => {
          sb.rpc('report_delivery_location', {
            p_branch_id: branch.id,
            p_order_id: String(d.id),
            p_lat: pos.coords.latitude,
            p_lng: pos.coords.longitude,
            p_accuracy: pos.coords.accuracy,
            p_heading: pos.coords.heading || null,
            p_speed: pos.coords.speed || null,
          }).then((/** @type {any} */ res) => {
            if (res && res.error) console.warn('Error enviando ubicación GPS:', res.error);
          });
        });
      },
      (err) => {
        console.warn('Error de GPS:', err);
        stopGps();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 },
    );
    updateGpsPill(true);
  }

  function stopGps() {
    if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    updateGpsPill(false);
  }

  function updateGpsPill(/** @type {boolean} */ on) {
    const el = document.getElementById('gps-indicator');
    if (el) {
      el.className = `gps-pill ${on ? 'on' : 'off'}`;
      el.innerHTML = `<i class="gps-dot"></i><span>${on ? 'GPS Activo' : 'GPS Detenido'}</span>`;
    }
  }

  async function setupWakeLock() {
    try {
      const nav = /** @type {any} */ (navigator);
      if ('wakeLock' in nav) {
        wakeLock = await nav.wakeLock.request('screen');
        // si el teléfono se bloqueó y se vuelve a encender, se pide de nuevo
        document.addEventListener('visibilitychange', async () => {
          if (wakeLock !== null && document.visibilityState === 'visible') {
            try { wakeLock = await nav.wakeLock.request('screen'); } catch (_) { /* noop */ }
          }
        });
      }
    } catch (e) { /* sin permiso de pantalla encendida */ }
  }

  init();
})();
