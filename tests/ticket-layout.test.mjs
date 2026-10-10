// Editor de comprobantes: qué sale en cada tipo de comprobante lo decide la sucursal.
//  · con el diseño por defecto, la salida es IDÉNTICA a la de antes del editor (tests/fixtures/ticket-golden.json,
//    generado con el código anterior) en los cinco formatos
//  · apagar un bloque lo saca de la pantalla, de la térmica y de WhatsApp a la vez
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { orders, VARIANTS, ticketApp, renderAll, escText } from './helpers/ticket-scenarios.mjs';

const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/ticket-golden.json', import.meta.url), 'utf8'));
const hash = (s) => (s == null ? null : crypto.createHash('sha256').update(s).digest('hex').slice(0, 16));

/** El comparativo: texto de WhatsApp completo; el resto, por huella */
async function same(variant, mutate) {
  const app = ticketApp(variant);
  if (mutate) mutate(app);
  for (const [name, o] of Object.entries(orders())) {
    const out = await renderAll(app, o);
    for (const [fmt, value] of Object.entries(out)) {
      const want = golden[variant][name][fmt];
      const got = fmt === 'plain' ? value : hash(value);
      assert.equal(got, want, `${variant} / ${name} / ${fmt}: la salida cambió respecto de la de siempre`);
    }
  }
}

test('con el diseño por defecto la salida es idéntica a la de siempre (pantalla, térmica, WhatsApp y comanda)', async () => {
  for (const variant of Object.keys(VARIANTS)) await same(variant);
});

test('una sucursal con configuración vieja (sin "layout") sigue saliendo igual', async () => {
  for (const variant of Object.keys(VARIANTS)) await same(variant, (app) => { delete app.S.data.settings.ticket.layout; });
});

test('el diseño por defecto trae los cuatro comprobantes, todo encendido y sin textos propios', () => {
  const { PZ } = ticketApp('completa');
  const layout = PZ.seed.ticketLayout();
  assert.deepEqual(Object.keys(layout), ['pago', 'cobrar', 'cuenta', 'comanda']);
  for (const kind of Object.keys(layout)) {
    const vals = Object.entries(layout[kind]).filter(([k]) => k !== 'title' && k !== 'footer');
    assert.ok(vals.length >= 4);
    assert.ok(vals.every(([, v]) => v === true), `${kind}: todos los bloques encendidos`);
    assert.equal(layout[kind].title, '');
  }
  assert.ok(!('footer' in layout.comanda), 'la comanda no tiene mensaje al pie');
  assert.ok('formaPago' in layout.pago && !('formaPago' in layout.cobrar));
  assert.ok('cobroEfectivo' in layout.cobrar && !('cobroEfectivo' in layout.pago));
  assert.ok('transferencia' in layout.cobrar && 'transferencia' in layout.cuenta && !('transferencia' in layout.pago));
});

test('el tipo de comprobante sale del pedido: pagado, a cobrar o pre-cuenta', () => {
  const { PZ } = ticketApp('completa');
  const o = orders();
  assert.equal(PZ.ticket.kindOf(o.pago_delivery), 'pago');
  assert.equal(PZ.ticket.kindOf(o.cuenta_pagada), 'pago', 'la cuenta de mesa ya cobrada es un comprobante de pago');
  assert.equal(PZ.ticket.kindOf(o.cobrar_efectivo), 'cobrar');
  assert.equal(PZ.ticket.kindOf(o.cobrar_transferencia), 'cobrar');
  assert.equal(PZ.ticket.kindOf(o.cuenta), 'cuenta');
});

/* ---- Apagar un bloque lo saca de los tres formatos del cliente (y de la comanda en sus dos) ---- */
// block → qué frase lo delata en cada formato (null = ese formato no lo muestra)
const CASES = [
  { block: 'logo', kind: 'pago', order: 'pago_delivery', html: 'class="logo"' },
  { block: 'negocio', kind: 'pago', order: 'pago_delivery', html: 'class="biz"', esc: 'LA PIEDRA PIZZERIA', plain: '*La Piedra Pizzería*' },
  { block: 'direccion', kind: 'pago', order: 'pago_delivery', html: 'Belgrano 456', esc: 'Belgrano 456' },
  { block: 'cuit', kind: 'pago', order: 'pago_delivery', html: 'CUIT:', esc: 'CUIT:' },
  { block: 'numero', kind: 'pago', order: 'pago_delivery', html: 'Fecha:', esc: 'Fecha:', plain: 'Comprobante de pago Nº' },
  { block: 'tipo', kind: 'pago', order: 'pago_delivery', html: 'Atendió:', esc: 'Atendio:' },
  { block: 'cliente', kind: 'pago', order: 'pago_delivery', html: 'Cliente:', esc: 'Cliente:' },
  { block: 'entrega', kind: 'pago', order: 'pago_delivery', html: 'Entrega: San', esc: 'Entrega: San' },
  { block: 'precioUnit', kind: 'pago', order: 'pago_delivery', html: 'c/u', esc: 'c/u' },
  { block: 'descuentos', kind: 'pago', order: 'pago_delivery', html: 'Descuento', esc: 'Descuento', plain: 'Descuento:' },
  { block: 'nota', kind: 'pago', order: 'pago_delivery', html: 'Nota:', esc: 'Nota:' },
  { block: 'formaPago', kind: 'pago', order: 'pago_delivery', html: 'FORMA DE PAGO', esc: 'FORMA DE PAGO', plain: 'Pagado con' },
  { block: 'cobroEfectivo', kind: 'cobrar', order: 'cobrar_efectivo', html: 'COBRAR EN EFECTIVO', esc: 'COBRAR EN EFECTIVO', plain: 'Se paga en efectivo' },
  { block: 'transferencia', kind: 'cobrar', order: 'cobrar_transferencia', html: 'pagar por transferencia', esc: 'Alias: lapiedra.pizza', plain: 'transferir al alias' },
  { block: 'transferencia', kind: 'cuenta', order: 'cuenta', html: 'pagar por transferencia', esc: 'Alias: lapiedra.pizza', plain: 'transferir al alias' },
  { block: 'pie', kind: 'pago', order: 'pago_delivery', html: 'Gracias por tu compra', esc: 'Gracias por tu compra', plain: 'Gracias por tu compra' },
  { block: 'qr', kind: 'pago', order: 'pago_delivery', html: 'class="qr"', esc: 'Seguinos @lapiedra' },
  { block: 'leyenda', kind: 'pago', order: 'pago_delivery', html: 'class="legend"', esc: 'Comprobante no valido', plain: 'Comprobante no válido' },
];

for (const c of CASES) {
  test(`apagar «${c.block}» en «${c.kind}» lo saca de la pantalla, de la térmica y de WhatsApp`, async () => {
    const o = orders()[c.order];
    const before = await renderAll(ticketApp('completa'), o);
    const app = ticketApp('completa');
    // (la térmica con logo necesita un navegador: el bloque del logo se mira solo en pantalla)
    app.S.data.settings.ticket.showLogo = c.block === 'logo';
    const ref = await renderAll(app, o);
    assert.ok(c.html && ref.customerHTML.includes(c.html), `por defecto la pantalla muestra ${c.html}`);
    if (c.esc) assert.ok(escText(ref.escCustomer).includes(c.esc), `por defecto la térmica muestra ${c.esc}`);
    if (c.plain) assert.ok(ref.plain.includes(c.plain), `por defecto WhatsApp muestra ${c.plain}`);

    app.S.data.settings.ticket.layout[c.kind][c.block] = false;
    const off = await renderAll(app, o);
    assert.ok(!off.customerHTML.includes(c.html), `la pantalla ya no muestra ${c.html}`);
    if (c.esc) assert.ok(!escText(off.escCustomer).includes(c.esc), `la térmica ya no muestra ${c.esc}`);
    if (c.plain) assert.ok(!off.plain.includes(c.plain), `WhatsApp ya no muestra ${c.plain}`);
    // lo demás sigue: el total, el sello y los productos
    assert.ok(off.customerHTML.includes('TOTAL') && off.customerHTML.includes('class="stamp"'));
    assert.ok(off.plain.includes('*TOTAL:'));
    assert.ok(before.customerHTML.length > 0);
  });
}

test('apagar un bloque de un tipo no cambia los otros tipos', async () => {
  const app = ticketApp('completa');
  app.S.data.settings.ticket.layout.pago.cuit = false;
  const o = orders();
  const pago = await renderAll(app, o.pago_delivery);
  const cobrar = await renderAll(app, o.cobrar_efectivo);
  assert.ok(!pago.customerHTML.includes('CUIT:'));
  assert.ok(cobrar.customerHTML.includes('CUIT:'), 'el comprobante A cobrar sigue con CUIT');
});

test('sucursal: se puede ocultar aunque el negocio tenga varias', async () => {
  const app = ticketApp('angosta');
  const o = orders().pago_delivery;
  assert.ok((await renderAll(app, o)).customerHTML.includes('Sucursal Centro'));
  app.S.data.settings.ticket.layout.pago.sucursal = false;
  const off = await renderAll(app, o);
  assert.ok(!off.customerHTML.includes('Sucursal Centro'));
  assert.ok(!escText(off.escCustomer).includes('Sucursal Centro'));
});

/* ---- Comanda ---- */
const KITCHEN = [
  { block: 'hora', order: 'pago_delivery', html: 'Entrega: 21:30', esc: 'Entrega: 21:30' },
  { block: 'cliente', order: 'pago_delivery', html: 'María Gómez', esc: 'Maria Gomez' },
  { block: 'notas', order: 'pago_delivery', html: 'NOTA: Timbre', esc: 'NOTA: Timbre' },
  { block: 'cobro', order: 'cobrar_efectivo', html: 'A COBRAR', esc: 'A COBRAR' },
];
for (const c of KITCHEN) {
  test(`comanda: apagar «${c.block}» lo saca de la pantalla y de la térmica`, async () => {
    const app = ticketApp('completa');
    const o = orders()[c.order];
    const ref = await renderAll(app, o);
    assert.ok(ref.kitchenHTML.includes(c.html), `por defecto la comanda muestra ${c.html}`);
    assert.ok(escText(ref.escKitchen).includes(c.esc), `por defecto la térmica muestra ${c.esc}`);
    app.S.data.settings.ticket.layout.comanda[c.block] = false;
    const off = await renderAll(app, o);
    assert.ok(!off.kitchenHTML.includes(c.html));
    assert.ok(!escText(off.escKitchen).includes(c.esc));
    // los productos de la comanda nunca se apagan
    assert.ok(off.kitchenHTML.includes('Muzzarella') && escText(off.escKitchen).includes('Muzzarella'));
  });
}

/* ---- Títulos y mensajes propios ---- */
test('título y mensaje al pie propios de cada comprobante, en los tres formatos', async () => {
  const app = ticketApp('completa');
  app.S.data.settings.ticket.showLogo = false; // (la térmica con logo necesita un navegador)
  const L = app.S.data.settings.ticket.layout;
  L.pago.title = 'RECIBO OFICIAL';
  L.pago.footer = 'Hasta la próxima';
  L.cobrar.title = 'PEDIDO PARA ENTREGAR';
  const o = orders();
  const pago = await renderAll(app, o.pago_delivery);
  assert.ok(pago.customerHTML.includes('RECIBO OFICIAL') && pago.customerHTML.includes('Hasta la próxima'));
  assert.ok(escText(pago.escCustomer).includes('RECIBO OFICIAL') && escText(pago.escCustomer).includes('Hasta la proxima'));
  assert.ok(pago.plain.includes('RECIBO OFICIAL Nº') && pago.plain.includes('Hasta la próxima'));
  assert.ok(!pago.customerHTML.includes('Gracias por tu compra'), 'el mensaje general se reemplaza');

  const cobrar = await renderAll(app, o.cobrar_efectivo);
  assert.ok(cobrar.customerHTML.includes('PEDIDO PARA ENTREGAR'));
  assert.ok(cobrar.customerHTML.includes('Gracias por tu compra'), 'sin mensaje propio, usa el general');
  assert.ok(!cobrar.customerHTML.includes('RECIBO OFICIAL'), 'el título de un tipo no pasa a otro');

  L.comanda.title = 'PARA EL HORNO';
  const k = await renderAll(app, o.pago_delivery);
  assert.ok(k.kitchenHTML.includes('PARA EL HORNO') && escText(k.escKitchen).includes('PARA EL HORNO'));
  assert.ok(!k.kitchenHTML.includes('COMANDA · COCINA'));
});

test('el texto propio se escapa en pantalla', async () => {
  const app = ticketApp('completa');
  app.S.data.settings.ticket.layout.pago.title = '<b>x</b>';
  const html = (await renderAll(app, orders().pago_delivery)).customerHTML;
  assert.ok(html.includes('&lt;B&gt;X&lt;/B&gt;') || html.includes('&lt;b&gt;x&lt;/b&gt;'.toUpperCase()));
  assert.ok(!html.includes('<b>x</b>'));
});

test('con todos los bloques apagados el comprobante igual muestra título, productos, total y sello', async () => {
  const app = ticketApp('completa');
  app.S.data.settings.ticket.showLogo = false;
  const L = app.S.data.settings.ticket.layout;
  for (const kind of Object.keys(L)) for (const k of Object.keys(L[kind])) if (typeof L[kind][k] === 'boolean') L[kind][k] = false;
  const o = orders();
  for (const name of ['pago_delivery', 'cobrar_efectivo', 'cuenta']) {
    const out = await renderAll(app, o[name]);
    assert.ok(out.customerHTML.includes('class="doc"') && out.customerHTML.includes('Muzzarella') && out.customerHTML.includes('TOTAL') && out.customerHTML.includes('class="stamp"'), name);
    assert.ok(!out.customerHTML.includes('class="biz"') && !out.customerHTML.includes('CUIT') && !out.customerHTML.includes('class="legend"'), name);
    assert.ok(escText(out.escCustomer).includes('TOTAL'));
    assert.ok(out.plain.includes('*TOTAL:'));
    assert.ok(!out.customerHTML.includes('<hr>\n      <div class="c" style="font-weight:700">'), 'sin pie no queda el separador del pie');
  }
});
