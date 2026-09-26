// @ts-check
/* ==========================================================================
   PZ.carta — lógica de la carta online, sin pantalla:
     · precios (igual que el mostrador y que la base de datos)
     · horario de atención (hora de Argentina)
     · mensaje de WhatsApp con el pedido
     · temas de colores
   La usan la carta pública (carta.html), el panel de la sucursal y las pruebas.
   ========================================================================== */
(function (PZ) {
  const TZ = 'America/Argentina/Buenos_Aires';
  const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const moneyFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  /** @param {number} n */
  const money = (n) => moneyFmt.format(Math.round(Number(n) || 0)).replace(/ /g, ' ');

  /** Temas listos (el dueño después puede cambiar cada color) */
  const THEMES = [
    { id: 'margherita', name: 'Margherita', primary: '#d7263d', accent: '#ffd166', bg: '#fff8ec', dark: false },
    { id: 'pepperoni', name: 'Pepperoni', primary: '#b3261e', accent: '#ff8c42', bg: '#fff4ea', dark: false },
    { id: 'fugazzeta', name: 'Fugazzeta', primary: '#b7791f', accent: '#7a8b3a', bg: '#fdf6e3', dark: false },
    { id: 'rucula', name: 'Rúcula', primary: '#3f7d20', accent: '#e56b6f', bg: '#f6f8ee', dark: false },
    { id: 'napolitana', name: 'Napolitana', primary: '#1d3557', accent: '#e63946', bg: '#f1faee', dark: false },
    { id: 'horno', name: 'Horno de barro', primary: '#ff6b35', accent: '#ffb347', bg: '#17110e', dark: true },
    { id: 'pizarra', name: 'Pizarrón', primary: '#f4d35e', accent: '#ee964b', bg: '#1f2a2e', dark: true },
  ];

  const FONTS = {
    redonda: { name: 'Redonda y amigable', head: "'Fredoka', system-ui, sans-serif", body: "'Nunito', system-ui, sans-serif" },
    clasica: { name: 'Clásica de trattoria', head: "'Playfair Display', Georgia, serif", body: "'Lato', system-ui, sans-serif" },
    moderna: { name: 'Moderna', head: "'Poppins', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif" },
  };

  /** @returns {PZ.CartaSettings} */
  function defaults() {
    const t = THEMES[0];
    return {
      enabled: false,
      whatsapp: '',
      paused: false,
      hours: { mode: 'always', days: [0, 1, 2, 3, 4, 5, 6], from: '19:00', to: '23:30' },
      types: { retiro: true, delivery: true, mesa: false },
      payments: { efectivo: true, transferencia: true, tarjeta: false },
      minOrder: 0,
      welcome: '¡Hacé tu pedido y te lo confirmamos por WhatsApp!',
      cover: '',
      logo: '',
      showPhotos: true,
      theme: { preset: t.id, primary: t.primary, accent: t.accent, bg: t.bg, font: 'redonda', layout: 'grilla', dark: false },
    };
  }

  /* ---------------- Colores ---------------- */
  /** @param {string} hex */
  function rgb(hex) {
    const h = String(hex || '').replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
    const n = parseInt(full, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  /** Luminancia relativa (WCAG) @param {string} hex */
  function luminance(hex) {
    const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  /** @param {string} a @param {string} b */
  function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  }
  /** Texto legible (blanco o casi negro) sobre un color @param {string} bg */
  const inkOn = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#1d1b19') ? '#ffffff' : '#1d1b19');

  /**
   * Variables CSS del tema. El texto se elige solo para que siempre se lea.
   * @param {Partial<PZ.CartaTheme>} theme
   */
  function themeVars(theme) {
    const t = { ...defaults().theme, ...(theme || {}) };
    const dark = luminance(t.bg) < 0.2;
    const font = FONTS[t.font] || FONTS.redonda;
    return {
      '--c-primary': t.primary,
      '--c-on-primary': inkOn(t.primary),
      '--c-accent': t.accent,
      '--c-on-accent': inkOn(t.accent),
      '--c-bg': t.bg,
      '--c-ink': dark ? '#f7efe6' : '#1d1b19',
      '--c-muted': dark ? 'rgba(247,239,230,.68)' : 'rgba(29,27,25,.62)',
      '--c-card': dark ? 'rgba(255,255,255,.06)' : '#ffffff',
      '--c-line': dark ? 'rgba(255,255,255,.12)' : 'rgba(29,27,25,.1)',
      '--c-font-head': font.head,
      '--c-font-body': font.body,
      '--c-scheme': dark ? 'dark' : 'light',
    };
  }

  /* ---------------- Horario ---------------- */
  /** Día (0 = domingo) y minutos del día en Argentina @param {Date} date */
  function localTime(date) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const get = (/** @type {string} */ t) => (parts.find((p) => p.type === t) || { value: '' }).value;
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { dow, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
  }
  /** "19:30" → 1170 @param {string} s */
  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };

  /**
   * ¿Está tomando pedidos? (misma regla que la base de datos)
   * @param {Partial<PZ.CartaSettings>} online
   * @param {Date} [date]
   */
  function isOpen(online, date = new Date()) {
    if (!online || online.paused) return false;
    const h = online.hours;
    if (!h || h.mode !== 'schedule') return true;
    const days = Array.isArray(h.days) ? h.days : [0, 1, 2, 3, 4, 5, 6];
    const f = toMin(h.from);
    const e = toMin(h.to);
    if (f < 0 || e < 0) return true;
    const { dow, minutes } = localTime(date);
    if (f <= e) return days.includes(dow) && minutes >= f && minutes < e;
    // cruza la medianoche (ej: 19:00 a 01:00)
    return (days.includes(dow) && minutes >= f) || (days.includes((dow + 6) % 7) && minutes < e);
  }

  /** "Mar a Dom · 19:00 a 23:30" @param {PZ.CartaHours} h */
  function hoursText(h) {
    if (!h || h.mode !== 'schedule') return 'Todos los días';
    const d = [...new Set(h.days || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    let days = '';
    if (d.length === 7) days = 'Todos los días';
    else if (!d.length) days = 'Cerrado';
    else {
      // tramos consecutivos empezando el lunes: "Mar a Dom", "Lun, Mié y Vie"
      const order = d.map((x) => (x + 6) % 7);
      const consecutive = order.every((x, i) => i === 0 || x === order[i - 1] + 1);
      days = consecutive && d.length > 2 ? `${DAYS[d[0]]} a ${DAYS[d[d.length - 1]]}`
        : d.map((x) => DAYS[x]).join(', ').replace(/, ([^,]*)$/, ' y $1');
    }
    return `${days} · ${h.from} a ${h.to}`;
  }

  /* ---------------- Precios ---------------- */
  /**
   * Precio unitario de una línea: tamaño, mitad y mitad y agregados.
   * Misma cuenta que el mostrador (store.makeItem) y que la base (carta_order).
   * @param {PZ.CartaMenu} menu
   * @param {Pick<PZ.CartLine, 'productId' | 'variantId' | 'halfId' | 'extras'>} line
   */
  function priceLine(menu, line) {
    const p = menu.products.find((x) => x.id === line.productId);
    if (!p) return null;
    const cat = menu.categories.find((c) => c.id === p.categoryId);
    const v = p.variants.find((x) => x.id === line.variantId) || p.variants[0];
    if (!v) return null;
    let unit = Number(v.price) || 0;
    /** @type {PZ.Product | null} */
    let half = null;
    if (line.halfId && cat && cat.allowHalf) {
      half = menu.products.find((x) => x.id === line.halfId) || null;
      if (half) {
        const hv = half.variants.find((x) => x.id === v.id) || half.variants[0];
        const p2 = Number(hv.price) || 0;
        unit = menu.settings.halfPricing === 'avg' ? Math.round((unit + p2) / 2) : Math.max(unit, p2);
      }
    }
    const extras = cat && cat.allowHalf ? menu.extras.filter((x) => (line.extras || []).includes(x.id)) : [];
    unit += extras.reduce((a, x) => a + (Number(x.price) || 0), 0);
    return {
      product: p,
      variant: v,
      half,
      extras,
      name: half ? `½ ${p.name} + ½ ${half.name}` : p.name,
      variantName: p.variants.length > 1 ? v.name : '',
      unit,
    };
  }

  /**
   * Totales del carrito.
   * @param {PZ.CartaMenu} menu
   * @param {PZ.CartLine[]} lines
   * @param {{ type?: PZ.WebOrderType, zoneId?: string | null }} [opts]
   */
  function totals(menu, lines, opts = {}) {
    let subtotal = 0;
    let count = 0;
    for (const l of lines) {
      const pl = priceLine(menu, l);
      if (!pl) continue;
      subtotal += pl.unit * l.qty;
      count += l.qty;
    }
    const zone = opts.type === 'delivery' ? (menu.settings.zones || []).find((z) => z.id === opts.zoneId) : null;
    const deliveryFee = zone ? Number(zone.fee) || 0 : 0;
    return { subtotal, deliveryFee, total: subtotal + deliveryFee, count };
  }

  /** Quita del carrito lo que ya no existe en la carta (precios o productos que cambiaron)
   * @param {PZ.CartaMenu} menu @param {PZ.CartLine[]} lines */
  const validLines = (menu, lines) => (lines || []).filter((l) => l && l.qty > 0 && priceLine(menu, l));

  /* ---------------- WhatsApp ---------------- */
  /** Número para wa.me (Argentina: 54 9 + característica + número, sin 0 ni 15)
   * @param {string} phone */
  function waNumber(phone) {
    let p = String(phone || '').replace(/\D/g, '');
    if (!p) return '';
    if (p.startsWith('00')) p = p.slice(2);
    if (p.startsWith('54')) p = p.slice(2);
    if (p.startsWith('9') && p.length === 11) p = p.slice(1);
    if (p.startsWith('0')) p = p.slice(1);
    // 11 15 5555-1234 → 11 5555-1234 (el 15 no va en formato internacional)
    const m = /^(\d{2,4})15(\d{6,8})$/.exec(p);
    if (m && m[1].length + m[2].length === 10) p = m[1] + m[2];
    return p.length === 10 ? '549' + p : p.length > 10 ? p : '';
  }
  /** @param {string} phone @param {string} text */
  const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;

  const TYPE_LABEL = { retiro: 'Retiro en el local', delivery: 'Delivery', mesa: 'Para comer en el local' };
  const PAY_LABEL = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta (débito o crédito)' };

  /** @param {string | number | Date} d */
  function shortDate(d) {
    const x = new Date(d);
    const f = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(x);
    const g = (/** @type {string} */ t) => (f.find((p) => p.type === t) || { value: '' }).value;
    return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
  }

  /**
   * Mensaje que el cliente manda al local con todos los datos del pedido.
   * @param {{ business: string, branch?: string }} shop
   * @param {PZ.WebOrder} o  pedido tal como lo guardó el servidor
   * @param {{ trackUrl?: string, transfer?: PZ.CartaMenu['settings']['transfer'] }} [extra]
   */
  function waMessage(shop, o, extra = {}) {
    const L = [];
    L.push(`🍕 *${shop.business}*${shop.branch ? ` · ${shop.branch}` : ''} — Pedido online`);
    L.push(`Fecha: ${shortDate(o.createdAt)}`);
    L.push(`Número: *W-${o.number}*`);
    L.push(`Tipo de pedido: *${TYPE_LABEL[o.type] || o.type}*${o.type === 'mesa' && o.table ? ` · Mesa *${o.table}*` : ''}`);
    if (extra.trackUrl) L.push(`Seguimiento: ${extra.trackUrl}`);
    L.push('');
    L.push('*• Datos del cliente*');
    L.push(`Nombre: *${o.name}*`);
    L.push(`Teléfono: *${o.phone}*`);
    if (o.type === 'delivery') L.push(`Dirección: *${o.address}*${o.zoneName ? ` (${o.zoneName})` : ''}`);
    const cash = o.payment === 'efectivo' && o.cashWith ? ` · paga con ${money(o.cashWith)} (vuelto ${money(Math.max(0, o.cashWith - o.total))})` : '';
    L.push(`Medio de pago: *${PAY_LABEL[o.payment] || o.payment}*${cash}`);
    L.push('');
    L.push('*• Detalle del pedido*');
    for (const it of o.items) {
      L.push(`${it.qty} x *${it.name}*${it.variantName ? ` (${it.variantName})` : ''} — ${money(it.unitPrice * it.qty)}`);
      if (it.extras && it.extras.length) L.push(`   + ${it.extras.map((x) => x.name).join(', ')}`);
      if (it.notes) L.push(`   _${it.notes}_`);
    }
    L.push('');
    if (o.deliveryFee) {
      L.push(`Subtotal: ${money(o.subtotal)}`);
      L.push(`Envío: ${money(o.deliveryFee)}`);
    }
    L.push(`*Total: ${money(o.total)}*`);
    if (o.notes) { L.push(''); L.push(`📝 Aclaraciones: ${o.notes}`); }
    const t = extra.transfer;
    if (o.payment === 'transferencia' && t && (t.alias || t.cbu)) {
      L.push('');
      L.push(`🏦 Transfiero a ${[t.alias && `alias *${t.alias}*`, t.cbu && `CBU ${t.cbu}`].filter(Boolean).join(' · ')}${t.holder ? ` (${t.holder})` : ''} y envío el comprobante.`);
    }
    return L.join('\n');
  }

  /* ---------------- Varios ---------------- */
  /** "Pizzería Diego — Centro" → "pizzeria-diego-centro" @param {string} s */
  const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  const validSlug = (/** @type {string} */ s) => /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(String(s || ''));

  /** Dirección pública de la carta @param {string} base @param {string} slug */
  const cartaUrl = (base, slug) => `${String(base).replace(/[^/]*$/, '')}carta.html?l=${encodeURIComponent(slug)}`;

  PZ.carta = {
    THEMES, FONTS, TYPE_LABEL, PAY_LABEL, DAYS,
    money, defaults, themeVars, contrast, inkOn,
    isOpen, hoursText, localTime,
    priceLine, totals, validLines,
    waNumber, waLink, waMessage, shortDate,
    slugify, validSlug, cartaUrl,
  };
})((window.PZ = window.PZ || {}));
