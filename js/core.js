// @ts-check
/* ==========================================================================
   PZ core — utilidades compartidas (formato, DOM, modales, toasts)
   ========================================================================== */
window.PZ = window.PZ || {};
window.PZ.views = window.PZ.views || {};

(function (PZ) {
  const moneyFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const numFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

  PZ.util = {
    $: (sel, root = document) => root.querySelector(sel),
    $$: (sel, root = document) => Array.from(root.querySelectorAll(sel)),

    uid: (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),

    money: (n) => moneyFmt.format(Math.round(Number(n) || 0)),
    num: (n) => numFmt.format(Number(n) || 0),

    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),

    date: (d) => new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: (d) => new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    dateTime: (d) => PZ.util.date(d) + ' ' + PZ.util.time(d),

    dayKey: (d) => {
      const x = new Date(d);
      return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    },
    startOfDay: (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; },

    minutesSince: (d) => Math.floor((Date.now() - new Date(d).getTime()) / 60000),

    parseMoney: (v) => {
      if (typeof v === 'number') return v;
      const s = String(v || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
      return Number(s) || 0;
    },

    stripAccents: (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''),

    async sha256(text) {
      if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
      }
      // Fallback (contexto no seguro): hash simple, suficiente para demo local
      let h = 5381;
      for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
      return 'djb2-' + (h >>> 0).toString(16);
    },

    debounce(fn, ms = 250) {
      let t;
      return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    },

    readFileAsDataURL(file) {
      return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
    },

    /**
     * Reduce una imagen a un tamaño máximo (para no llenar el almacenamiento).
     * PNG para lo que tiene bordes nítidos (un QR); JPEG para logos y fotos,
     * que pesan diez veces menos.
     * @param {string} dataURL @param {number} [maxW] @param {string} [type] @param {number} [quality]
     */
    async shrinkImage(dataURL, maxW = 400, type = 'image/png', quality = 0.9) {
      const img = await PZ.util.loadImage(dataURL);
      const scale = Math.min(1, maxW / img.width, (maxW * 2) / img.height);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL(type, quality);
    },

    /** Foto lista para subir: JPEG de hasta maxW px de ancho (livianita para el celular del cliente) */
    async imageBlob(file, maxW = 900, quality = 0.82) {
      const img = await PZ.util.loadImage(await PZ.util.readFileAsDataURL(file));
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo leer la imagen'))), 'image/jpeg', quality));
    },

    loadImage(src) {
      return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
      });
    },

    download(filename, content, type = 'text/plain') {
      const blob = content instanceof Blob ? content : new Blob([content], { type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },

    qrSvg(text, cell = 4, margin = 2) {
      const qrFn = typeof qrcode !== 'undefined' ? qrcode : (typeof window !== 'undefined' && window.qrcode ? window.qrcode : (typeof globalThis !== 'undefined' ? globalThis.qrcode : null));
      if (!qrFn || !text) return '';
      try {
        if (qrFn.stringToBytesFuncs && qrFn.stringToBytesFuncs['UTF-8']) {
          qrFn.stringToBytes = qrFn.stringToBytesFuncs['UTF-8'];
        }
        const qr = qrFn(0, 'M');
        qr.addData(text);
        qr.make();
        const svg = qr.createSvgTag({ cellSize: cell, margin, scalable: false });
        if (svg) return svg;
        const durl = qr.createDataURL(cell, margin);
        return `<img src="${durl}" width="${cell * 41}" height="${cell * 41}" style="width:100%;height:auto;display:block" alt="Código QR">`;
      } catch (e) {
        console.error('[PZ.util.qrSvg error]', e);
        try {
          const qr = qrFn(0, 'M');
          qr.addData(text);
          qr.make();
          const durl = qr.createDataURL(cell, margin);
          return `<img src="${durl}" width="${cell * 41}" height="${cell * 41}" style="width:100%;height:auto;display:block" alt="Código QR">`;
        } catch (e2) {
          return '';
        }
      }
    },

    qrDataUrl(text, cell = 5, margin = 2) {
      const qrFn = typeof qrcode !== 'undefined' ? qrcode : (typeof window !== 'undefined' && window.qrcode ? window.qrcode : (typeof globalThis !== 'undefined' ? globalThis.qrcode : null));
      if (!qrFn || !text) return '';
      try {
        if (qrFn.stringToBytesFuncs && qrFn.stringToBytesFuncs['UTF-8']) {
          qrFn.stringToBytes = qrFn.stringToBytesFuncs['UTF-8'];
        }
        const qr = qrFn(0, 'M');
        qr.addData(text);
        qr.make();
        return qr.createDataURL(cell, margin);
      } catch (e) {
        return '';
      }
    },

    /** CUIL/CUIT argentino: 11 dígitos con dígito verificador (módulo 11) */
    cuilDigits: (v) => String(v || '').replace(/\D/g, ''),
    validCuil(v) {
      const d = PZ.util.cuilDigits(v);
      if (!/^(20|23|24|25|26|27|30|33|34)\d{9}$/.test(d)) return false;
      const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
      const sum = w.reduce((a, x, i) => a + x * Number(d[i]), 0);
      let check = 11 - (sum % 11);
      if (check === 11) check = 0;
      if (check === 10) return false;
      return check === Number(d[10]);
    },
    formatCuil(v) {
      const d = PZ.util.cuilDigits(v);
      return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d;
    },

    /**
     * Rango de fechas común a todas las pantallas.
     * key: hoy | ayer | 7d | 30d | mes | mesant | custom ({from:'YYYY-MM-DD', to})
     */
    rangeBounds(key, custom = {}, now = new Date()) {
      const t = PZ.util.startOfDay(now).getTime();
      const end = now.getTime();
      switch (key) {
        case 'hoy': return [t, end];
        case 'ayer': return [t - 864e5, t - 1];
        case '7d': return [t - 6 * 864e5, end];
        case '30d': return [t - 29 * 864e5, end];
        case 'mes': return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end];
        case 'mesant': return [new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1];
        case 'custom': return [custom.from ? new Date(custom.from + 'T00:00').getTime() : t, custom.to ? new Date(custom.to + 'T23:59:59').getTime() : end];
        default: return [t, end];
      }
    },

    phoneForWa(phone) {
      let p = String(phone || '').replace(/\D/g, '');
      if (!p) return '';
      if (p.startsWith('0')) p = p.slice(1);
      if (!p.startsWith('54')) p = '549' + p;
      return p;
    },
  };

  /* ---------- Toasts ---------- */
  PZ.toast = function (msg, type = 'ok', ms = 2600) {
    let wrap = document.getElementById('toasts');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toasts';
      document.body.appendChild(wrap);
    }
    const icons = { ok: '🍕', warn: '🌶️', err: '🔥', info: '🧀' };
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.innerHTML = `<span class="toast-ico">${icons[type] || '🍕'}</span><span>${PZ.util.esc(msg)}</span>`;
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, ms);
  };

  /* ---------- Modales ---------- */
  /**
   * Ventana emergente.
   * @param {{ title?: string, body?: string, footer?: string, size?: string, dismissable?: boolean,
   *   onOpen?: (el: HTMLElement, api: { el: HTMLElement, close: () => void }) => void, onClose?: () => void }} [opts]
   */
  PZ.modal = function ({ title = '', body = '', footer = '', size = '', onOpen, onClose, dismissable = true } = {}) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal ${size}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${title}</h3>
          ${dismissable ? '<button class="icon-btn modal-x" aria-label="Cerrar">✕</button>' : ''}
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>`;
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));
    const api = {
      el: /** @type {HTMLElement} */ (back.querySelector('.modal')),
      close() {
        back.classList.remove('show');
        document.removeEventListener('keydown', onKey);
        setTimeout(() => back.remove(), 250);
        onClose && onClose();
      },
    };
    // Escape cierra solo la ventana de arriba (no la que quedó abajo)
    const onKey = (e) => { if (e.key === 'Escape' && dismissable && back === Array.from(document.querySelectorAll('.modal-back')).pop()) api.close(); };
    document.addEventListener('keydown', onKey);
    if (dismissable) {
      back.addEventListener('mousedown', (e) => { if (e.target === back) api.close(); });
      /** @type {HTMLElement} */ (back.querySelector('.modal-x')).addEventListener('click', () => api.close());
    }
    onOpen && onOpen(api.el, api);
    const first = /** @type {HTMLElement | null} */ (api.el.querySelector('[autofocus]'));
    if (first) setTimeout(() => first.focus(), 60);
    return api;
  };

  PZ.confirm = function (message, { title = 'Confirmar', ok = 'Sí, continuar', danger = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const m = PZ.modal({
        title,
        size: 'sm',
        body: `<p class="confirm-msg">${message}</p>`,
        footer: `<button class="btn ghost" data-a="no">Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${ok}</button>`,
        onClose: () => { if (!done) resolve(false); },
      });
      m.el.querySelector('[data-a=no]').onclick = () => { done = true; m.close(); resolve(false); };
      m.el.querySelector('[data-a=yes]').onclick = () => { done = true; m.close(); resolve(true); };
    });
  };

  PZ.prompt = function (label, { title = '', value = '', type = 'text', ok = 'Aceptar' } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const m = PZ.modal({
        title: title || label,
        size: 'sm',
        body: `<label class="field"><span>${label}</span><input type="${type}" value="${PZ.util.esc(value)}" autofocus></label>`,
        footer: `<button class="btn ghost" data-a="no">Cancelar</button><button class="btn primary" data-a="yes">${ok}</button>`,
        onClose: () => { if (!done) resolve(null); },
      });
      const inp = m.el.querySelector('input');
      const accept = () => { done = true; const v = inp.value; m.close(); resolve(v); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') accept(); });
      m.el.querySelector('[data-a=no]').onclick = () => { done = true; m.close(); resolve(null); };
      m.el.querySelector('[data-a=yes]').onclick = accept;
    });
  };

  /* ---------- Aviso sonoro (pedido nuevo) ---------- */
  PZ.beep = function (notes = [784, 1046]) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      notes.forEach((f, i) => {
        const t = i * 0.18;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.2, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.26);
      });
    } catch (e) { /* sin audio */ }
  };

  /* ---------- Notificaciones nativas del navegador (100% gratuitas) ---------- */
  PZ.requestNotificationPermission = async function () {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    try {
      return await Notification.requestPermission();
    } catch (_) {
      return 'denied';
    }
  };

  PZ.notify = async function (title, options = {}) {
    // 1. Audio chime gratuito sintetizado
    if (PZ.beep) PZ.beep(options.notes || [784, 1046]);

    // 2. Vibración háptica en celulares
    if ('vibrate' in navigator) {
      try { navigator.vibrate(options.vibrate || [200, 100, 200]); } catch (_) {}
    }

    // 3. Notificación nativa de escritorio o móvil si está autorizada
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification(title, {
          icon: 'img/icon.svg',
          badge: 'img/icon.svg',
          ...options,
        });
        if (options.onClick) {
          notif.onclick = () => {
            if (typeof window.focus === 'function') {
              try { window.focus(); } catch (_) {}
            }
            options.onClick();
          };
        }
        return notif;
      } catch (err) {
        // En Android Chrome se puede invocar via Service Worker si está registrado
        try {
          if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.ready;
            if (reg && reg.showNotification) {
              await reg.showNotification(title, {
                icon: 'img/icon.svg',
                badge: 'img/icon.svg',
                ...options,
              });
            }
          }
        } catch (_) {}
      }
    }
    return null;
  };

  /* ---------- Confeti de pepperoni / albahaca al cobrar ---------- */
  PZ.celebrate = function () {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const layer = document.createElement('div');
    layer.className = 'confetti-layer';
    const kinds = ['pep', 'basil', 'olive', 'cheese', 'tomato'];
    for (let i = 0; i < 38; i++) {
      const s = document.createElement('i');
      s.className = 'cf cf-' + kinds[i % kinds.length];
      s.style.left = Math.random() * 100 + 'vw';
      s.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
      s.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      s.style.animationDelay = (Math.random() * 0.35) + 's';
      s.style.animationDuration = (1.4 + Math.random() * 1.1) + 's';
      layer.appendChild(s);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3000);
  };
})(window.PZ);
