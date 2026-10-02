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
      pickupMinutes: 15,
      deliveryMinutes: 40,
      deliveryFields: { separateAddress: false, floorDept: true, crossStreets: true, notes: true },
      condiments: [
        { id: 'oregano', name: 'Orégano', default: true },
        { id: 'chimi', name: 'Chimi', default: true },
      ],
      salonMenu: {
        categories: [],
        sortBy: 'cat',
        groupByCategory: true,
        pageBreakPerCat: false,
        fontSize: 'md',
        showDesc: true,
        showBadges: true,
        qrToken: '',
      },
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

  /* ---------------- Mitad y mitad ---------------- */
  /**
   * Cómo se puede pedir una pizza por mitades:
   *   'all'  con cualquier otra pizza que también lo permita
   *   'some' solo con las pizzas elegidas en `halfWith`
   *   'none' solo entera
   * @param {Partial<PZ.Product>} p
   * @returns {'all' | 'some' | 'none'}
   */
  const halfMode = (p) => (!p || p.allowHalf === false ? 'none' : Array.isArray(p.halfWith) ? 'some' : 'all');

  /**
   * ¿Se pueden combinar estas dos pizzas en una mitad y mitad? La regla vale
   * para las dos: si una no acepta a la otra, no se combinan.
   * (Misma regla que la base de datos al recibir pedidos de la carta.)
   * @param {PZ.Product | null | undefined} a
   * @param {PZ.Product | null | undefined} b
   * @param {(id: string) => PZ.Category | null | undefined} categoryOf
   */
  function canPairHalf(a, b, categoryOf) {
    if (!a || !b || a.id === b.id) return false;
    const ca = categoryOf(a.categoryId);
    const cb = categoryOf(b.categoryId);
    if (!ca || !cb || !ca.allowHalf || !cb.allowHalf) return false;
    if (halfMode(a) === 'none' || halfMode(b) === 'none') return false;
    if (Array.isArray(a.halfWith) && !a.halfWith.includes(b.id)) return false;
    if (Array.isArray(b.halfWith) && !b.halfWith.includes(a.id)) return false;
    return true;
  }

  /** Pizzas que pueden ir como la otra mitad de `p`
   * @param {PZ.Product} p @param {PZ.Product[]} products @param {(id: string) => PZ.Category | null | undefined} categoryOf */
  const halfPartners = (p, products, categoryOf) => products.filter((x) => x.active !== false && canPairHalf(p, x, categoryOf));

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
    const isPizza = !!(cat && cat.allowHalf);
    const categoryOf = (/** @type {string} */ id) => menu.categories.find((c) => c.id === id);
    if (line.halfId && isPizza) {
      const other = menu.products.find((x) => x.id === line.halfId) || null;
      half = other && canPairHalf(p, other, categoryOf) ? other : null;
      if (half) {
        const hv = half.variants.find((x) => x.id === v.id) || half.variants[0];
        const p2 = Number(hv.price) || 0;
        unit = menu.settings.halfPricing === 'avg' ? Math.round((unit + p2) / 2) : Math.max(unit, p2);
      }
    }
    const extras = isPizza ? menu.extras.filter((x) => (line.extras || []).includes(x.id) && extraApplies(x, p, half)) : [];
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
   * Determina si un agregado aplica al producto (por ejemplo: Extra jamón solo en pizzas con jamón)
   */
  function extraApplies(extra, product, half) {
    if (!extra || !/jam[oó]n/i.test(extra.name)) return true;
    const hasJ = (x) => !!(x && (/jam[oó]n/i.test(x.name) || /jam[oó]n/i.test(x.desc || '') || (x.recipe || []).some((r) => r.ingredientId === 'i-jam' || r.ingredientId === 'i-cru')));
    return hasJ(product) || hasJ(half);
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

  const ensureBase = (base) => {
    let s = String(base || '').trim();
    if (!s) return './';
    if (s.endsWith('.html')) s = s.replace(/[^/]*$/, '');
    if (!s.endsWith('/')) s += '/';
    return s;
  };

  /** Dirección pública de la carta @param {string} base @param {string} slug */
  const cartaUrl = (base, slug) => `${ensureBase(base)}carta.html?l=${encodeURIComponent(slug)}`;

  /** Dirección pública de la carta para mesas del salón @param {string} base @param {string} slug @param {string} [qrToken] */
  const salonUrl = (base, slug, qrToken) => `${ensureBase(base)}carta.html?l=${encodeURIComponent(slug)}&vista=carta${qrToken ? `&qr=${encodeURIComponent(qrToken)}` : ''}`;

  const norm = (s) => String(s || '').trim().toLowerCase();
  const KNOWN_RANKS = {
    'u': 1, 'unidad': 1, 'porción': 1, 'porcion': 1, 'individual': 1, 'chica': 2,
    'media': 3, 'mediana': 3, 'media docena': 4,
    'grande': 5, 'docena': 6, 'familiar': 7, 'gigante': 8,
  };

  /**
   * Determina las columnas de variantes para una lista de productos
   * @param {PZ.Product[]} ps
   * @param {PZ.Category} [c]
   */
  function getTableColumns(ps, c) {
    if (!Array.isArray(ps) || !ps.length) return [];
    const hasMultipleVariants = ps.some((p) => (p.variants || []).length > 1);
    if (!hasMultipleVariants) {
      return [];
    }

    const colMap = new Map();
    ps.forEach((p) => {
      const vars = p.variants || [];
      vars.forEach((v) => {
        const raw = String(v.name || '').trim();
        if (!raw) return;
        const key = norm(raw);
        if (vars.length === 1 && norm(p.name) === key) return;

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

    const cols = Array.from(colMap.values()).filter((col) => {
      if (KNOWN_RANKS[col.key]) return true;
      if (col.count >= 2) return true;
      return ps.some((p) => (p.variants || []).length > 1 && (p.variants || []).some((v) => norm(v.name) === col.key));
    }).sort((x, y) => {
      const rx = KNOWN_RANKS[x.key] || 99;
      const ry = KNOWN_RANKS[y.key] || 99;
      if (rx !== ry) return rx - ry;
      return x.avgPrice - y.avgPrice;
    });

    return cols;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ---------------- Fotos de productos ----------------
     Cada producto puede tener una foto (link a una imagen en internet o un
     archivo subido). Donde no hay foto, o el link no carga, se sigue viendo
     el ícono de siempre. */

  /**
   * Link de imagen pegado por el usuario → link directo que se puede mostrar.
   * Entiende los links "para compartir" de Google Drive, Dropbox e Imgur.
   * Devuelve '' si no es un link de imagen utilizable.
   * @param {string} raw
   */
  function imageUrl(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    if (s.startsWith('//')) s = 'https:' + s;
    if (!/^https?:\/\//i.test(s)) {
      if (/^[\w-]+(\.[\w-]+)+\//.test(s)) s = 'https://' + s; // "imgur.com/abc.jpg"
      else return '';
    }
    let u;
    try { u = new URL(s); } catch (e) { return ''; }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'drive.google.com' || host === 'docs.google.com') {
      const m = u.pathname.match(/\/d\/([\w-]{10,})/);
      const id = (m && m[1]) || u.searchParams.get('id');
      return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1200` : '';
    }
    if (host === 'dropbox.com' || host.endsWith('.dropbox.com')) {
      u.searchParams.delete('dl');
      u.searchParams.set('raw', '1');
      return u.toString();
    }
    if (host === 'imgur.com' && /^\/\w{5,}$/.test(u.pathname)) return `https://i.imgur.com${u.pathname}.jpg`;
    return u.toString();
  }

  const PHOTO_POS = { top: 'center 20%', center: 'center', bottom: 'center 80%' };

  /**
   * Foto de un producto con su ícono de respaldo: si no hay foto o el link no
   * carga, se ve el ícono (`fallback`, HTML ya escapado).
   * @param {{ photo?: string, photoPos?: string, name?: string } | null | undefined} p
   * @param {string} fallback
   */
  function pic(p, fallback) {
    if (!p || !p.photo) return fallback;
    const pos = PHOTO_POS[/** @type {'top' | 'center' | 'bottom'} */ (p.photoPos || 'center')] || 'center';
    return `<img class="pz-img" src="${esc(p.photo)}" alt="${esc(p.name || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="object-position:${pos}"><span class="pz-img-fb">${fallback}</span>`;
  }

  // Si una foto no carga (link roto, privado o borrado) se saca y queda el ícono
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('error', (e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (t && t.tagName === 'IMG' && t.classList.contains('pz-img')) {
        if (t.parentElement) t.parentElement.classList.add('pz-img-broken');
        t.remove();
      }
    }, true);
  }

  /**
   * Genera la tabla HTML para una categoría o lista de productos de la carta del salón
   * @param {PZ.Product[]} ps
   * @param {PZ.Category} [c]
   * @param {PZ.SalonMenuConfig} [cfg]
   * @param {boolean} [interactive]
   */
  function renderSalonTable(ps, c, cfg = {}, interactive = false) {
    const cols = getTableColumns(ps, c);
    const multiCol = cols.length > 1;
    const showBadges = cfg.showBadges !== false;
    const showDesc = cfg.showDesc !== false;

    return `
      <table class="tbl carta-tbl" style="width:100%;table-layout:fixed;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 6px">Producto</th>
            ${multiCol ? cols.map((col) => `<th class="right col-price" style="width:115px;text-align:right;padding:8px 6px">${esc(col.label)}</th>`).join('') : '<th class="right col-price" style="width:120px;text-align:right;padding:8px 6px">Precio</th>'}
          </tr>
        </thead>
        <tbody>
          ${ps.map((p) => {
            const vars = p.variants || [];
            const soloEntera = c && c.allowHalf && p.allowHalf === false;
            const clickAttr = interactive ? `data-p="${esc(p.id)}" style="cursor:pointer"` : '';
            const thumb = cfg.showPhotos !== false && p.photo ? `<span class="carta-thumb">${pic(p, '')}</span>` : '';
            const nameCell = `<td style="padding:10px 6px;vertical-align:middle">
              ${thumb}<b style="color:var(--c-ink, #1d1b19);font-size:1.02em">${esc(p.name)}</b>
              ${showBadges && soloEntera ? ' <span class="badge muted" style="font-size:0.75em;vertical-align:middle">Solo entera</span>' : ''}
              ${showDesc && p.desc ? `<div class="small muted" style="margin-top:2px;color:var(--c-muted, rgba(29,27,25,0.65));line-height:1.35">${esc(p.desc)}</div>` : ''}
            </td>`;

            if (!multiCol) {
              const price = vars[0] ? vars[0].price : 0;
              return `<tr ${clickAttr}>${nameCell}<td class="right nowrap col-price" style="width:120px;text-align:right;padding:10px 6px;font-weight:bold;color:var(--c-primary, #d7263d);font-size:1.05em">${money(price)}</td></tr>`;
            }

            const matchesAny = vars.some((v) => cols.some((col) => norm(v.name) === col.key));
            if (vars.length === 1 && !matchesAny) {
              return `<tr ${clickAttr}>${nameCell}<td colspan="${cols.length}" class="right nowrap col-price" style="text-align:right;padding:10px 6px"><b style="color:var(--c-primary, #d7263d)">${money(vars[0].price)}</b>${vars[0].name ? ` <small class="muted">(${esc(vars[0].name)})</small>` : ''}</td></tr>`;
            }

            const priceCells = cols.map((col) => {
              const v = vars.find((x) => norm(x.name) === col.key);
              return `<td class="right nowrap col-price" style="width:115px;text-align:right;padding:10px 6px">${v ? `<b style="color:var(--c-primary, #d7263d)">${money(v.price)}</b>` : '<span class="muted" style="opacity:0.4">—</span>'}</td>`;
            }).join('');

            return `<tr ${clickAttr}>${nameCell}${priceCells}</tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  /**
   * Genera el HTML estructurado de la carta del salón
   * @param {{
   *   shop?: { name?: string, slogan?: string, phone?: string, address?: string, city?: string, instagram?: string, logo?: string },
   *   categories: PZ.Category[],
   *   products: PZ.Product[],
   *   cfg?: PZ.SalonMenuConfig,
   *   interactive?: boolean
   * }} opts
   */
  function renderSalonHtml({ shop, categories, products, cfg = {}, interactive = false }) {
    const prepared = prepareSalonCategories(categories, products, cfg.categories && cfg.categories.length > 0 ? cfg.categories : undefined, cfg.sortBy);

    let contentHtml = '';
    if (!prepared.length) {
      contentHtml = '<div class="empty small" style="padding:32px;text-align:center;color:var(--c-muted, #777)">No hay productos disponibles en las categorías seleccionadas.</div>';
    } else if (cfg.groupByCategory === false) {
      const allProds = prepared.flatMap((x) => x.products);
      const sortedProds = sortProducts(allProds, cfg.sortBy);
      contentHtml = `<div style="margin-top:16px">${renderSalonTable(sortedProds, undefined, cfg, interactive)}</div>`;
    } else {
      contentHtml = prepared.map((item, idx) => {
        const c = item.category;
        const ps = item.products;
        const pageBreakClass = cfg.pageBreakPerCat && idx > 0 ? 'carta-cat-section page-break' : 'carta-cat-section';
        const pageBreakDivider = cfg.pageBreakPerCat && idx > 0
          ? '<div class="page-break-indicator" style="margin:24px 0;text-align:center;border-top:2px dashed var(--c-line, #e2ded9);padding-top:6px;font-size:0.8em;color:var(--c-muted, #777);font-weight:bold"><span class="badge">📄 Salto de página para cartas de varias hojas</span></div>'
          : '';

        return `
          ${pageBreakDivider}
          <div class="${pageBreakClass}" style="margin-top:22px;page-break-inside:avoid;${cfg.pageBreakPerCat && idx > 0 ? 'page-break-before:always;' : ''}">
            <h3 style="margin:0 0 8px;border-bottom:3px dotted var(--c-primary, #d7263d);padding-bottom:4px;display:flex;align-items:center;gap:8px;color:var(--c-ink, #1d1b19)">
              <span>${esc(c.icon)}</span> <span>${esc(c.name)}</span>
              ${cfg.showBadges !== false && c.allowHalf ? '<span class="badge" style="font-size:0.7em;font-weight:normal;margin-left:auto;background:color-mix(in srgb, var(--c-primary, #d7263d) 10%, transparent);color:var(--c-primary, #d7263d);padding:3px 8px;border-radius:6px">🍕 Permite mitad y mitad</span>' : ''}
            </h3>
            ${renderSalonTable(ps, c, cfg, interactive)}
          </div>`;
      }).join('');
    }

    const b = shop || {};
    const logoHtml = b.logo
      ? `<img src="${esc(b.logo)}" alt="" style="width:70px;height:70px;border-radius:50%;object-fit:cover;margin-bottom:6px">`
      : `<div style="width:64px;height:64px;border-radius:50%;background:color-mix(in srgb, var(--c-primary, #d7263d) 12%, transparent);display:grid;place-items:center;font-size:32px;margin:0 auto 6px">🍕</div>`;

    return `
      <div style="text-align:center;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--c-line, #e5e2de)">
        ${logoHtml}
        <h1 style="color:var(--c-primary, #d7263d);margin:4px 0 2px;font-size:1.9em">${esc(b.name || 'Pizzería')}</h1>
        ${b.slogan || b.phone ? `<div class="muted" style="color:var(--c-muted, rgba(29,27,25,0.7));font-size:0.95em">${[b.slogan && esc(b.slogan), b.phone && esc(b.phone)].filter(Boolean).join(' · ')}</div>` : ''}
        ${b.address ? `<div class="muted small" style="margin-top:2px;color:var(--c-muted, rgba(29,27,25,0.6))">📍 ${esc(b.address)}${b.city ? ', ' + esc(b.city) : ''}</div>` : ''}
      </div>
      ${contentHtml}`;
  }

  /**
   * Ordena productos según el criterio configurado
   * @param {PZ.Product[]} prods
   * @param {'cat' | 'price_asc' | 'price_desc' | 'name'} [sortBy]
   */
  function sortProducts(prods, sortBy = 'cat') {
    const minPrice = (/** @type {PZ.Product} */ p) => {
      const vars = p.variants || [];
      if (!vars.length) return 0;
      return Math.min(...vars.map((v) => Number(v.price) || 0));
    };
    const copy = [...prods];
    if (sortBy === 'price_asc') {
      return copy.sort((a, b) => minPrice(a) - minPrice(b) || a.name.localeCompare(b.name, 'es'));
    }
    if (sortBy === 'price_desc') {
      return copy.sort((a, b) => minPrice(b) - minPrice(a) || a.name.localeCompare(b.name, 'es'));
    }
    if (sortBy === 'name') {
      return copy.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }
    return copy.sort((a, b) => (Number(a._i) || 0) - (Number(b._i) || 0));
  }

  /**
   * Filtra y prepara las categorías para la carta del salón
   * @param {PZ.Category[]} categories
   * @param {PZ.Product[]} products
   * @param {string[]} [selectedCatIds]
   * @param {'cat' | 'price_asc' | 'price_desc' | 'name'} [sortBy]
   */
  function prepareSalonCategories(categories, products, selectedCatIds, sortBy = 'cat') {
    const hasFilter = Array.isArray(selectedCatIds) && selectedCatIds.length > 0;
    const catList = categories.filter((c) => {
      if (hasFilter && !selectedCatIds.includes(c.id)) return false;
      return products.some((p) => p.categoryId === c.id && p.active);
    });

    return catList.map((c) => {
      const ps = products.filter((p) => p.categoryId === c.id && p.active);
      const sorted = sortProducts(ps, sortBy);
      return { category: c, products: sorted };
    });
  }

  /**
   * Distancia en kilómetros entre dos coordenadas GPS (Haversine)
   * @param {number} lat1
   * @param {number} lon1
   * @param {number} lat2
   * @param {number} lon2
   */
  function haversineDistance(lat1, lon1, lat2, lon2) {
    if (lat1 === lat2 && lon1 === lon2) return 0;
    const toRad = (/** @type {number} */ x) => (x * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 100) / 100;
  }

  /**
   * Estimación de minutos de llegada según distancia y velocidad media
   * @param {number} distanceKm
   * @param {number} [speedKmh]
   */
  function estimateDeliveryEta(distanceKm, speedKmh = 25) {
    if (!distanceKm || distanceKm <= 0) return 3;
    const travelMins = Math.ceil((distanceKm / Math.max(10, speedKmh)) * 60) + 2;
    return Math.max(2, travelMins);
  }

  /** Dirección pública para la app del repartidor @param {string} base @param {string} slug @param {string} [driver] @param {string} [branchId] @param {string} [code] */
  const repartoUrl = (base, slug, driver = '', branchId = '', code = '') => {
    let url = `${String(base).replace(/[^/]*$/, '')}reparto.html?l=${encodeURIComponent(slug)}`;
    if (branchId) url += `&b=${encodeURIComponent(branchId)}`;
    if (driver) url += `&d=${encodeURIComponent(driver)}`;
    if (code) url += `&c=${encodeURIComponent(code)}`;
    return url;
  };

  /**
   * Genera un identificador único para repartidor (ej: "DEL-101", "DIEGO-005")
   * @param {string} [prefix]
   * @param {number} [num]
   */
  function generateDriverCode(prefix = 'DEL', num = 101) {
    const p = String(prefix || 'DEL').replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'DEL';
    const n = Math.max(1, Math.round(Number(num) || 1));
    const pad = p === 'DEL' ? String(n) : String(n).padStart(3, '0');
    return `${p}-${pad}`;
  }

  /**
   * Parsea un código de repartidor ingresado o de URL
   * @param {string} rawInput
   * @param {string} [fallbackSlug]
   */
  function parseDriverCode(rawInput, fallbackSlug = '') {
    const raw = String(rawInput || '').trim().toUpperCase();
    if (!raw) return { slug: fallbackSlug || '', code: '', driverNum: '' };

    if (raw.includes('-')) {
      const parts = raw.split('-');
      const p0 = parts[0];
      const rest = parts.slice(1).join('-');
      if (p0 === 'DEL') {
        return { slug: fallbackSlug || '', code: raw, driverNum: rest };
      }
      return { slug: p0.toLowerCase(), code: raw, driverNum: rest };
    }

    if (/^\d+$/.test(raw)) {
      return { slug: fallbackSlug || '', code: `DEL-${raw}`, driverNum: raw };
    }

    return { slug: fallbackSlug || '', code: raw, driverName: raw };
  }

  /**
   * Busca un repartidor por código único o nombre en la lista configurada
   * @param {Array<string | { name: string, code?: string, active?: boolean }>} driversList
   * @param {string} codeOrName
   * @returns {{ name: string, code: string } | null}
   */
  function matchDriver(driversList, codeOrName) {
    if (!Array.isArray(driversList) || !codeOrName) return null;
    const search = String(codeOrName).trim().toUpperCase();
    if (!search) return null;

    const parsed = parseDriverCode(search);

    for (const item of driversList) {
      if (!item) continue;
      if (typeof item === 'string') {
        const itemUpper = item.trim().toUpperCase();
        if (itemUpper === search || (parsed.driverName && itemUpper === parsed.driverName) || itemUpper === parsed.code) {
          return { name: item.trim(), code: itemUpper };
        }
      } else if (typeof item === 'object') {
        const nameUpper = String(item.name || '').trim().toUpperCase();
        const codeUpper = String(item.code || '').trim().toUpperCase();
        if (
          (codeUpper && codeUpper === search) ||
          (codeUpper && codeUpper === parsed.code) ||
          (nameUpper && nameUpper === search) ||
          (nameUpper && parsed.driverName && nameUpper === parsed.driverName)
        ) {
          return { name: item.name.trim(), code: codeUpper || nameUpper };
        }
      }
    }
    return null;
  }

  PZ.carta = {
    THEMES, FONTS, TYPE_LABEL, PAY_LABEL, DAYS,
    money, defaults, themeVars, contrast, inkOn,
    isOpen, hoursText, localTime,
    priceLine, totals, validLines, extraApplies, halfMode, canPairHalf, halfPartners,
    waNumber, waLink, waMessage, shortDate,
    slugify, validSlug, cartaUrl, salonUrl,
    sortProducts, prepareSalonCategories,
    getTableColumns, renderSalonTable, renderSalonHtml,
    imageUrl, pic,
    haversineDistance, estimateDeliveryEta, repartoUrl,
    generateDriverCode, parseDriverCode, matchDriver,
  };
})((window.PZ = window.PZ || {}));
