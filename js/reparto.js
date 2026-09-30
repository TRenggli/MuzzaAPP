// @ts-check
/* ==========================================================================
   MuzzaAPP · Interfaz de Reparto y Tracking GPS en Vivo
   Permite al repartidor ver sus entregas, activar el GPS y compartir su
   ubicación en tiempo real con el cliente.
   ========================================================================== */
(function () {
  const root = /** @type {HTMLElement} */ (document.getElementById('reparto'));
  const CFG = window.PZ_CONFIG;
  const C = window.PZ ? window.PZ.carta : null;
  const U = window.PZ ? window.PZ.util : null;

  const params = new URLSearchParams(location.search);
  const slug = (params.get('l') || '').toLowerCase();
  let currentDriver = params.get('d') || localStorage.getItem('muzza-driver') || '';

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
    if (!slug) {
      root.innerHTML = `<div class="card" style="text-align:center;padding:30px">
        <h2>Falta la sucursal</h2>
        <p class="muted">Abrí este link desde el comandero de la pizzería o pedile el link a tu encargado.</p>
      </div>`;
      return;
    }

    try {
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
      const { data, error } = await sb.rpc('carta_menu', { p_slug: slug });
      if (error || !data) throw error || new Error('No se encontró la sucursal');
      branchData = data;
    } catch (e) {
      root.innerHTML = `<div class="card" style="text-align:center;padding:30px">
        <h2>Error al conectar</h2>
        <p class="muted">${esc(e.message || 'No pudimos cargar la sucursal')}</p>
        <button class="btn primary mt" onclick="location.reload()">Reintentar</button>
      </div>`;
      return;
    }

    // Si no hay conductor seleccionado, mostrar selector
    if (!currentDriver) {
      renderDriverPicker();
      return;
    }

    await loadDeliveries();
    renderApp();
    setupWakeLock();

    // Auto-actualizar lista de entregas cada 15s si no está en pleno streaming
    setInterval(() => {
      if (!isStreamingGps) {
        loadDeliveries().then(renderApp);
      }
    }, 15000);
  }

  function renderDriverPicker() {
    const drivers = (branchData && branchData.settings && branchData.settings.drivers) || ['Repartidor 1', 'Repartidor 2'];
    const bName = (branchData && branchData.settings && branchData.settings.business && branchData.settings.business.name) || (branchData && branchData.branch ? branchData.branch.name : 'Pizzería');

    root.innerHTML = `
      <div style="text-align:center;padding:24px 0 16px;">
        <span style="font-size:2.8rem">🛵</span>
        <h2 style="margin:8px 0 4px">${esc(bName)}</h2>
        <p class="muted">Seleccioná tu nombre para ver tus pedidos:</p>
      </div>
      <div class="card">
        <div style="display:grid;gap:10px;">
          ${drivers.map((/** @type {string} */ d) => `<button class="btn lg ghost block driver-sel" data-name="${esc(d)}">🛵 ${esc(d)}</button>`).join('')}
        </div>
        <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px;">
          <label class="field"><span>O escribí tu nombre:</span>
            <input type="text" id="custom-driver" placeholder="Ej: Lucas" />
          </label>
          <button class="btn primary block mt-xs" id="custom-driver-btn">Continuar</button>
        </div>
      </div>
    `;

    root.querySelectorAll('.driver-sel').forEach((b) => {
      /** @type {HTMLElement} */ (b).onclick = () => selectDriver(/** @type {HTMLElement} */ (b).dataset.name || '');
    });

    const customBtn = document.getElementById('custom-driver-btn');
    const customInp = /** @type {HTMLInputElement | null} */ (document.getElementById('custom-driver'));
    if (customBtn && customInp) {
      customBtn.onclick = () => {
        const val = customInp.value.trim();
        if (val) selectDriver(val);
      };
    }
  }

  function selectDriver(/** @type {string} */ name) {
    currentDriver = name;
    localStorage.setItem('muzza-driver', name);
    loadDeliveries().then(renderApp);
  }

  async function loadDeliveries() {
    if (!sb) return;
    try {
      const { data, error } = await sb.rpc('reparto_active_orders', {
        p_slug: slug,
        p_driver: currentDriver,
      });

      if (!error && Array.isArray(data)) {
        activeDeliveries = data.map((o) => ({
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
      }
    } catch (e) {
      console.warn('Error cargando entregas remotas:', e);
    }
  }

  function renderApp() {
    const bName = (branchData && branchData.settings && branchData.settings.business && branchData.settings.business.name) || (branchData && branchData.branch ? branchData.branch.name : 'Pizzería');
    const city = (branchData && branchData.settings && branchData.settings.business && branchData.settings.business.city) || '';

    root.innerHTML = `
      <div class="driver-top">
        <div>
          <div class="small muted">${esc(bName)}</div>
          <div class="bold" style="font-size:1.15rem">🛵 ${esc(currentDriver)} <button class="btn sm ghost" id="change-driver" style="padding:2px 8px;font-size:0.75rem;margin-left:6px">Cambiar</button></div>
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
          <p class="muted small">Los pedidos que te asignen en caja aparecerán acá automáticamente.</p>
        </div>
      ` : activeDeliveries.map((d) => renderDeliveryCard(d, city)).join('')}
    `;

    const changeBtn = document.getElementById('change-driver');
    if (changeBtn) {
      changeBtn.onclick = () => {
        stopGps();
        currentDriver = '';
        localStorage.removeItem('muzza-driver');
        renderDriverPicker();
      };
    }

    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        loadDeliveries().then(renderApp);
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

    if (action === 'start') {
      o.status = 'en_camino';
      activeRouteOrderId = orderId;
      startGps(orderId);
      renderApp();
      if (sb) {
        try {
          await sb.rpc('reparto_update_status', {
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
      if (sb) {
        try {
          await sb.rpc('reparto_update_status', {
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
        if (sb && branchData && activeOrderId) {
          sb.rpc('report_delivery_location', {
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
