// @ts-check
/* ==========================================================================
   MuzzaAPP · Interfaz de Reparto y Tracking GPS en Vivo
   Permite al repartidor ingresar con su Código Único (sin contraseñas),
   ver sus entregas asignadas, activar el GPS y compartir su ubicación
   en tiempo real con el cliente.
   ========================================================================== */
(function () {
  const root = /** @type {HTMLElement} */ (document.getElementById('reparto'));
  const CFG = window.PZ_CONFIG;
  const C = window.PZ ? window.PZ.carta : null;
  const U = window.PZ ? window.PZ.util : null;

  const params = new URLSearchParams(location.search);
  let slug = (params.get('l') || localStorage.getItem('muzza-branch-slug') || '').toLowerCase();
  const branchIdParam = params.get('b') || '';
  let driverCodeParam = (params.get('c') || localStorage.getItem('muzza-driver-code') || '').toUpperCase().trim();
  let currentDriver = params.get('d') || localStorage.getItem('muzza-driver') || '';
  let currentDriverCode = driverCodeParam;

  /** @type {any} */
  let sb = null;
  /** @type {any} */
  let branchData = null;
  /** @type {number | null} */
  let watchId = null;
  /** @type {any} */
  let wakeLock = null;
  /** @type {any} */
  let lastGps = null;
  /** @type {any[]} */
  let activeDeliveries = [];
  let isStreamingGps = false;
  /** @type {string | null} */
  let activeRouteOrderId = null;

  const esc = (/** @type {any} */ s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function init() {
    // Si viene un código en el parámetro 'c' o ya está guardado
    if (driverCodeParam) {
      const parsed = C ? C.parseDriverCode(driverCodeParam, slug || 'diego') : { slug: slug || 'diego', code: driverCodeParam };
      if (parsed.slug) slug = parsed.slug;
      await authenticateWithCode(driverCodeParam, true);
      return;
    }

    // Si ya teníamos un chofer y slug guardados pero sin código formal
    if (currentDriver && slug) {
      await authenticateWithCode(currentDriver, true);
      return;
    }

    // Si no hay datos de acceso, mostrar la pantalla de inicio con código único
    renderCodeLoginScreen();
  }

  function getSupabase() {
    if (!sb && window.supabase && CFG) {
      try {
        sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
      } catch (e) {
        console.warn('Error conectando con Supabase:', e);
      }
    }
    return sb;
  }

  async function fetchBranchData(targetSlug) {
    const s = targetSlug || slug || 'diego';
    const client = getSupabase();
    if (!client) {
      branchData = makeFallbackBranch(s);
      return branchData;
    }

    try {
      const { data, error } = await client.rpc('reparto_init', { p_slug: s });
      if (!error && data && data.branch) {
        branchData = data;
        return branchData;
      }
    } catch (e) {
      // Ignorar e intentar con carta_menu
    }

    try {
      const { data } = await client.rpc('carta_menu', { p_slug: s });
      if (data && data.branch) {
        branchData = data;
        return branchData;
      }
    } catch (e) {
      // Ignorar y usar fallback
    }

    branchData = makeFallbackBranch(s);
    return branchData;
  }

  function makeFallbackBranch(s) {
    const name = s.replace(/-/g, ' ').toUpperCase();
    return {
      branch: { id: branchIdParam, name, slug: s },
      settings: {
        business: { name, city: '' },
        drivers: [
          { name: 'Lucas', code: 'DEL-101' },
          { name: 'Carlos', code: 'DEL-102' }
        ]
      }
    };
  }

  async function authenticateWithCode(rawInput, isAuto = false) {
    const raw = String(rawInput || '').trim().toUpperCase();
    if (!raw) {
      renderCodeLoginScreen('Por favor ingresá tu código de repartidor.');
      return;
    }

    if (!isAuto) {
      root.innerHTML = `<div style="text-align:center;padding:50px 0;"><div class="spin-pizza" style="font-size:3rem">🛵</div><p>Verificando código <b>${esc(raw)}</b>…</p></div>`;
    }

    const parsed = C ? C.parseDriverCode(raw, slug || 'diego') : { slug: slug || 'diego', code: raw, driverNum: '', driverName: '' };
    slug = parsed.slug || slug || 'diego';

    await fetchBranchData(slug);

    const driversList = (branchData && branchData.settings && branchData.settings.drivers) || [];
    const matched = C ? C.matchDriver(driversList, raw) : null;

    if (matched) {
      currentDriver = matched.name;
      currentDriverCode = matched.code || raw;
    } else {
      // Permitir continuar con el código o nombre para no dejar varado al repartidor
      currentDriver = parsed.driverName || raw;
      currentDriverCode = parsed.code || raw;
    }

    localStorage.setItem('muzza-driver', currentDriver);
    localStorage.setItem('muzza-driver-code', currentDriverCode);
    localStorage.setItem('muzza-branch-slug', slug);

    await loadDeliveries();
    renderApp();
    setupWakeLock();

    // Auto-actualizar lista de entregas cada 15s si no está en pleno streaming
    setInterval(() => {
      if (!isStreamingGps && currentDriver) {
        loadDeliveries().then(renderApp);
      }
    }, 15000);
  }

  function renderCodeLoginScreen(errMsg = '') {
    root.innerHTML = `
      <div style="text-align:center;padding:36px 0 20px;">
        <span style="font-size:3.5rem">🛵</span>
        <h1 style="margin:12px 0 6px;font-size:1.8rem">MuzzaAPP · Reparto</h1>
        <p class="muted" style="margin:0 auto;max-width:400px;font-size:0.95rem">
          Ingresá tu código único de repartidor para acceder a tus pedidos y activar tu GPS en vivo.
        </p>
      </div>

      <div class="card" style="padding:24px 20px;">
        <form id="driver-code-form">
          <label style="display:block;margin-bottom:12px;font-weight:700;font-size:0.9rem">
            Código de Repartidor:
          </label>
          <input
            type="text"
            id="driver-code-input"
            class="driver-code-input"
            placeholder="EJ: DEL-101"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="characters"
            spellcheck="false"
            maxlength="20"
            required
            value="${esc(currentDriverCode || '')}"
          />

          ${errMsg ? `<div class="badge err block" style="margin-top:12px;text-align:center;padding:8px">${esc(errMsg)}</div>` : ''}

          <button type="submit" class="btn primary lg block" style="margin-top:18px;font-size:1.1rem">
            Ingresar a mis entregas 🛵
          </button>
        </form>

        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line);text-align:center;">
          <p class="small muted" style="margin:0">
            ¿No sabés cuál es tu código? Pedíselo al encargado o cajero de tu sucursal. Te lo pueden enviar por WhatsApp en un clic.
          </p>
        </div>
      </div>
    `;

    const form = document.getElementById('driver-code-form');
    const input = /** @type {HTMLInputElement | null} */ (document.getElementById('driver-code-input'));
    if (form && input) {
      input.focus();
      input.oninput = () => { input.value = input.value.toUpperCase(); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const rawCode = input.value.trim().toUpperCase();
        if (!rawCode) return;
        await authenticateWithCode(rawCode);
      };
    }
  }

  let knownDeliveryIds = new Set();
  let isFirstDeliveriesLoad = true;
  /** @type {any} */
  let titleFlashTimer = null;

  function flashTabTitle(msg) {
    if (document.hidden) {
      clearInterval(titleFlashTimer);
      const orig = document.title;
      let on = false;
      titleFlashTimer = setInterval(() => {
        if (!document.hidden) {
          clearInterval(titleFlashTimer);
          document.title = orig;
          return;
        }
        document.title = (on = !on) ? msg : orig;
      }, 1000);
    }
  }

  async function loadDeliveries() {
    const client = getSupabase();
    if (!client) return;
    try {
      const { data, error } = await client.rpc('reparto_active_orders', {
        p_slug: slug,
        p_driver: currentDriver,
      });

      if (!error && Array.isArray(data)) {
        const mapped = data.map((o) => ({
          id: o.id,
          number: o.number,
          type: 'delivery',
          address: o.address || '',
          customerName: o.customerName || '',
          phone: o.phone || '',
          notes: o.notes || '',
          items: o.items || [],
          total: o.total || 0,
          paid: o.paid,
          payment: o.payment || 'efectivo',
          status: o.status === 'en_camino' ? 'en_camino' : 'listo',
          driver: o.driver || currentDriver,
          onlineOrderId: o.onlineOrderId || o.id,
        }));

        if (!isFirstDeliveriesLoad) {
          const newOrders = mapped.filter((d) => !knownDeliveryIds.has(d.id));
          if (newOrders.length > 0) {
            const first = newOrders[0];
            const pz = /** @type {any} */ (window).PZ;
            if (pz && pz.notify) {
              pz.notify(`🛵 ¡Nuevo pedido asignado! (#${first.number})`, {
                body: `📍 ${first.address} · ${first.customerName || 'Cliente'}\n💵 Total: $${first.total}`,
                vibrate: [250, 100, 250, 100, 400],
                notes: [784, 1046, 1318],
                tag: `muzza-delivery-${first.id}`,
              });
            }
            flashTabTitle(`(¡NUEVO!) 🛵 Pedido #${first.number}`);
          }
        }

        isFirstDeliveriesLoad = false;
        knownDeliveryIds = new Set(mapped.map((d) => d.id));
        activeDeliveries = mapped;
      }
    } catch (e) {
      console.warn('Error cargando entregas remotas:', e);
    }
  }

  function renderApp() {
    const bName = (branchData && branchData.settings && branchData.settings.business && branchData.settings.business.name) || (branchData && branchData.branch ? branchData.branch.name : 'Pizzería');
    const city = (branchData && branchData.settings && branchData.settings.business && branchData.settings.business.city) || '';
    const hasNotifs = typeof Notification !== 'undefined' && Notification.permission === 'granted';

    root.innerHTML = `
      <div class="driver-top">
        <div>
          <div class="small muted">${esc(bName)}</div>
          <div class="bold" style="font-size:1.15rem;display:flex;align-items:center;flex-wrap:wrap;gap:4px">
            <span>🛵 ${esc(currentDriver)}</span>
            ${currentDriverCode ? `<span class="driver-code-badge" title="Identificador único">${esc(currentDriverCode)}</span>` : ''}
            <button class="btn sm ghost" id="change-driver" style="padding:2px 8px;font-size:0.75rem;margin-left:4px">Cerrar turno</button>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
            ${hasNotifs
              ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.75rem;font-weight:700;color:var(--ok);background:rgba(127,176,105,0.15);padding:3px 8px;border-radius:6px;border:1px solid var(--ok);" title="Avisos sonoros y notificaciones de nuevos pedidos activos">🔔 Avisos activos</span>`
              : `<button class="btn sm ghost" id="enable-notifs-btn" style="padding:2px 8px;font-size:0.75rem;" title="Activar avisos sonoros y notificaciones de nuevos pedidos">🔔 Activar avisos</button>`}
          </div>
        </div>
        <div class="gps-pill ${isStreamingGps ? 'on' : 'off'}" id="gps-indicator">
          <i class="gps-dot"></i>
          <span>${isStreamingGps ? 'GPS Activo' : 'GPS Detenido'}</span>
        </div>
      </div>

      ${lastGps ? `
        <div style="margin-top:10px;padding:8px 12px;background:var(--card);border-radius:10px;border:1px solid var(--line);font-size:0.8rem;display:flex;justify-content:space-between;">
          <span>📍 Precisión: ±${Math.round(lastGps.accuracy || 0)}m</span>
          <span>⚡ Velocidad: ${Math.round((lastGps.speed || 0) * 3.6)} km/h</span>
        </div>
      ` : ''}

      <div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0">Entregas (${activeDeliveries.length})</h3>
        <button class="btn sm ghost" id="refresh-btn">🔄 Actualizar</button>
      </div>

      ${activeDeliveries.length === 0 ? `
        <div class="card" style="text-align:center;padding:40px 16px;margin-top:14px;">
          <span style="font-size:2.4rem">✨</span>
          <p class="bold" style="margin:8px 0 4px">No tenés pedidos pendientes</p>
          <p class="muted small">Los pedidos que te asignen en caja para el código <b>${esc(currentDriverCode || currentDriver)}</b> aparecerán acá automáticamente.</p>
        </div>
      ` : activeDeliveries.map((d) => renderDeliveryCard(d, city)).join('')}
    `;

    const changeBtn = document.getElementById('change-driver');
    if (changeBtn) {
      changeBtn.onclick = () => {
        stopGps();
        currentDriver = '';
        currentDriverCode = '';
        localStorage.removeItem('muzza-driver');
        localStorage.removeItem('muzza-driver-code');
        renderCodeLoginScreen();
      };
    }

    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        loadDeliveries().then(renderApp);
      };
    }

    const notifsBtn = document.getElementById('enable-notifs-btn');
    if (notifsBtn) {
      notifsBtn.onclick = async () => {
        const pz = /** @type {any} */ (window).PZ;
        if (pz && pz.requestNotificationPermission) {
          const res = await pz.requestNotificationPermission();
          if (res === 'granted') {
            pz.notify('🔔 ¡Avisos sonoros y notificaciones activados!', {
              body: 'Vas a recibir alertas con sonido y vibración cada vez que te asignen un pedido.',
              notes: [784, 1046, 1318],
            });
            renderApp();
          } else {
            alert('Las notificaciones están bloqueadas en tu navegador. Podés habilitarlas desde el icono del candado arriba en la barra de direcciones.');
          }
        }
      };
    }

    // Eventos de botones de cada entrega
    root.querySelectorAll('[data-action]').forEach((b) => {
      const btn = /** @type {HTMLElement} */ (b);
      btn.onclick = () => handleOrderAction(btn.dataset.action || '', btn.dataset.id || '');
    });
  }

  function renderDeliveryCard(/** @type {any} */ d, /** @type {string} */ city) {
    const isRoute = d.status === 'en_camino';
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(d.address + (city ? ', ' + city : ''))}`;
    const branchName = branchData && branchData.branch ? branchData.branch.name : '';
    const waUrl = d.phone ? `https://wa.me/${d.phone}?text=${encodeURIComponent(`¡Hola ${d.customerName ? d.customerName.split(' ')[0] : ''}! Soy ${currentDriver} de ${branchName}, estoy yendo con tu pedido 🛵`)}` : '';

    return `
      <div class="delivery-card ${isRoute ? 'in-route' : ''}" id="card-${esc(d.id)}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div>
            <span class="bold" style="font-size:1.1rem">#${esc(d.number)}</span>
            <span class="muted small" style="margin-left:6px">${esc(d.customerName)}</span>
          </div>
          <span class="del-badge badge ${isRoute ? 'err' : 'warn'}">${isRoute ? '🛵 En camino' : 'Listo p/ salir'}</span>
        </div>

        <div style="font-size:0.95rem;font-weight:700;margin-bottom:6px">
          📍 ${esc(d.address)}
        </div>

        <div class="small muted" style="margin-bottom:10px">
          ${(d.items || []).map((/** @type {any} */ it) => `${it.qty}x ${esc(it.name)}`).join(' · ')}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg);border-radius:8px;font-size:0.85rem">
          <span>${d.paid ? '💳 Ya pagado' : (d.payment === 'efectivo' ? '💵 Cobrar en efectivo:' : '💳 A cobrar (' + esc(d.payment) + '):')}</span>
          <b style="font-size:1rem;color:var(--primary)">${d.paid ? 'PAGADO' : (U ? U.money(d.total) : '$' + d.total)}</b>
        </div>

        <div class="action-grid">
          <a href="${esc(mapsUrl)}" target="_blank" rel="noopener" class="btn sm ghost" style="text-align:center">🗺️ Abrir GPS Maps</a>
          ${waUrl ? `<a href="${esc(waUrl)}" target="_blank" rel="noopener" class="btn sm ghost" style="text-align:center">💬 WhatsApp</a>` : ''}
        </div>

        <div style="margin-top:10px">
          ${!isRoute ? `
            <button class="btn sm primary block" data-action="start" data-id="${esc(d.id)}">🛵 Salir a Entregar (Activar GPS)</button>
          ` : `
            <button class="btn sm ok block" data-action="delivered" data-id="${esc(d.id)}">🏁 Ya lo entregué</button>
          `}
        </div>
      </div>
    `;
  }

  async function handleOrderAction(/** @type {string} */ action, /** @type {string} */ orderId) {
    const o = activeDeliveries.find((x) => x.id === orderId);
    if (!o) return;

    const client = getSupabase();

    if (action === 'start') {
      o.status = 'en_camino';
      activeRouteOrderId = orderId;
      startGps(orderId);
      renderApp();
      if (client) {
        try {
          await client.rpc('reparto_update_status', {
            p_slug: slug,
            p_order_id: String(orderId),
            p_driver: currentDriver,
            p_status: 'en_camino',
          });
        } catch (e) {
          console.warn('Error actualizando estado en_camino:', e);
        }
      }
    } else if (action === 'delivered') {
      stopGps();
      activeRouteOrderId = null;
      activeDeliveries = activeDeliveries.filter((x) => x.id !== orderId);
      renderApp();
      if (client) {
        try {
          await client.rpc('reparto_update_status', {
            p_slug: slug,
            p_order_id: String(orderId),
            p_driver: currentDriver,
            p_status: 'entregado',
          });
        } catch (e) {
          console.warn('Error actualizando estado entregado:', e);
        }
      }
    }
  }

  function startGps(/** @type {string} */ activeOrderId) {
    if (!navigator.geolocation) {
      alert('Tu teléfono no soporta geolocalización.');
      return;
    }

    isStreamingGps = true;
    updateGpsPill(true);

    if (watchId) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        lastGps = pos.coords;
        updateGpsPill(true);
        // Transmitir al servidor
        const client = getSupabase();
        if (client && branchData && branchData.branch && activeOrderId) {
          client.rpc('report_delivery_location', {
            p_branch_id: branchData.branch.id,
            p_order_id: String(activeOrderId),
            p_driver: currentDriver,
            p_lat: pos.coords.latitude,
            p_lng: pos.coords.longitude,
            p_accuracy: pos.coords.accuracy,
            p_heading: pos.coords.heading || null,
            p_speed: pos.coords.speed || null,
          }).then((/** @type {any} */ res) => {
            if (res && res.error) console.warn('Error enviando ubicación GPS:', res.error);
          });
        }
      },
      (err) => {
        console.warn('Error de GPS:', err);
        updateGpsPill(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 }
    );
  }

  function stopGps() {
    isStreamingGps = false;
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
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
      }
    } catch (e) {
      // Ignorar si el usuario no tiene permisos de WakeLock
    }
  }

  init();
})();
