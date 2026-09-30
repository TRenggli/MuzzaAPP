import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, withMenu } from './helpers/load.mjs';

const { PZ, S, plain } = loadApp();
const C = PZ.carta;

/** Carta como la devuelve la base, armada con el menú de prueba */
function menu({ halfPricing = 'max' } = {}) {
  const d = withMenu(S);
  d.categories.push({ id: 'c-beb', name: 'Bebidas', icon: '🥤', allowHalf: false });
  d.products.push({ id: 'p-coca', categoryId: 'c-beb', name: 'Coca 1.5L', active: true, variants: [{ id: 'u', name: 'Unidad', price: 4000 }] });
  return {
    branch: { id: 'br-1', name: 'Centro', slug: 'test', org: 'Test' },
    settings: { business: { name: 'Pizzería Test' }, online: C.defaults(), halfPricing, zones: [{ id: 'z1', name: 'Zona 1', fee: 1500 }], transfer: null, logo: null },
    open: true,
    categories: d.categories,
    products: d.products,
    extras: d.extras,
  };
}

test('carta: el precio de una línea es igual al del mostrador (tamaño, mitad y agregados)', () => {
  const m = menu();
  const line = { productId: 'p-muz', variantId: 'chica', halfId: 'p-esp', extras: ['e1'], qty: 2 };
  const pl = C.priceLine(m, line);
  // mostrador: store.makeItem con los mismos datos
  const pos = S.makeItem({
    product: S.product('p-muz'), variant: S.product('p-muz').variants[1],
    half: { product: S.product('p-esp'), variant: S.product('p-esp').variants[1] }, extras: S.data.extras, qty: 2,
  });
  assert.equal(pl.unit, pos.unitPrice);
  assert.equal(pl.unit, 9000 + 1000, 'mitad más cara (9000) + huevo');
  assert.equal(pl.name, '½ Muzzarella + ½ Especial');
  assert.equal(pl.variantName, 'Chica');
});

test('carta: mitad y mitad al promedio', () => {
  const m = menu({ halfPricing: 'avg' });
  const pl = C.priceLine(m, { productId: 'p-muz', variantId: 'grande', halfId: 'p-esp', extras: [] });
  assert.equal(pl.unit, 12000);
});

test('carta: bebidas no llevan mitades ni agregados aunque el teléfono los mande', () => {
  const m = menu();
  const pl = C.priceLine(m, { productId: 'p-coca', variantId: 'u', halfId: 'p-muz', extras: ['e1'] });
  assert.equal(pl.unit, 4000);
  assert.equal(pl.half, null);
  assert.deepEqual(plain(pl.extras), []);
});

test('carta: totales con envío solo en delivery', () => {
  const m = menu();
  const lines = [
    { key: 'a', productId: 'p-muz', variantId: 'grande', halfId: '', extras: [], qty: 2, notes: '' },
    { key: 'b', productId: 'p-coca', variantId: 'u', halfId: '', extras: [], qty: 1, notes: '' },
  ];
  assert.deepEqual(plain(C.totals(m, lines, { type: 'retiro', zoneId: 'z1' })), { subtotal: 24000, deliveryFee: 0, total: 24000, count: 3 });
  assert.deepEqual(plain(C.totals(m, lines, { type: 'delivery', zoneId: 'z1' })), { subtotal: 24000, deliveryFee: 1500, total: 25500, count: 3 });
  // un producto que ya no existe se descarta del carrito guardado
  assert.equal(C.validLines(m, lines.concat({ key: 'x', productId: 'borrado', variantId: 'u', halfId: '', extras: [], qty: 1, notes: '' })).length, 2);
});

test('carta: horario de atención en hora argentina (incluye cruce de medianoche)', () => {
  // 26/09/2026 es sábado. 23:30 UTC = 20:30 en Argentina
  const sab2030 = new Date('2026-09-26T23:30:00Z');
  const dom0030 = new Date('2026-09-27T03:30:00Z'); // domingo 00:30 en Argentina
  const sab1500 = new Date('2026-09-26T18:00:00Z');
  const h = (days, from, to) => ({ paused: false, hours: { mode: 'schedule', days, from, to } });
  assert.equal(C.isOpen(h([6], '19:00', '23:30'), sab2030), true);
  assert.equal(C.isOpen(h([6], '19:00', '23:30'), sab1500), false);
  assert.equal(C.isOpen(h([0, 1, 2, 3, 4, 5], '19:00', '23:30'), sab2030), false, 'sábado no está en los días');
  assert.equal(C.isOpen(h([6], '19:00', '01:00'), dom0030), true, 'el turno del sábado sigue pasada la medianoche');
  assert.equal(C.isOpen(h([0], '19:00', '01:00'), dom0030), false, 'domingo 00:30 corresponde al turno del sábado');
  assert.equal(C.isOpen({ paused: true, hours: { mode: 'always' } }, sab2030), false, 'pausado');
  assert.equal(C.isOpen({ hours: { mode: 'always' } }, sab1500), true);
  assert.equal(C.hoursText({ mode: 'schedule', days: [2, 3, 4, 5, 6, 0], from: '19:00', to: '23:30' }), 'Mar a Dom · 19:00 a 23:30');
  assert.equal(C.hoursText({ mode: 'schedule', days: [1, 3, 5], from: '12:00', to: '15:00' }), 'Lun, Mié y Vie · 12:00 a 15:00');
});

test('carta: número de WhatsApp en formato internacional', () => {
  assert.equal(C.waNumber('11 5555-1234'), '5491155551234');
  assert.equal(C.waNumber('011 15 5555-1234'), '5491155551234', 'saca el 0 y el 15');
  assert.equal(C.waNumber('+54 9 11 5555-1234'), '5491155551234');
  assert.equal(C.waNumber('362 15 4123456'), '5493624123456', 'característica de 3 dígitos con 15');
  assert.equal(C.waNumber('3624 123456'), '5493624123456');
  assert.equal(C.waNumber('1234'), '', 'incompleto');
});

test('carta: el mensaje de WhatsApp lleva todos los datos del pedido', () => {
  const o = {
    id: 'x', number: 15, createdAt: '2026-09-26T16:15:00Z', type: 'delivery', name: 'Tomás Renggli', phone: '1164797444',
    address: 'Mitre 1234 2B', zoneId: 'z1', zoneName: 'Zona 1', table: '', payment: 'efectivo', cashWith: 30000, notes: 'Timbre no anda',
    items: [
      { id: 'a', productId: 'p-muz', variantId: 'grande', variantName: 'Grande', half: null, name: 'Muzzarella', extras: [{ id: 'e1', name: 'Huevo', price: 1000 }], qty: 2, unitPrice: 11000, total: 22000, notes: 'bien cocida' },
    ],
    subtotal: 22000, deliveryFee: 1500, total: 23500,
  };
  const t = C.waMessage({ business: 'Pizzería Test', branch: 'Centro' }, o, { trackUrl: 'https://x/carta.html?l=t&pedido=x' });
  assert.match(t, /Número: \*W-15\*/);
  assert.match(t, /Fecha: 26\/09\/26 13:15/, 'hora argentina');
  assert.match(t, /Tipo de pedido: \*Delivery\*/);
  assert.match(t, /Dirección: \*Mitre 1234 2B\* \(Zona 1\)/);
  assert.match(t, /paga con \$ ?30\.000 \(vuelto \$ ?6\.500\)/);
  assert.match(t, /2 x \*Muzzarella\* \(Grande\) — \$ ?22\.000/);
  assert.match(t, /\+ Huevo/);
  assert.match(t, /_bien cocida_/);
  assert.match(t, /Envío: \$ ?1\.500/);
  assert.match(t, /\*Total: \$ ?23\.500\*/);
  assert.match(t, /Seguimiento: https:\/\/x\/carta\.html/);
  assert.match(t, /Aclaraciones: Timbre no anda/);
});

test('carta: dirección pública', () => {
  assert.equal(C.slugify('Pizzería Diego — Centro'), 'pizzeria-diego-centro');
  assert.equal(C.validSlug('pizzeria-diego-centro'), true);
  assert.equal(C.validSlug('Con Mayúscula'), false);
  assert.equal(C.validSlug('-mal'), false);
  assert.equal(C.cartaUrl('https://trenggli.github.io/MuzzaAPP/index.html', 'diego'), 'https://trenggli.github.io/MuzzaAPP/carta.html?l=diego');
});

test('carta: el texto del tema siempre se lee', () => {
  for (const t of C.THEMES) {
    const v = C.themeVars(t);
    assert.ok(C.contrast(v['--c-primary'], v['--c-on-primary']) >= 3, `${t.id}: botón principal`);
    assert.ok(C.contrast(v['--c-bg'], v['--c-ink']) >= 4.5, `${t.id}: texto sobre el fondo`);
  }
  // colores elegidos a mano: texto claro sobre fondo oscuro y viceversa
  assert.equal(C.inkOn('#111111'), '#ffffff');
  assert.equal(C.inkOn('#ffe08a'), '#1d1b19');
});

test('pedido web aceptado: mantiene los precios del servidor y suma el costo de mercadería', () => {
  withMenu(S);
  const items = [{ id: 'w1', productId: 'p-muz', variantId: 'grande', variantName: 'Grande', half: { productId: 'p-esp', name: 'Especial' }, name: '½ Muzzarella + ½ Especial', extras: [], qty: 1, unitPrice: 14000, total: 14000, notes: '' }];
  const o = S.createOrder({ id: 'o-web-1', type: 'delivery', customerName: 'Web', phone: '1155551234', address: 'Mitre 1', zoneId: 'z1', deliveryFee: 1500, items: items.map((it) => ({ ...it, cost: S.itemCost(it) })), web: { id: 'uuid', number: 7 } });
  assert.equal(o.id, 'o-web-1');
  assert.equal(o.total, 15500);
  assert.deepEqual(JSON.parse(JSON.stringify(o.web)), { id: 'uuid', number: 7 });
  const recipe = Math.round(0.3 * 10000 + 500);  // grande: muzza 0.3 kg + 1 caja
  assert.equal(o.items[0].cost, recipe, 'misma receta en las dos mitades');
});

test('carta: Extra jamón solo aplica a pizzas con jamón (o mitad con jamón)', () => {
  const m = menu();
  const extraMuzza = { id: 'x-muz', name: 'Extra muzzarella', price: 2500 };
  const extraJamon = { id: 'x-jam', name: 'Extra jamón', price: 2000 };
  m.extras = [extraMuzza, extraJamon];

  const pizzaMuzza = m.products.find((p) => p.id === 'p-muz');
  const pizzaJamon = { id: 'p-jam', categoryId: 'c-piz', name: 'Jamón y morrones', desc: 'Muzzarella, jamón cocido y morrones', recipe: [{ ingredientId: 'i-jam', qty: 0.1 }], variants: [{ id: 'grande', name: 'Grande', price: 14000, factor: 1 }] };
  m.products.push(pizzaJamon);

  // Extra muzzarella aplica siempre
  assert.equal(C.extraApplies(extraMuzza, pizzaMuzza, null), true);
  assert.equal(C.extraApplies(extraMuzza, pizzaJamon, null), true);

  // Extra jamón no aplica a Muzzarella sola
  assert.equal(C.extraApplies(extraJamon, pizzaMuzza, null), false);

  // Extra jamón sí aplica a Jamón y morrones
  assert.equal(C.extraApplies(extraJamon, pizzaJamon, null), true);

  // Extra jamón aplica en mitad y mitad si la otra mitad tiene jamón
  assert.equal(C.extraApplies(extraJamon, pizzaMuzza, pizzaJamon), true);

  // priceLine filtra extras que no aplican
  const plMuzzaSinJamon = C.priceLine(m, { productId: 'p-muz', variantId: 'grande', halfId: '', extras: ['x-jam', 'x-muz'] });
  assert.equal(plMuzzaSinJamon.extras.length, 1);
  assert.equal(plMuzzaSinJamon.extras[0].id, 'x-muz');
  assert.equal(plMuzzaSinJamon.unit, 10000 + 2500);

  // priceLine incluye Extra jamón cuando el producto lo admite
  const plJamon = C.priceLine(m, { productId: 'p-jam', variantId: 'grande', halfId: '', extras: ['x-jam', 'x-muz'] });
  assert.equal(plJamon.extras.length, 2);
  assert.equal(plJamon.unit, 14000 + 2500 + 2000);
});

test('carta y mostrador: condimentos configurables con defaults y exclusiones/inclusiones', () => {
  const defs = C.defaults();
  assert.ok(Array.isArray(defs.condiments));
  assert.equal(defs.condiments.length, 2);
  assert.equal(defs.condiments[0].id, 'oregano');
  assert.equal(defs.condiments[0].default, true);
  assert.equal(defs.condiments[1].id, 'chimi');
  assert.equal(defs.condiments[1].default, true);

  // Lista personalizada agregando 'Ajo' (incluido por defecto) y 'Ají molido' (opcional)
  const custom = [
    { id: 'oregano', name: 'Orégano', default: true },
    { id: 'chimi', name: 'Chimi', default: true },
    { id: 'ajo', name: 'Ajo al óleo', default: true },
    { id: 'aji', name: 'Ají molido', default: false },
  ];

  // Simulación de selección: quita chimi, deja oregano y ajo, agrega aji molido
  const selected = { oregano: true, chimi: false, ajo: true, aji: true };
  const tags = [];
  custom.forEach((c) => {
    const isDef = c.default !== false;
    const isSel = !!selected[c.id];
    if (isDef && !isSel) tags.push(`Sin ${c.name.toLowerCase()}`);
    else if (!isDef && isSel) tags.push(`Con ${c.name.toLowerCase()}`);
  });

  assert.deepEqual(tags, ['Sin chimi', 'Con ají molido']);
});

test('tracking gps: distancia haversine y estimación de tiempo de llegada', () => {
  // Coordenadas Obelisco de Buenos Aires: -34.6037, -58.3816
  // Coordenadas Plaza de Mayo: -34.6083, -58.3712
  const d = C.haversineDistance(-34.6037, -58.3816, -34.6083, -58.3712);
  assert.ok(d >= 1.0 && d <= 1.2, `Distancia esperada ~1.1km, dio ${d}km`);

  // Misma ubicación debe dar 0 km
  assert.equal(C.haversineDistance(-34.6037, -58.3816, -34.6037, -58.3816), 0);

  // Estimación de llegada para 1.1 km a 25 km/h: (1.1 / 25)*60 = ~2.64 min -> ceil 3 + 2 = 5 min
  const eta5 = C.estimateDeliveryEta(1.1, 25);
  assert.equal(eta5, 5);

  // Sin distancia o negativa retorna margen mínimo de 3 minutos
  assert.equal(C.estimateDeliveryEta(0), 3);
  assert.equal(C.estimateDeliveryEta(-1), 3);

  // URL del repartidor
  const url = C.repartoUrl('https://trenggli.github.io/MuzzaAPP/index.html', 'centro', 'Lucas');
  assert.equal(url, 'https://trenggli.github.io/MuzzaAPP/reparto.html?l=centro&d=Lucas');
});


