/* ==========================================================================
   Vista: CONFIGURACIÓN
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  let tab = 'negocio';

  const TABS = [
    ['negocio', '🏪 Negocio'], ['ticket', '🧾 Ticket e impresora'], ['cobros', '💳 Cobros'], ['delivery', '🛵 Delivery'],
    ['apariencia', '🎨 Apariencia'], ['sistema', '🛟 Respaldo y sistema'],
  ];

  function render(el) {
    // otra pantalla puede pedir abrir una pestaña (ej: "Editar zonas" desde la carta online)
    if (PZ.configTab && SECTIONS[PZ.configTab]) { tab = PZ.configTab; PZ.configTab = null; }
    el.innerHTML = `<div class="tabs-nav">${TABS.map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="tab-body"></div>`;
    el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; render(el); });
    SECTIONS[tab](el.querySelector('.tab-body'), el);
  }

  /** Enlaza inputs con data-k="ruta.a.la.clave" a settings */
  function bind(root, after) {
    root.querySelectorAll('[data-k]').forEach((inp) => {
      const path = inp.dataset.k.split('.');
      const get = () => path.reduce((o, k) => (o ? o[k] : undefined), S.data.settings);
      const set = (v) => { let o = S.data.settings; path.slice(0, -1).forEach((k) => { o = o[k]; }); o[path[path.length - 1]] = v; };
      const cur = get();
      if (inp.type === 'checkbox') inp.checked = !!cur;
      else inp.value = cur ?? '';
      inp.addEventListener('change', () => {
        let v = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (inp.dataset.num !== undefined) v = Number(String(v).replace(',', '.')) || 0;
        set(v);
        S.save();
        PZ.toast('Guardado', 'ok', 1200);
        after && after();
      });
    });
  }

  const SECTIONS = {
    negocio(b) {
      b.innerHTML = `<div class="card">
        <div class="grid-2">
          <label class="field"><span>Nombre del local</span><input data-k="business.name"></label>
          <label class="field"><span>Frase / slogan</span><input data-k="business.slogan"></label>
          <label class="field"><span>Dirección</span><input data-k="business.address"></label>
          <label class="field"><span>Localidad</span><input data-k="business.city"></label>
          <label class="field"><span>Teléfono</span><input data-k="business.phone"></label>
          <label class="field"><span>Instagram</span><input data-k="business.instagram" placeholder="@pizzeria"></label>
          <label class="field"><span>CUIT (opcional, sale en el ticket)</span><input data-k="business.cuit"></label>
          <label class="field"><span>Condición fiscal</span><select data-k="business.taxCondition"><option>Monotributista</option><option>Responsable Inscripto</option><option>Exento</option><option value="">No mostrar</option></select></label>
        </div>
        <label class="field" style="max-width:260px"><span>Minutos objetivo de preparación (alerta)</span><input data-k="prepMinutes" data-num inputmode="numeric"></label>
      </div>`;
      bind(b);
    },

    ticket(b, el) {
      const t = S.data.settings.ticket;
      const sample = S.data.orders.filter((o) => o.paid && !o.voided).slice(-1)[0];
      b.innerHTML = `<div class="dash" style="margin-top:0">
        <div class="card">
          <h3>🖨️ Impresora</h3>
          <div class="opt-grid mb">
            ${[['browser', '🖥️ Del sistema / PDF', 'Usa el diálogo de impresión. Funciona con cualquier impresora instalada (USB, WiFi) o para guardar PDF.'],
               ['bluetooth', '📶 Bluetooth directo', 'Térmica ESC/POS desde Chrome en Android. Imprime sin diálogo.'],
               ['rawbt', '🤖 App RawBT', 'Android: envía el ticket a la app gratuita RawBT, que maneja la impresora.']]
              .map(([k, l, d]) => `<button class="opt ${t.printMode === k ? 'on' : ''}" data-pm="${k}">${l}<small>${d}</small></button>`).join('')}
          </div>
          ${t.printMode === 'bluetooth' ? '<button class="btn ghost mb" data-a="bt">📶 Buscar y conectar impresora</button>' : ''}
          <div class="grid-2">
            <label class="field"><span>Ancho del papel</span><select data-k="ticket.width" data-num><option value="80">80 mm (común)</option><option value="58">58 mm (portátil)</option></select></label>
            <label class="field"><span>Copias del comprobante</span><select data-k="ticket.copies" data-num><option value="1">1</option><option value="2">2 (original + copia)</option></select></label>
            <label class="field"><span>Punto de venta (Nº)</span><input data-k="ticket.pos" data-num inputmode="numeric"></label>
            <label class="field"><span>Título del papel</span><select data-k="ticket.docTitle"><option>Comprobante de pago</option><option>Recibo</option><option>Ticket</option><option>Comprobante de venta</option></select></label>
            <label class="field"><span>QR al pie del ticket</span><select data-k="ticket.qrMode"><option value="instagram">Instagram del local</option><option value="custom">Link propio (reseñas, menú…)</option><option value="none">Sin QR</option></select></label>
          </div>
          ${t.qrMode === 'custom' ? '<label class="field"><span>Link del QR</span><input data-k="ticket.qrText" placeholder="https://g.page/r/... (reseñas de Google)"></label>' : ''}
          <label class="field"><span>Mensaje al pie</span><input data-k="ticket.footer"></label>
          <label class="field"><span>Leyenda legal</span><input data-k="ticket.legend"></label>
          <label class="check"><input type="checkbox" data-k="ticket.showLogo"> Mostrar logo</label>
          <label class="check"><input type="checkbox" data-k="ticket.autoPrint"> Imprimir automáticamente al cobrar</label>
          <label class="check"><input type="checkbox" data-k="ticket.printKitchen"> Imprimir comanda para cocina</label>
          ${t.printMode !== 'browser' ? '<label class="check"><input type="checkbox" data-k="ticket.escposAccents"> Imprimir acentos y ñ (si salen símbolos raros, desactivalo)</label>' : ''}
          <div class="row-flex mt">
            <div class="logo-preview">${t.logo ? `<img src="${t.logo}" alt="">` : PZ.brandLogo(60)}</div>
            <div class="row-flex" style="flex-direction:column;align-items:flex-start">
              <label class="btn ghost sm">📷 Subir logo<input type="file" accept="image/*" data-a="logo" hidden></label>
              ${t.logo ? '<button class="btn ghost sm" data-a="rmlogo">Quitar logo</button>' : ''}
            </div>
          </div>
          <button class="btn primary mt" data-a="test">🖨️ Imprimir ticket de prueba</button>
        </div>
        <div class="card"><h3>👀 Vista previa</h3>
          <div class="ticket-stage" style="max-height:none">${sample ? PZ.ticket.customerHTML(sample) : '<p class="muted">Hacé una venta para ver la vista previa.</p>'}</div>
        </div>
      </div>`;
      bind(b, () => render(el));
      b.querySelectorAll('[data-pm]').forEach((x) => x.onclick = () => { t.printMode = x.dataset.pm; S.save(); render(el); });
      const bt = b.querySelector('[data-a=bt]');
      if (bt) bt.onclick = () => PZ.ticket.connectBluetooth();
      b.querySelector('[data-a=test]').onclick = () => PZ.ticket.testPrint();
      b.querySelector('[data-a=logo]').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        t.logo = await U.shrinkImage(await U.readFileAsDataURL(file), 400);
        S.save(); render(el);
      };
      const rm = b.querySelector('[data-a=rmlogo]');
      if (rm) rm.onclick = () => { t.logo = null; S.save(); render(el); };
    },

    cobros(b, el) {
      const p = S.data.settings.payments;
      b.innerHTML = `<div class="dash" style="margin-top:0">
        <div class="card"><h3>🏦 Transferencias</h3>
          <div class="grid-2">
            <label class="field"><span>Alias</span><input data-k="payments.alias"></label>
            <label class="field"><span>CBU / CVU</span><input data-k="payments.cbu" inputmode="numeric"></label>
            <label class="field"><span>Titular</span><input data-k="payments.holder"></label>
            <label class="field"><span>Banco / billetera</span><input data-k="payments.bank"></label>
          </div>
          <h3 class="mt">💵 Reglas</h3>
          <div class="grid-2">
            <label class="field"><span>% descuento pagando en efectivo</span><input data-k="payments.cashDiscountPct" data-num inputmode="decimal"></label>
            <label class="field"><span>% recargo con tarjeta</span><input data-k="payments.cardSurchargePct" data-num inputmode="decimal"></label>
          </div>
          <label class="check"><input type="checkbox" data-k="payments.enableCard"> Aceptar tarjeta (posnet)</label>
          <label class="field mt"><span>Mitad y mitad: ¿cómo se cobra?</span><select data-k="halfPricing"><option value="max">Se cobra la mitad más cara</option><option value="avg">Promedio de las dos</option></select></label>
        </div>
        <div class="card"><h3>📱 QR de cobro</h3>
          <p class="muted small" style="margin-top:0">Subí la foto del QR de tu cuenta de Mercado Pago (o de otra billetera) y se muestra en pantalla al cobrar. También podés pegar un link de pago y se genera el QR.</p>
          <div class="qr-pay"><div class="qr-frame">${p.qrImage ? `<img src="${p.qrImage}" alt="">` : p.qrLink ? U.qrSvg(p.qrLink, 6, 1) : '<div style="width:220px;height:220px;display:grid;place-items:center;color:#999">Sin QR</div>'}</div></div>
          <div class="row-flex mt" style="justify-content:center">
            <label class="btn ghost sm">📷 Subir imagen del QR<input type="file" accept="image/*" data-a="qr" hidden></label>
            ${p.qrImage ? '<button class="btn ghost sm" data-a="rmqr">Quitar</button>' : ''}
          </div>
          <label class="field mt"><span>…o link de pago</span><input data-k="payments.qrLink" placeholder="https://link.mercadopago.com.ar/..."></label>
        </div>
      </div>
      ${PZ.mp && PZ.mp.enabled() ? `<div class="card mt mp-card">${mpCard()}</div>` : ''}`;
      bind(b, () => render(el));
      if (PZ.mp && PZ.mp.enabled()) {
        bindMp(b, el);
        if (!PZ.mp.state.loaded && !mpTried && navigator.onLine) { mpTried = true; PZ.mp.load().then(() => { if (tab === 'cobros') render(el); }); }
      }
      b.querySelector('[data-a=qr]').onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        p.qrImage = await U.shrinkImage(await U.readFileAsDataURL(f), 600);
        S.save(); render(el);
      };
      const rm = b.querySelector('[data-a=rmqr]');
      if (rm) rm.onclick = () => { p.qrImage = null; S.save(); render(el); };
    },

    delivery(b, el) {
      const st = S.data.settings;
      b.innerHTML = `<div class="dash" style="margin-top:0">
        <div class="card"><h3>📍 Zonas y costo de envío</h3>
          ${st.zones.map((z, i) => `<div class="row-flex" style="margin-bottom:8px"><input data-zn="${i}" value="${U.esc(z.name)}" style="flex:2"><input data-zf="${i}" value="${z.fee}" inputmode="numeric" style="flex:1"><button class="icon-btn" data-zd="${i}">🗑️</button></div>`).join('')}
          <button class="btn ghost sm" data-a="addz">➕ Agregar zona</button>
        </div>
        <div class="card"><h3>🛵 Repartidores</h3>
          ${st.drivers.map((d, i) => `<div class="row-flex" style="margin-bottom:8px"><input data-dn="${i}" value="${U.esc(d)}" class="grow"><button class="icon-btn" data-dd="${i}">🗑️</button></div>`).join('')}
          <button class="btn ghost sm" data-a="addd">➕ Agregar repartidor</button>
        </div>
      </div>`;
      const save = () => { S.save(); PZ.toast('Guardado', 'ok', 1000); };
      b.querySelectorAll('[data-zn]').forEach((i) => i.onchange = () => { st.zones[i.dataset.zn].name = i.value; save(); });
      b.querySelectorAll('[data-zf]').forEach((i) => i.onchange = () => { st.zones[i.dataset.zf].fee = U.parseMoney(i.value); save(); });
      b.querySelectorAll('[data-zd]').forEach((i) => i.onclick = () => { st.zones.splice(Number(i.dataset.zd), 1); save(); render(el); });
      b.querySelectorAll('[data-dn]').forEach((i) => i.onchange = () => { st.drivers[i.dataset.dn] = i.value.trim(); save(); });
      b.querySelectorAll('[data-dd]').forEach((i) => i.onclick = () => { st.drivers.splice(Number(i.dataset.dd), 1); save(); render(el); });
      b.querySelector('[data-a=addz]').onclick = () => { st.zones.push({ id: U.uid('z'), name: 'Nueva zona', fee: 0 }); save(); render(el); };
      b.querySelector('[data-a=addd]').onclick = () => { st.drivers.push('Nuevo repartidor'); save(); render(el); };
    },

    apariencia(b, el) {
      const theme = PZ.app.theme();
      b.innerHTML = `<div class="card"><h3>🍕 Elegí el sabor del sistema</h3>
        <p class="muted small" style="margin-top:0">Se guarda en este equipo: la tablet de cocina puede usar un tema y la caja otro.</p>
        <div class="theme-grid">${PZ.themes.map((t) => `<button class="theme-card ${theme === t.id ? 'on' : ''}" data-th="${t.id}"><div class="sw">${t.sw.map((c) => `<i style="background:${c}"></i>`).join('')}</div>${t.name}<div class="small muted">${t.desc}</div></button>`).join('')}</div>
        <label class="check mt"><input type="checkbox" class="motion" ${localStorage.getItem('pz-motion') === 'off' ? '' : 'checked'}> Animaciones activadas (desactivalas si el equipo es lento)</label>
      </div>`;
      b.querySelectorAll('[data-th]').forEach((x) => x.onclick = () => { PZ.app.setTheme(x.dataset.th); render(el); });
      b.querySelector('.motion').onchange = (e) => { localStorage.setItem('pz-motion', e.target.checked ? 'on' : 'off'); PZ.app.applyTheme(); };
    },

    sistema(b, el) {
      const d = S.data;
      const size = new Blob([JSON.stringify(d)]).size;
      b.innerHTML = `<div class="dash" style="margin-top:0">
        <div class="card"><h3>☁️ Tus datos están en la nube</h3>
          <p class="muted" style="margin-top:0">Todo se guarda automáticamente en la base de datos (Supabase) y queda disponible en cualquier equipo donde ingreses. Además cada equipo guarda una copia para seguir funcionando si se corta internet.</p>
          <div class="bank-box">
            <div class="bk-row"><span>Sucursal</span><b>${U.esc(S.branchName())}</b></div>
            <div class="bk-row"><span>Pedidos cargados en este equipo</span><b>${d.orders.length} (últimos 120 días)</b></div>
            <div class="bk-row"><span>Clientes del negocio</span><b>${d.customers.length}</b></div>
            <div class="bk-row"><span>Copia local</span><b>${(size / 1024).toFixed(0)} KB</b></div>
          </div>
          <button class="btn ghost mt" data-a="exp">⬇️ Descargar copia extra (JSON)</button>
        </div>
        <div class="card"><h3>🧹 Datos de demostración</h3>
          ${d.demo
            ? '<p style="margin-top:0">Esta sucursal tiene <b>ventas de demostración</b>. Borralas antes de empezar a usarla en serio (el menú, los clientes y la configuración se conservan).</p><button class="btn accent" data-a="demo">🧹 Borrar ventas de demo</button>'
            : `<p class="muted" style="margin-top:0">No hay datos de demo en esta sucursal.</p>${PZ.auth.isAdmin() ? '<button class="btn ghost" data-a="load">🎬 Cargar 2 semanas de ventas de ejemplo</button>' : ''}`}
          ${PZ.auth.isAdmin() && !d.categories.length ? '<button class="btn ghost mt" data-a="menu">📋 Cargar menú de ejemplo</button>' : ''}
        </div>
      </div>
      <div class="card mt"><h3>🕵️ Registro de actividad</h3>
        ${d.audit.length ? d.audit.slice(0, 40).map((a) => `<div class="list-row"><span class="small muted nowrap">${U.dateTime(a.at)}</span><span class="badge">${U.esc(a.action)}</span><span class="grow">${U.esc(a.detail)}</span><span class="small muted">${U.esc((S.user(a.userId) || {}).name || '')}</span></div>`).join('') : '<div class="empty small">Sin actividad</div>'}
      </div>`;
      b.querySelector('[data-a=exp]').onclick = () => {
        U.download(`respaldo_${U.stripAccents(S.branchName()).replace(/\W+/g, '_')}_${U.dayKey(Date.now())}.json`, S.exportBackup(), 'application/json');
        S.log('sistema', 'Copia de respaldo descargada');
        S.save();
      };
      const on = (a, fn) => { const x = b.querySelector(`[data-a=${a}]`); if (x) x.onclick = fn; };
      on('demo', async () => {
        if (!(await PZ.confirm('¿Borrar todas las ventas, cajas y movimientos de demostración de esta sucursal?', { danger: true, ok: 'Borrar' }))) return;
        try { await S.clearDemo(); PZ.toast('Listo, sucursal limpia para arrancar 🍕'); } catch (e) { PZ.toast(e.message, 'err'); }
        render(el);
      });
      on('load', async () => {
        if (!(await PZ.confirm('Se van a cargar unas 350 ventas ficticias de las últimas 2 semanas en esta sucursal. Después las podés borrar. ¿Continuar?'))) return;
        try { PZ.toast('Horneando ventas de ejemplo…', 'info'); const n = await PZ.seed.demoHistory(14); PZ.toast(`${n} ventas de demo cargadas`); } catch (e) { PZ.toast(e.message, 'err'); }
        render(el);
      });
      on('menu', async () => { await S.seedIfEmpty({ example: true }); PZ.toast('Menú cargado'); render(el); });
    },
  };

  /* ---------------- Mercado Pago (QR con monto) ---------------- */
  let mpTried = false;
  const PROVINCIAS = ['Buenos Aires', 'Capital Federal', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'];

  function mpCard() {
    const s = PZ.mp.state;
    const title = '<h3>📱 Mercado Pago · QR con el monto</h3>';
    if (!s.loaded) return `${title}<p class="muted">${navigator.onLine ? 'Consultando…' : 'Sin conexión: se revisa al volver internet.'}</p>`;
    if (!s.connected) {
      return `${title}
        <p style="margin-top:0">Al cobrar con QR se genera un código con el <b>monto exacto</b> y el pago <b>se registra solo</b> cuando se acredita (sin revisar la app).</p>
        ${PZ.auth.isOwner() ? `<ol class="small" style="padding-left:18px">
            <li>Entrá a <a href="https://www.mercadopago.com.ar/developers/panel/app" target="_blank" rel="noopener">Mercado Pago Developers → Tus integraciones</a> con la cuenta del local.</li>
            <li>Creá una aplicación para <b>pagos presenciales con código QR</b>.</li>
            <li>En <b>Credenciales de producción</b> copiá el <b>Access Token</b> (empieza con APP_USR-).</li>
            <li>Pegalo acá. Queda guardado en el servidor: nadie del equipo lo puede ver.</li>
          </ol>
          <label class="field"><span>Access Token de producción</span><input class="mp-token" type="password" autocomplete="off" spellcheck="false" placeholder="APP_USR-…"></label>
          <button class="btn primary" data-a="mpconnect">Conectar Mercado Pago</button>`
        : '<p class="muted small">Pedile al dueño que conecte la cuenta de Mercado Pago del negocio.</p>'}`;
    }
    const who = `<p style="margin-top:0">✅ Conectado a la cuenta <b>${U.esc(s.nickname || 'de Mercado Pago')}</b>.</p>`;
    const disc = s.canManage ? '<button class="btn ghost sm mt" data-a="mpoff">Desconectar la cuenta</button>' : '';
    if (!s.branchReady) {
      if (!s.canSetup) return `${title}${who}<p class="muted small">Falta activarlo en esta sucursal: pedíselo al encargado o al dueño.</p>`;
      const b = S.data.settings.business;
      const m = /^(.*?)\s+(\d{1,6})\b/.exec(b.address || '');
      return `${title}${who}
        <p class="small">Falta un paso: registrar esta sucursal en Mercado Pago (se hace una sola vez). La ubicación tiene que ser la real del local.</p>
        <div class="grid-2">
          <label class="field"><span>Calle</span><input name="mp-street" value="${U.esc(m ? m[1] : b.address || '')}"></label>
          <label class="field"><span>Número</span><input name="mp-num" inputmode="numeric" value="${U.esc(m ? m[2] : '')}"></label>
          <label class="field"><span>Ciudad / localidad</span><input name="mp-city" value="${U.esc(b.city || '')}"></label>
          <label class="field"><span>Provincia</span><select name="mp-state">${PROVINCIAS.map((p) => `<option>${p}</option>`).join('')}</select></label>
          <label class="field"><span>Latitud</span><input name="mp-lat" inputmode="decimal" placeholder="-34.6037"></label>
          <label class="field"><span>Longitud</span><input name="mp-lng" inputmode="decimal" placeholder="-58.3816"></label>
        </div>
        <div class="row-flex" style="gap:8px">
          <button class="btn ghost sm" data-a="mpgeo">📍 Usar la ubicación de este equipo (estando en el local)</button>
          <a class="btn ghost sm" href="https://www.google.com/maps" target="_blank" rel="noopener">🗺️ Buscar en Google Maps</a>
        </div>
        <p class="small muted">En Google Maps: mantené apretado sobre el local y copiá los dos números (latitud, longitud).</p>
        <button class="btn primary mt" data-a="mpsetup">Activar en esta sucursal</button>${disc}`;
    }
    return `${title}${who}
      <div class="alert-row" style="background:color-mix(in srgb,#00b1ea 14%,var(--card))">📱 Listo: al cobrar elegí <b>QR</b> y se genera el código con el monto. El cobro se registra solo al acreditarse.</div>
      <p class="small muted">Las comisiones son las de tu cuenta de Mercado Pago. Para probar, hacé una venta chica y pagala con tu celular.</p>${disc}`;
  }

  function bindMp(b, el) {
    const on = (a, fn) => { const x = b.querySelector(`[data-a=${a}]`); if (x) x.onclick = fn; };
    const busy = async (btn, fn) => {
      btn.disabled = true;
      try { await fn(); } catch (e) { PZ.toast(e.message, 'err', 6000); } finally { btn.disabled = false; render(el); }
    };
    on('mpconnect', (e) => busy(e.currentTarget, async () => {
      const tk = b.querySelector('.mp-token').value.trim();
      if (!tk) throw new Error('Pegá el Access Token');
      await PZ.mp.connect(tk);
      S.log('mercado pago', 'Cuenta conectada');
      PZ.toast('Mercado Pago conectado');
    }));
    on('mpoff', async (e) => {
      if (!(await PZ.confirm('¿Desconectar Mercado Pago? El QR con monto deja de funcionar en todas las sucursales.', { danger: true, ok: 'Desconectar' }))) return;
      busy(e.target, async () => { await PZ.mp.disconnect(); S.log('mercado pago', 'Cuenta desconectada'); });
    });
    on('mpgeo', () => {
      if (!navigator.geolocation) return PZ.toast('Este equipo no permite ver la ubicación', 'warn');
      navigator.geolocation.getCurrentPosition(
        (p) => { b.querySelector('[name=mp-lat]').value = p.coords.latitude.toFixed(6); b.querySelector('[name=mp-lng]').value = p.coords.longitude.toFixed(6); PZ.toast('Ubicación cargada'); },
        () => PZ.toast('No se pudo obtener la ubicación. Cargala desde Google Maps.', 'warn', 5000),
        { enableHighAccuracy: true, timeout: 15000 },
      );
    });
    on('mpsetup', (e) => busy(e.currentTarget, async () => {
      const v = (n) => b.querySelector(`[name=${n}]`).value.trim();
      const num = (n) => Number(v(n).replace(',', '.'));
      await PZ.mp.setup({ street_name: v('mp-street'), street_number: v('mp-num'), city_name: v('mp-city'), state_name: v('mp-state'), latitude: num('mp-lat'), longitude: num('mp-lng') });
      S.log('mercado pago', `Sucursal activada en Mercado Pago`);
      PZ.toast('¡Listo! Ya podés cobrar con QR con monto');
    }));
  }

  PZ.views.config = { title: 'Configuración', render };
})(window.PZ);
