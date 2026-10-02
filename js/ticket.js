// @ts-check
/* ==========================================================================
   PZ.ticket — comprobantes de pago, comandas de cocina y cierres de caja.
   Tres formas de imprimir:
     1) browser   → diálogo de impresión (impresora del sistema / PDF)
     2) bluetooth → directo a térmica ESC/POS vía Web Bluetooth (Chrome Android)
     3) rawbt     → envía ESC/POS a la app RawBT (Android)
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;

  PZ.labels = {
    type: { mostrador: 'Mostrador', delivery: 'Delivery', retiro: 'Para retirar', mesa: 'Mesa' },
    typeIcon: { mostrador: '🏪', delivery: '🛵', retiro: '🥡', mesa: '🍽️' },
    method: { efectivo: 'Efectivo', transferencia: 'Transferencia', qr: 'QR / Mercado Pago', tarjeta: 'Tarjeta' },
    methodIcon: { efectivo: '💵', transferencia: '🏦', qr: '📱', tarjeta: '💳' },
    status: {
      pendiente: 'Recibido', preparando: 'Preparando', horno: 'En el horno', listo: 'Listo',
      en_camino: 'En camino', entregado: 'Entregado', cancelado: 'Cancelado',
    },
  };

  /* ---------- Logo por defecto (pizza) ---------- */
  PZ.brandLogo = function (size = 64, mono = false) {
    const crust = mono ? '#000' : '#c8813a';
    const cheese = mono ? '#fff' : '#ffd166';
    const pep = mono ? '#000' : '#d62828';
    const basil = mono ? '#000' : '#2d6a4f';
    return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="${crust}"/>
      <circle cx="32" cy="32" r="25" fill="${cheese}" ${mono ? 'stroke="#000" stroke-width="2"' : ''}/>
      <g fill="${pep}"><circle cx="22" cy="22" r="5"/><circle cx="41" cy="20" r="4.5"/><circle cx="43" cy="39" r="5"/><circle cx="24" cy="42" r="4.5"/><circle cx="33" cy="31" r="3.5"/></g>
      <g fill="${basil}"><ellipse cx="31" cy="18" rx="3.2" ry="1.6" transform="rotate(-30 31 18)"/><ellipse cx="17" cy="33" rx="3.2" ry="1.6" transform="rotate(40 17 33)"/><ellipse cx="34" cy="46" rx="3.2" ry="1.6" transform="rotate(10 34 46)"/><ellipse cx="47" cy="29" rx="3.2" ry="1.6" transform="rotate(-60 47 29)"/></g>
    </svg>`;
  };

  const pad = (n, len = 8) => String(n).padStart(len, '0');
  /** Título del papel: lo elige cada sucursal (comprobante, recibo, ticket…) */
  const docTitle = (o) => (o.paid ? (PZ.store.data.settings.ticket.docTitle || 'Comprobante de pago') : o.tableBill ? 'Cuenta de la mesa' : 'Comprobante de pedido');
  /** "Pedido #12" o, para la cuenta completa de una mesa, "Mesa 3" */
  const orderRef = (o) => (o.tableBill ? String(o.number) : 'Pedido #' + o.number);
  /** Sello: la cuenta de mesa antes de cobrar no es un comprobante de pago */
  const stampOf = (o) => (o.voided ? 'ANULADO' : o.paid ? 'PAGADO' : o.tableBill ? 'PRE-CUENTA' : 'A COBRAR');
  /** Comanda: las tandas de mesa se cobran con la cuenta, no por separado */
  const kitchenFoot = (o) => (o.paid ? 'PAGADO' : o.tableSessionId ? 'VA A LA CUENTA DE LA MESA' : 'A COBRAR ' + U.money(o.total));
  const kitchenHead = (o) => (o.tableSessionId && o.table ? 'MESA ' + o.table : '#' + o.number);
  const ticketId = (o) => `${pad(PZ.store.data.settings.ticket.pos, 4)}-${pad(o.ticketNumber || 0)}`;

  /* ======================= Estilos del papel ======================= */
  const PAPER_CSS = `
    .paper{--w:80mm;width:var(--w);box-sizing:border-box;padding:4mm 3.5mm 6mm;background:#fff;color:#000;
      font-family:"Helvetica Neue",Arial,sans-serif;font-size:12px;line-height:1.3;}
    .paper.w58{--w:58mm;font-size:10.5px;padding:3mm 2mm 5mm;}
    .paper *{box-sizing:border-box}
    .paper .c{text-align:center}
    .paper .logo{display:flex;justify-content:center;margin-bottom:2mm}
    .paper .logo img{max-width:60%;max-height:28mm;filter:grayscale(1) contrast(1.4)}
    .paper .biz{font-size:1.55em;font-weight:900;letter-spacing:.02em;text-transform:uppercase;text-align:center;line-height:1.1}
    .paper .slogan{font-style:italic;text-align:center;margin-top:.5mm}
    .paper .small{font-size:.86em}
    .paper .muted{color:#222}
    .paper hr{border:0;border-top:1px dashed #000;margin:2.2mm 0}
    .paper hr.solid{border-top:2px solid #000}
    .paper .doc{display:flex;justify-content:space-between;align-items:baseline;font-weight:800;font-size:1.05em}
    .paper .row{display:flex;justify-content:space-between;gap:2mm}
    .paper .row span:last-child{white-space:nowrap;text-align:right}
    .paper .it{margin:1.2mm 0}
    .paper .it .row{font-weight:700}
    .paper .sub{padding-left:4mm;font-size:.9em}
    .paper .tot{font-size:1.5em;font-weight:900;margin-top:1mm}
    .paper .stamp{margin:3mm auto 1mm;border:2.5px solid #000;border-radius:2mm;padding:1mm 4mm;width:max-content;
      font-weight:900;font-size:1.35em;letter-spacing:.2em;transform:rotate(-4deg)}
    .paper .qr{display:flex;justify-content:center;margin:2mm 0 1mm}
    .paper .qr svg{width:26mm;height:26mm}
    .paper.w58 .qr svg{width:22mm;height:22mm}
    .paper .legend{margin-top:2mm;border:1px solid #000;padding:1mm;text-align:center;font-weight:700;font-size:.85em}
    .paper .big{font-size:2.1em;font-weight:900;text-align:center;line-height:1.05}
    .paper .kit-it{font-size:1.3em;font-weight:800;margin:1.6mm 0}
    .paper .kit-it .sub{font-size:.75em;font-weight:600}
    .paper .box{border:2px solid #000;padding:1.5mm;margin:1.5mm 0;font-weight:700}
    .paper .pay-info{border:1.5px solid #000;border-radius:1.5mm;padding:1.5mm;margin-top:1.5mm}
  `;

  /* ======================= Ticket del cliente ======================= */
  function customerHTML(o, { copy = '' } = {}) {
    const st = PZ.store.data.settings;
    const b = st.business;
    const t = st.ticket;
    const w58 = Number(t.width) === 58;
    const seller = PZ.store.user(o.userId);
    const L = PZ.labels;
    const logo = t.showLogo ? (t.logo ? `<div class="logo"><img src="${t.logo}" alt=""></div>` : `<div class="logo">${PZ.brandLogo(w58 ? 40 : 52, true)}</div>`) : '';

    const items = o.items.map((it) => `
      <div class="it">
        <div class="row"><span>${it.qty} x ${U.esc(it.name)}${it.variantName ? ' (' + U.esc(it.variantName) + ')' : ''}</span><span>${U.money(it.unitPrice * it.qty)}</span></div>
        ${it.qty > 1 ? `<div class="sub">${U.money(it.unitPrice)} c/u</div>` : ''}
        ${it.extras.map((e) => `<div class="sub">+ ${U.esc(e.name)}${e.price ? ' ' + U.money(e.price) : ''}</div>`).join('')}
        ${it.notes ? `<div class="sub">» ${U.esc(it.notes)}</div>` : ''}
      </div>`).join('');

    const pays = o.paid
      ? o.payments.map((p) => {
          let extra = '';
          if (p.method === 'efectivo' && p.tendered > p.amount) {
            extra = `<div class="row sub"><span>Abonó con</span><span>${U.money(p.tendered)}</span></div>
                     <div class="row" style="font-weight:800"><span>SU VUELTO</span><span>${U.money(p.tendered - p.amount)}</span></div>`;
          }
          if (p.ref) extra += `<div class="sub">Operación: ${U.esc(p.ref)}</div>`;
          return `<div class="row"><span>${L.method[p.method] || p.method}${p.cardType ? ' de ' + U.esc(p.cardType) : ''}</span><span>${U.money(p.amount)}</span></div>${extra}`;
        }).join('')
      : '';

    const unpaidInfo = !o.paid && (st.payments.alias || st.payments.cbu)
      ? `<div class="pay-info small"><b>Podés pagar por transferencia:</b><br>${st.payments.alias ? 'Alias: <b>' + U.esc(st.payments.alias) + '</b><br>' : ''}${st.payments.cbu ? 'CBU/CVU: ' + U.esc(st.payments.cbu) + '<br>' : ''}${st.payments.holder ? 'Titular: ' + U.esc(st.payments.holder) : ''}</div>`
      : '';

    let qrText = '';
    if (t.qrMode === 'instagram' && b.instagram) qrText = 'https://instagram.com/' + b.instagram.replace(/^@/, '');
    if (t.qrMode === 'custom' && t.qrText) qrText = t.qrText;

    return `
    <div class="paper ${w58 ? 'w58' : ''}">
      ${logo}
      <div class="biz">${U.esc(b.name)}</div>
      ${b.slogan ? `<div class="slogan small">${U.esc(b.slogan)}</div>` : ''}
      ${PZ.store.ctx.branches.length > 1 ? `<div class="c" style="font-weight:800;margin-top:.5mm">Sucursal ${U.esc(PZ.store.branchName())}</div>` : ''}
      <div class="c small" style="margin-top:1mm">
        ${U.esc(b.address)}${b.city ? ' · ' + U.esc(b.city) : ''}<br>
        ${b.phone ? 'Tel/WhatsApp: ' + U.esc(b.phone) : ''}
        ${b.cuit ? '<br>CUIT: ' + U.esc(b.cuit) + (b.taxCondition ? ' · ' + U.esc(b.taxCondition) : '') : ''}
      </div>
      <hr class="solid">
      <div class="doc"><span>${U.esc(docTitle(o).toUpperCase())}</span></div>
      <div class="row"><span>${o.paid ? 'Nº ' + ticketId(o) : o.tableBill ? 'Cuenta' : 'Pedido'}</span><span>${U.esc(orderRef(o))}</span></div>
      <div class="row small"><span>Fecha: ${U.date(o.paidAt || o.createdAt)}</span><span>Hora: ${U.time(o.paidAt || o.createdAt)}</span></div>
      <div class="row small"><span>${L.type[o.type] || o.type}${o.type === 'mesa' && o.table ? ' ' + U.esc(o.table) : ''}</span><span>Atendió: ${U.esc(seller ? seller.name : '-')}</span></div>
      ${o.customerName ? `<div class="small">Cliente: <b>${U.esc(o.customerName)}</b>${o.phone ? ' · ' + U.esc(o.phone) : ''}</div>` : ''}
      ${o.type === 'delivery' && o.address ? `<div class="small">Entrega: ${U.esc(o.address)}</div>` : ''}
      ${copy ? `<div class="c small" style="font-weight:800;margin-top:1mm">— ${U.esc(copy)} —</div>` : ''}
      <hr>
      ${items}
      <hr>
      <div class="row"><span>Subtotal</span><span>${U.money(o.subtotal)}</span></div>
      ${o.discountAmount ? `<div class="row"><span>Descuento${o.discount && o.discount.type === '%' ? ' ' + o.discount.value + '%' : ''}</span><span>-${U.money(o.discountAmount)}</span></div>` : ''}
      ${o.cashDiscount ? `<div class="row"><span>Desc. pago en efectivo</span><span>-${U.money(o.cashDiscount)}</span></div>` : ''}
      ${o.deliveryFee ? `<div class="row"><span>Envío</span><span>${U.money(o.deliveryFee)}</span></div>` : ''}
      ${o.surcharge ? `<div class="row"><span>Recargo tarjeta</span><span>${U.money(o.surcharge)}</span></div>` : ''}
      <div class="row tot"><span>TOTAL</span><span>${U.money(o.total)}</span></div>
      ${o.paid ? `<hr><div class="small" style="font-weight:800;margin-bottom:.5mm">FORMA DE PAGO</div>${pays}` : ''}
      <div class="c"><div class="stamp">${stampOf(o)}</div></div>
      ${o.tableBill && !o.paid ? '<div class="c small" style="font-weight:700">No válido como comprobante de pago</div>' : ''}
      ${unpaidInfo}
      ${o.notes ? `<div class="small" style="margin-top:1.5mm">Nota: ${U.esc(o.notes)}</div>` : ''}
      <hr>
      <div class="c" style="font-weight:700">${U.esc(t.footer)}</div>
      ${qrText ? `<div class="qr">${U.qrSvg(qrText, 3, 1)}</div><div class="c small">${t.qrMode === 'instagram' ? 'Seguinos ' + U.esc(b.instagram) : ''}</div>` : ''}
      ${t.legend ? `<div class="legend">${U.esc(t.legend)}</div>` : ''}
    </div>`;
  }

  /* ======================= Comanda de cocina ======================= */
  function kitchenHTML(o) {
    const t = PZ.store.data.settings.ticket;
    const L = PZ.labels;
    return `
    <div class="paper ${Number(t.width) === 58 ? 'w58' : ''}">
      <div class="c small" style="font-weight:800">COMANDA · COCINA</div>
      <div class="big">${U.esc(kitchenHead(o))}</div>
      ${o.tableSessionId ? `<div class="c" style="font-weight:800">TANDA ${o.batchNumber || 1} · #${o.number}</div>` : ''}
      ${o.tableSessionId ? '' : `<div class="c" style="font-weight:800;font-size:1.2em">${(L.type[o.type] || o.type).toUpperCase()}${o.type === 'mesa' && o.table ? ' ' + U.esc(o.table) : ''}</div>`}
      <div class="c small">${U.dateTime(o.createdAt)}${o.eta ? ' · Entrega: ' + U.esc(o.eta) : ''}</div>
      ${o.customerName ? `<div class="c">${U.esc(o.customerName)}</div>` : ''}
      <hr class="solid">
      ${o.items.map((it) => `
        <div class="kit-it">${it.qty} x ${U.esc(it.name)}${it.variantName ? ' <span class="sub">(' + U.esc(it.variantName) + ')</span>' : ''}
          ${it.extras.map((e) => `<div class="sub">+ ${U.esc(e.name)}</div>`).join('')}
          ${it.notes ? `<div class="box">» ${U.esc(it.notes)}</div>` : ''}
        </div>`).join('')}
      ${o.notes ? `<hr><div class="box">NOTA: ${U.esc(o.notes)}</div>` : ''}
      <hr class="solid">
      <div class="c small">${kitchenFoot(o)}</div>
    </div>`;
  }

  /* ======================= Cierre de caja (reporte Z) ======================= */
  function closeHTML(s) {
    const st = PZ.store.data.settings;
    const sum = PZ.store.sessionSummary(s);
    const L = PZ.labels;
    const op = PZ.store.user(s.openedBy);
    const cl = PZ.store.user(s.closedBy);
    const expected = s.closedAt ? s.expectedCash : sum.expectedCash;
    return `
    <div class="paper ${Number(st.ticket.width) === 58 ? 'w58' : ''}">
      <div class="biz">${U.esc(st.business.name)}</div>
      <div class="c">Sucursal ${U.esc(PZ.store.branchName())}</div>
      <div class="c" style="font-weight:800;margin-top:1mm">${s.closedAt ? 'CIERRE DE CAJA' : 'ARQUEO PARCIAL'}</div>
      <hr class="solid">
      <div class="row small"><span>Apertura</span><span>${U.dateTime(s.openedAt)}</span></div>
      <div class="row small"><span>Abrió</span><span>${U.esc(op ? op.name : '-')}</span></div>
      ${s.closedAt ? `<div class="row small"><span>Cierre</span><span>${U.dateTime(s.closedAt)}</span></div><div class="row small"><span>Cerró</span><span>${U.esc(cl ? cl.name : '-')}</span></div>` : ''}
      <hr>
      <div class="row"><span>Tickets emitidos</span><span>${sum.tickets}</span></div>
      <div class="row"><span>Ticket promedio</span><span>${U.money(sum.avg)}</span></div>
      <div class="row"><span>Descuentos</span><span>${U.money(sum.discounts)}</span></div>
      <div class="row"><span>Envíos cobrados</span><span>${U.money(sum.delivery)}</span></div>
      <div class="row"><span>Anulados</span><span>${sum.voided.length}</span></div>
      <hr>
      <div class="small" style="font-weight:800">VENTAS POR MEDIO DE PAGO</div>
      ${Object.keys(L.method).map((m) => `<div class="row"><span>${L.method[m]}</span><span>${U.money(sum.byMethod[m] || 0)}</span></div>`).join('')}
      <div class="row tot"><span>TOTAL</span><span>${U.money(sum.sales)}</span></div>
      <hr>
      <div class="small" style="font-weight:800">EFECTIVO EN CAJA</div>
      <div class="row"><span>Fondo inicial</span><span>${U.money(s.openingAmount)}</span></div>
      <div class="row"><span>+ Ventas efectivo</span><span>${U.money(sum.byMethod.efectivo)}</span></div>
      <div class="row"><span>+ Ingresos</span><span>${U.money(sum.ingresos)}</span></div>
      <div class="row"><span>- Egresos</span><span>${U.money(sum.egresos)}</span></div>
      ${sum.moves.map((m) => `<div class="sub">${m.type === 'egreso' ? '-' : '+'} ${U.money(m.amount)} ${U.esc(m.reason)}</div>`).join('')}
      <div class="row" style="font-weight:800"><span>Esperado</span><span>${U.money(expected)}</span></div>
      ${s.closedAt ? `<div class="row" style="font-weight:800"><span>Contado</span><span>${U.money(s.countedCash)}</span></div>
      <div class="row tot"><span>${s.diff === 0 ? 'SIN DIFERENCIA' : s.diff > 0 ? 'SOBRANTE' : 'FALTANTE'}</span><span>${U.money(Math.abs(s.diff))}</span></div>` : ''}
      ${s.closeNotes ? `<div class="small">Obs: ${U.esc(s.closeNotes)}</div>` : ''}
      <hr>
      <div class="c small">Impreso ${U.dateTime(Date.now())}</div>
      <br><br><div class="c small">_______________________<br>Firma responsable</div>
    </div>`;
  }

  /* ======================= Impresión por navegador ======================= */
  function printHTML(papers) {
    const w = Number(PZ.store.data.settings.ticket.width) === 58 ? 58 : 80;
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const doc = /** @type {Document} */ (frame.contentDocument);
    const win = /** @type {Window} */ (frame.contentWindow);
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket</title><style>
      @page{size:${w}mm auto;margin:0}
      html,body{margin:0;padding:0;background:#fff}
      .pg{page-break-after:always;break-after:page}
      .pg:last-child{page-break-after:auto;break-after:auto}
      ${PAPER_CSS}
    </style></head><body>${papers.map((p) => `<div class="pg">${p}</div>`).join('')}</body></html>`);
    doc.close();
    const go = () => {
      try {
        win.focus();
        win.print();
      } catch (e) {
        PZ.toast('No se pudo abrir la impresión', 'err');
      }
      setTimeout(() => frame.remove(), 60000);
    };
    const imgs = Array.from(doc.images);
    Promise.all(imgs.map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })))).then(() => setTimeout(go, 120));
  }

  /* ======================= ESC/POS ======================= */
  const CP850 = { 'á': 0xa0, 'é': 0x82, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, '¿': 0xa8, '¡': 0xad, '½': 0xab, 'Á': 0xb5, 'É': 0x90, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9, 'ü': 0x81, '°': 0xf8, 'º': 0xa7, '»': 0xaf };

  class EscPos {
    constructor(cols, accents) { this.b = []; this.cols = cols; this.accents = accents; this.raw(0x1b, 0x40); if (accents) this.raw(0x1b, 0x74, 2); }
    raw(...bytes) { this.b.push(...bytes); return this; }
    txt(s) {
      s = String(s ?? '').replace(/[  ]/g, ' ');
      if (!this.accents) s = U.stripAccents(s).replace(/½/g, '1/2').replace(/[¡¿]/g, '').replace(/»/g, '>').replace(/[—–]/g, '-');
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (code < 128) this.b.push(code);
        else if (this.accents && CP850[ch]) this.b.push(CP850[ch]);
        else this.b.push(0x3f);
      }
      return this;
    }
    ln(s = '') { return this.txt(s).raw(0x0a); }
    align(a) { return this.raw(0x1b, 0x61, { l: 0, c: 1, r: 2 }[a]); }
    bold(on) { return this.raw(0x1b, 0x45, on ? 1 : 0); }
    size(w, h) { return this.raw(0x1d, 0x21, ((w - 1) << 4) | (h - 1)); }
    sep(ch = '-') { return this.ln(ch.repeat(this.cols)); }
    pair(l, r, cols = this.cols) {
      l = this.accents ? l : U.stripAccents(l);
      r = String(r);
      const space = cols - r.length - 1;
      if (l.length > space) {
        this.ln(l);
        return this.ln(' '.repeat(Math.max(0, cols - r.length)) + r);
      }
      return this.ln(l + ' '.repeat(cols - l.length - r.length) + r);
    }
    wrap(s, indent = '') {
      const words = String(s).split(/\s+/);
      let line = indent;
      words.forEach((w) => {
        if ((line + w).length > this.cols) { this.ln(line.trimEnd()); line = indent; }
        line += w + ' ';
      });
      if (line.trim()) this.ln(line.trimEnd());
      return this;
    }
    feed(n = 3) { return this.raw(0x1b, 0x64, n); }
    cut() { return this.raw(0x1d, 0x56, 0x42, 0x00); }
    qr(text, size = 6) {
      const data = Array.from(new TextEncoder().encode(text));
      const len = data.length + 3;
      this.raw(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
      this.raw(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size);
      this.raw(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);
      this.raw(0x1d, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...data);
      return this.raw(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    }
    image(canvas) {
      const ctx = canvas.getContext('2d');
      const { width, height } = canvas;
      const px = ctx.getImageData(0, 0, width, height).data;
      const bw = Math.ceil(width / 8);
      this.raw(0x1d, 0x76, 0x30, 0x00, bw & 0xff, bw >> 8, height & 0xff, height >> 8);
      for (let y = 0; y < height; y++) {
        for (let xb = 0; xb < bw; xb++) {
          let byte = 0;
          for (let bit = 0; bit < 8; bit++) {
            const x = xb * 8 + bit;
            if (x >= width) continue;
            const i = (y * width + x) * 4;
            const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            if (px[i + 3] > 128 && lum < 150) byte |= 0x80 >> bit;
          }
          this.b.push(byte);
        }
      }
      return this;
    }
    bytes() { return new Uint8Array(this.b); }
  }

  async function logoCanvas(maxDots) {
    const t = PZ.store.data.settings.ticket;
    const src = t.logo || 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(PZ.brandLogo(128, true));
    try {
      const img = await U.loadImage(src);
      const w = Math.min(maxDots, t.logo ? Math.round(maxDots * 0.6) : 140);
      const h = Math.round((img.height / img.width) * w);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return c;
    } catch (e) { return null; }
  }

  async function escposCustomer(o) {
    const st = PZ.store.data.settings;
    const t = st.ticket, b = st.business, L = PZ.labels;
    const w58 = Number(t.width) === 58;
    const e = new EscPos(w58 ? 32 : 48, !!t.escposAccents);
    const seller = PZ.store.user(o.userId);
    e.align('c');
    if (t.showLogo) { const c = await logoCanvas(w58 ? 384 : 576); if (c) e.image(c).ln(); }
    e.bold(true).size(2, 2).ln(b.name.toUpperCase()).size(1, 1).bold(false);
    if (b.slogan) e.ln(b.slogan);
    if (PZ.store.ctx.branches.length > 1) e.bold(true).ln('Sucursal ' + PZ.store.branchName()).bold(false);
    e.ln(`${b.address}${b.city ? ' - ' + b.city : ''}`);
    if (b.phone) e.ln('Tel/WhatsApp: ' + b.phone);
    if (b.cuit) e.ln('CUIT: ' + b.cuit + (b.taxCondition ? ' - ' + b.taxCondition : ''));
    e.align('l').sep('=');
    e.bold(true).ln(docTitle(o).toUpperCase()).bold(false);
    e.pair(o.paid ? 'N ' + ticketId(o) : o.tableBill ? 'Cuenta' : 'Pedido', orderRef(o));
    e.pair('Fecha: ' + U.date(o.paidAt || o.createdAt), 'Hora: ' + U.time(o.paidAt || o.createdAt));
    e.pair((L.type[o.type] || o.type) + (o.type === 'mesa' && o.table ? ' ' + o.table : ''), 'Atendio: ' + (seller ? seller.name : '-'));
    if (o.customerName) e.ln('Cliente: ' + o.customerName + (o.phone ? ' - ' + o.phone : ''));
    if (o.type === 'delivery' && o.address) e.wrap('Entrega: ' + o.address);
    e.sep();
    o.items.forEach((it) => {
      e.bold(true).pair(`${it.qty} x ${it.name}${it.variantName ? ' (' + it.variantName + ')' : ''}`, U.money(it.unitPrice * it.qty)).bold(false);
      if (it.qty > 1) e.ln('   ' + U.money(it.unitPrice) + ' c/u');
      it.extras.forEach((x) => e.ln('   + ' + x.name + (x.price ? ' ' + U.money(x.price) : '')));
      if (it.notes) e.wrap('» ' + it.notes, '   ');
    });
    e.sep();
    e.pair('Subtotal', U.money(o.subtotal));
    if (o.discountAmount) e.pair('Descuento', '-' + U.money(o.discountAmount));
    if (o.cashDiscount) e.pair('Desc. pago efectivo', '-' + U.money(o.cashDiscount));
    if (o.deliveryFee) e.pair('Envio', U.money(o.deliveryFee));
    if (o.surcharge) e.pair('Recargo tarjeta', U.money(o.surcharge));
    e.bold(true).size(1, 2).pair('TOTAL', U.money(o.total)).size(1, 1).bold(false);
    if (o.paid) {
      e.sep().bold(true).ln('FORMA DE PAGO').bold(false);
      o.payments.forEach((p) => {
        e.pair((L.method[p.method] || p.method) + (p.cardType ? ' de ' + p.cardType : ''), U.money(p.amount));
        if (p.method === 'efectivo' && p.tendered > p.amount) {
          e.pair('  Abono con', U.money(p.tendered));
          e.bold(true).pair('  SU VUELTO', U.money(p.tendered - p.amount)).bold(false);
        }
        if (p.ref) e.ln('  Operacion: ' + p.ref);
      });
    }
    e.align('c').ln().bold(true).size(2, 2).ln(stampOf(o)).size(1, 1).bold(false);
    if (o.tableBill && !o.paid) e.ln('No valido como comprobante de pago');
    if (!o.paid && st.payments.alias) e.ln('Alias: ' + st.payments.alias);
    if (o.notes) e.align('l').wrap('Nota: ' + o.notes).align('c');
    e.sep().ln(t.footer);
    let qrText = '';
    if (t.qrMode === 'instagram' && b.instagram) qrText = 'https://instagram.com/' + b.instagram.replace(/^@/, '');
    if (t.qrMode === 'custom' && t.qrText) qrText = t.qrText;
    if (qrText) { e.qr(qrText, w58 ? 5 : 6).ln(); if (t.qrMode === 'instagram') e.ln('Seguinos ' + b.instagram); }
    if (t.legend) e.bold(true).ln(t.legend).bold(false);
    return e.feed(4).cut().bytes();
  }

  function escposKitchen(o) {
    const t = PZ.store.data.settings.ticket, L = PZ.labels;
    const e = new EscPos(Number(t.width) === 58 ? 32 : 48, !!t.escposAccents);
    e.align('c').bold(true).ln('COMANDA - COCINA').size(3, 3).ln(kitchenHead(o)).size(2, 1)
      .ln(o.tableSessionId ? `TANDA ${o.batchNumber || 1} - #${o.number}` : (L.type[o.type] || o.type).toUpperCase() + (o.type === 'mesa' && o.table ? ' ' + o.table : '')).size(1, 1).bold(false)
      .ln(U.dateTime(o.createdAt) + (o.eta ? ' - Entrega: ' + o.eta : ''));
    if (o.customerName) e.ln(o.customerName);
    e.align('l').sep('=');
    o.items.forEach((it) => {
      e.bold(true).size(1, 2).ln(`${it.qty} x ${it.name}${it.variantName ? ' (' + it.variantName + ')' : ''}`).size(1, 1).bold(false);
      it.extras.forEach((x) => e.ln('   + ' + x.name));
      if (it.notes) e.bold(true).wrap('>> ' + it.notes, '   ').bold(false);
    });
    if (o.notes) e.sep().bold(true).wrap('NOTA: ' + o.notes).bold(false);
    e.sep('=').align('c').ln(kitchenFoot(o));
    return e.feed(4).cut().bytes();
  }

  function escposClose(s) {
    const st = PZ.store.data.settings, L = PZ.labels;
    const sum = PZ.store.sessionSummary(s);
    const e = new EscPos(Number(st.ticket.width) === 58 ? 32 : 48, !!st.ticket.escposAccents);
    e.align('c').bold(true).size(2, 2).ln(st.business.name.toUpperCase()).size(1, 1).ln(s.closedAt ? 'CIERRE DE CAJA' : 'ARQUEO PARCIAL').bold(false).align('l').sep('=');
    e.pair('Apertura', U.dateTime(s.openedAt));
    if (s.closedAt) e.pair('Cierre', U.dateTime(s.closedAt));
    e.sep().pair('Tickets', String(sum.tickets)).pair('Promedio', U.money(sum.avg)).pair('Descuentos', U.money(sum.discounts)).pair('Anulados', String(sum.voided.length));
    e.sep().bold(true).ln('POR MEDIO DE PAGO').bold(false);
    Object.keys(L.method).forEach((m) => e.pair(L.method[m], U.money(sum.byMethod[m] || 0)));
    e.bold(true).size(1, 2).pair('TOTAL', U.money(sum.sales)).size(1, 1).bold(false);
    e.sep().bold(true).ln('EFECTIVO').bold(false)
      .pair('Fondo inicial', U.money(s.openingAmount)).pair('+ Ventas', U.money(sum.byMethod.efectivo))
      .pair('+ Ingresos', U.money(sum.ingresos)).pair('- Egresos', U.money(sum.egresos))
      .bold(true).pair('Esperado', U.money(s.closedAt ? s.expectedCash : sum.expectedCash)).bold(false);
    if (s.closedAt) e.pair('Contado', U.money(s.countedCash)).bold(true).pair(s.diff === 0 ? 'Sin diferencia' : s.diff > 0 ? 'Sobrante' : 'Faltante', U.money(Math.abs(s.diff))).bold(false);
    e.feed(2).align('c').ln('______________________').ln('Firma responsable');
    return e.feed(4).cut().bytes();
  }

  /* ======================= Bluetooth ======================= */
  const BT_SERVICES = [
    '000018f0-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '0000fee7-0000-1000-8000-00805f9b34fb',
  ];
  // Web Bluetooth todavía no está en los tipos estándar del navegador
  /** @type {{ device: any, ch: any }} */
  const bt = { device: null, ch: null };
  const bluetooth = () => /** @type {any} */ (navigator).bluetooth;

  async function btConnect(forceNew = false) {
    if (!bluetooth()) throw new Error('Este navegador no soporta Bluetooth. Usá Chrome en Android o elegí "RawBT" en Configuración.');
    if (!bt.device || forceNew) {
      bt.device = await bluetooth().requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
      bt.ch = null;
    }
    if (!bt.device.gatt.connected || !bt.ch) {
      const server = await bt.device.gatt.connect();
      const services = await server.getPrimaryServices();
      for (const s of services) {
        const chars = await s.getCharacteristics();
        const w = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write);
        if (w) { bt.ch = w; break; }
      }
      if (!bt.ch) throw new Error('La impresora no expone un canal de escritura compatible');
    }
    return bt.ch;
  }

  async function btPrint(bytes) {
    const ch = await btConnect();
    const size = 180;
    for (let i = 0; i < bytes.length; i += size) {
      const chunk = bytes.slice(i, i + size);
      if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(chunk);
      else await ch.writeValue(chunk);
      await new Promise((r) => setTimeout(r, 12));
    }
  }

  function rawbtPrint(bytes) {
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    window.location.href = 'rawbt:base64,' + btoa(bin);
  }

  async function sendRaw(bytesList) {
    const mode = PZ.store.data.settings.ticket.printMode;
    if (mode === 'bluetooth') {
      for (const b of bytesList) await btPrint(b);
    } else if (mode === 'rawbt') {
      const total = bytesList.reduce((a, b) => a + b.length, 0);
      const all = new Uint8Array(total);
      let off = 0;
      bytesList.forEach((b) => { all.set(b, off); off += b.length; });
      rawbtPrint(all);
    }
  }

  /* ======================= Texto plano (WhatsApp) ======================= */
  function plainText(o) {
    const st = PZ.store.data.settings, L = PZ.labels;
    const lines = [];
    lines.push(`*${st.business.name}*`);
    lines.push(o.paid ? `${docTitle(o)} Nº ${ticketId(o)}${o.tableBill ? ' · ' + o.number : ''}` : o.tableBill ? `Cuenta · ${o.number}` : `Pedido #${o.number}`);
    lines.push(U.dateTime(o.paidAt || o.createdAt));
    lines.push('');
    o.items.forEach((it) => {
      lines.push(`${it.qty} x ${it.name}${it.variantName ? ' (' + it.variantName + ')' : ''} — ${U.money(it.unitPrice * it.qty)}`);
      it.extras.forEach((x) => lines.push(`   + ${x.name}`));
      if (it.notes) lines.push(`   » ${it.notes}`);
    });
    lines.push('');
    if (o.discountAmount) lines.push(`Descuento: -${U.money(o.discountAmount)}`);
    if (o.cashDiscount) lines.push(`Desc. efectivo: -${U.money(o.cashDiscount)}`);
    if (o.deliveryFee) lines.push(`Envío: ${U.money(o.deliveryFee)}`);
    if (o.surcharge) lines.push(`Recargo tarjeta: ${U.money(o.surcharge)}`);
    lines.push(`*TOTAL: ${U.money(o.total)}*`);
    if (o.paid) {
      o.payments.forEach((p) => lines.push(`Pagado con ${L.method[p.method]}: ${U.money(p.amount)}${p.tendered > p.amount ? ` (vuelto ${U.money(p.tendered - p.amount)})` : ''}`));
      lines.push('✅ PAGADO');
    } else if (st.payments.alias) {
      lines.push(`Podés transferir al alias *${st.payments.alias}*${st.payments.holder ? ' (' + st.payments.holder + ')' : ''}`);
    }
    lines.push('');
    lines.push(st.ticket.footer + ' 🍕');
    if (st.ticket.legend) lines.push(`_${st.ticket.legend}_`);
    return lines.join('\n');
  }

  /* ======================= API pública ======================= */
  const T = (PZ.ticket = {
    PAPER_CSS,
    customerHTML,
    kitchenHTML,
    closeHTML,
    plainText,
    ticketId,
    escpos: { customer: escposCustomer, kitchen: escposKitchen, close: escposClose },

    async printOrder(o, { kitchen = false, customer = true } = {}) {
      const t = PZ.store.data.settings.ticket;
      const copies = Math.max(1, Number(t.copies) || 1);
      try {
        if (t.printMode === 'browser') {
          const papers = [];
          if (customer) for (let i = 0; i < copies; i++) papers.push(customerHTML(o, { copy: copies > 1 ? (i === 0 ? 'Original' : 'Copia') : '' }));
          if (kitchen) papers.push(kitchenHTML(o));
          printHTML(papers);
        } else {
          const list = [];
          if (customer) { const b = await escposCustomer(o); for (let i = 0; i < copies; i++) list.push(b); }
          if (kitchen) list.push(escposKitchen(o));
          await sendRaw(list);
          PZ.toast('Ticket enviado a la impresora');
        }
      } catch (e) {
        console.error(e);
        if (e && e.name === 'NotFoundError') return; // canceló la selección
        PZ.toast(e.message || 'Error al imprimir', 'err', 5000);
      }
    },

    async printClose(s) {
      const t = PZ.store.data.settings.ticket;
      try {
        if (t.printMode === 'browser') printHTML([closeHTML(s)]);
        else await sendRaw([escposClose(s)]);
      } catch (e) {
        if (e && e.name === 'NotFoundError') return;
        PZ.toast(e.message || 'Error al imprimir', 'err', 5000);
      }
    },

    async testPrint() {
      /** @type {any} */
      const fake = {
        number: 999, ticketNumber: 0, createdAt: Date.now(), paidAt: Date.now(), userId: PZ.auth.current && PZ.auth.current.id, type: 'mostrador',
        items: [PZ.store.makeItem({ product: PZ.store.data.products[0], variant: PZ.store.data.products[0].variants[0], qty: 1 })],
        subtotal: 0, discountAmount: 0, deliveryFee: 0, total: 0, payments: [], paid: true, customerName: 'PRUEBA DE IMPRESIÓN', notes: '',
      };
      fake.subtotal = fake.total = fake.items[0].total;
      fake.payments = [{ method: 'efectivo', amount: fake.total, tendered: fake.total + 1500 }];
      await T.printOrder(fake);
    },

    async connectBluetooth() {
      try {
        await btConnect(true);
        PZ.toast('Impresora conectada: ' + (bt.device.name || 'Bluetooth'));
        return bt.device.name || 'Impresora';
      } catch (e) {
        if (e && e.name === 'NotFoundError') return null;
        PZ.toast(e.message || 'No se pudo conectar', 'err', 5000);
        return null;
      }
    },

    shareWhatsApp(o) {
      const phone = U.phoneForWa(o.phone);
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(plainText(o))}`;
      window.open(url, '_blank', 'noopener');
    },

    async share(o) {
      const text = plainText(o);
      if (navigator.share) {
        try { await navigator.share({ title: 'Comprobante', text }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      try { await navigator.clipboard.writeText(text); PZ.toast('Comprobante copiado al portapapeles'); } catch (e) { PZ.toast('No se pudo compartir', 'err'); }
    },

    /** Vista previa con acciones @param {any} o @param {{ title?: string }} [opts] */
    preview(o, { title } = {}) {
      const m = PZ.modal({
        title: title || (o.paid ? `Comprobante Nº ${ticketId(o)}` : o.tableBill ? `Cuenta · ${U.esc(o.number)}` : `Pedido #${o.number}`),
        size: 'ticket',
        body: `<div class="ticket-stage"><div class="ticket-roll">${customerHTML(o)}</div></div>`,
        footer: `
          ${o.tableBill ? '' : '<button class="btn ghost" data-a="kit">👨‍🍳 Comanda</button>'}
          <button class="btn ghost" data-a="wa">💬 WhatsApp</button>
          <button class="btn ghost" data-a="share">↗ Compartir</button>
          <button class="btn primary" data-a="print">🖨️ Imprimir</button>`,
      });
      m.el.querySelector('[data-a=print]').onclick = () => T.printOrder(o);
      const kit = m.el.querySelector('[data-a=kit]');
      if (kit) kit.onclick = () => T.printOrder(o, { kitchen: true, customer: false });
      m.el.querySelector('[data-a=wa]').onclick = () => T.shareWhatsApp(o);
      m.el.querySelector('[data-a=share]').onclick = () => T.share(o);
      return m;
    },
  });

  // Estilos del papel disponibles en la app para las vistas previas
  const style = document.createElement('style');
  style.textContent = PAPER_CSS;
  document.head.appendChild(style);
})(window.PZ);
