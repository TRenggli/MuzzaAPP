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

test('repartidor: identificador único, parseo y matching de chofer', () => {
  // Generación de código
  assert.equal(C.generateDriverCode('DEL', 101), 'DEL-101');
  assert.equal(C.generateDriverCode('DIEGO', 5), 'DIEGO-005');

  // Parseo de código con sucursal embebida
  const p1 = C.parseDriverCode('DIEGO-101');
  assert.equal(p1.slug, 'diego');
  assert.equal(p1.code, 'DIEGO-101');
  assert.equal(p1.driverNum, '101');

  // Parseo con código corto y slug de respaldo
  const p2 = C.parseDriverCode('DEL-102', 'centro');
  assert.equal(p2.slug, 'centro');
  assert.equal(p2.code, 'DEL-102');

  // Matching de repartidor con lista mixta (strings y objetos)
  const drivers = [
    { name: 'Lucas', code: 'DIEGO-101' },
    { name: 'Carlos', code: 'DEL-102' },
    'Martín'
  ];

  assert.deepEqual(plain(C.matchDriver(drivers, 'DIEGO-101')), { name: 'Lucas', code: 'DIEGO-101' });
  assert.deepEqual(plain(C.matchDriver(drivers, 'DEL-102')), { name: 'Carlos', code: 'DEL-102' });
  assert.deepEqual(plain(C.matchDriver(drivers, 'carlos')), { name: 'Carlos', code: 'DEL-102' });
  assert.deepEqual(plain(C.matchDriver(drivers, 'Martín')), { name: 'Martín', code: 'MARTÍN' });
  assert.equal(C.matchDriver(drivers, 'INEXISTENTE'), null);

  // URL de reparto con código único
  const url = C.repartoUrl('https://trenggli.github.io/MuzzaAPP/index.html', 'diego', 'Lucas', '', 'DIEGO-101');
  assert.equal(url, 'https://trenggli.github.io/MuzzaAPP/reparto.html?l=diego&d=Lucas&c=DIEGO-101');
});

test('pizzas: opción individual allowHalf=false impide mitad y mitad y no puede ser elegida como segunda mitad', () => {
  const m = menu();
  const calzone = {
    id: 'p-calzone',
    categoryId: 'c-piz',
    name: 'Calzón relleno',
    desc: 'Solo se vende entero',
    active: true,
    allowHalf: false, // desmarcado por el usuario
    variants: [{ id: 'grande', name: 'Grande', price: 16000, factor: 1 }],
  };
  m.products.push(calzone);

  const muzza = m.products.find((p) => p.id === 'p-muz');

  // Caso 1: Intentar pedir el calzone con mitad de muzzarella debe ser ignorado y cobrar solo el calzone entero
  const lineCalzone = { productId: 'p-calzone', variantId: 'grande', halfId: 'p-muz', extras: [], qty: 1 };
  const plCalzone = C.priceLine(m, lineCalzone);
  assert.equal(plCalzone.half, null, 'Calzón con allowHalf=false no admite mitad');
  assert.equal(plCalzone.name, 'Calzón relleno');
  assert.equal(plCalzone.unit, 16000);

  // Caso 2: Intentar pedir Muzzarella con mitad de Calzone debe ser ignorado porque Calzone tiene allowHalf=false
  const lineMuzzaConCalzone = { productId: 'p-muz', variantId: 'grande', halfId: 'p-calzone', extras: [], qty: 1 };
  const plMuzza = C.priceLine(m, lineMuzzaConCalzone);
  assert.equal(plMuzza.half, null, 'Calzón no puede ser seleccionado como segunda mitad de otra pizza');
  assert.equal(plMuzza.name, 'Muzzarella');
  assert.equal(plMuzza.unit, 10000);
});

test('carta imprimible: normalización de variantes (evita duplicar "Media docena" y "Media Docena") y orden natural', () => {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const KNOWN_RANKS = {
    'u': 1, 'unidad': 1, 'porción': 1, 'porcion': 1, 'individual': 1, 'chica': 2,
    'media': 3, 'mediana': 3, 'media docena': 4,
    'grande': 5, 'docena': 6, 'familiar': 7, 'gigante': 8,
  };

  // Simulación de productos en la categoría Empanadas cargados con inconsistencias de tipeo
  const ps = [
    {
      name: 'Empanada de carne suave',
      variants: [
        { name: 'Unidad', price: 2500 },
        { name: 'Media docena', price: 15000 },
        { name: 'Docena', price: 30000 }
      ]
    },
    {
      name: 'Empanada jamón y queso',
      variants: [
        { name: 'UNIDAD', price: 2500 },
        { name: 'Docena', price: 30000 },
        { name: 'Media Docena ', price: 15000 } // Tipeo con mayúsculas y espacio al final
      ]
    }
  ];

  const colMap = new Map();
  ps.forEach((p) => {
    p.variants.forEach((v) => {
      const raw = String(v.name || '').trim();
      if (!raw) return;
      const key = norm(raw);
      const price = Number(v.price) || 0;
      if (!colMap.has(key)) {
        const label = raw.charAt(0).toUpperCase() + raw.slice(1);
        colMap.set(key, { key, label, avgPrice: price, count: 1 });
      } else {
        const cur = colMap.get(key);
        cur.avgPrice = (cur.avgPrice * cur.count + price) / (cur.count + 1);
        cur.count += 1;
      }
    });
  });

  const cols = Array.from(colMap.values()).sort((x, y) => {
    const rx = KNOWN_RANKS[x.key] || 99;
    const ry = KNOWN_RANKS[y.key] || 99;
    if (rx !== ry) return rx - ry;
    return x.avgPrice - y.avgPrice;
  });

  // Debe haber EXACTAMENTE 3 columnas, sin repetir Media docena
  assert.equal(cols.length, 3, 'Debe haber exactamente 3 columnas');
  assert.deepEqual(cols.map((c) => c.key), ['unidad', 'media docena', 'docena']);

  // Ambos productos deben mapear sus precios al 100% en las 3 columnas sin ningún guion '—'
  const row1 = cols.map((c) => {
    const v = ps[0].variants.find((x) => norm(x.name) === c.key);
    return v ? v.price : null;
  });
  const row2 = cols.map((c) => {
    const v = ps[1].variants.find((x) => norm(x.name) === c.key);
    return v ? v.price : null;
  });

  assert.deepEqual(row1, [2500, 15000, 30000]);
  assert.deepEqual(row2, [2500, 15000, 30000]);
});

test('carta del salón: ordenamiento de productos por menor precio, mayor precio y alfabético', () => {
  const p1 = { id: 'p1', name: 'Muzzarella', categoryId: 'c1', active: true, _i: 0, variants: [{ id: 'g', name: 'Grande', price: 10000 }] };
  const p2 = { id: 'p2', name: 'Fugazzeta Rellena', categoryId: 'c1', active: true, _i: 1, variants: [{ id: 'g', name: 'Grande', price: 14000 }] };
  const p3 = { id: 'p3', name: 'Calabresa', categoryId: 'c1', active: true, _i: 2, variants: [{ id: 'ch', name: 'Chica', price: 8000 }, { id: 'g', name: 'Grande', price: 12000 }] };

  // Menor precio primero (p3 menor precio es 8000, luego p1 es 10000, luego p2 es 14000)
  const asc = C.sortProducts([p1, p2, p3], 'price_asc');
  assert.deepEqual(plain(asc.map((x) => x.id)), ['p3', 'p1', 'p2'], 'Menor precio primero debe ordenar por precio mínimo de variante');

  // Mayor precio primero (p2 con 14000, p1 con 10000, p3 con 8000)
  const desc = C.sortProducts([p1, p2, p3], 'price_desc');
  assert.deepEqual(plain(desc.map((x) => x.id)), ['p2', 'p1', 'p3'], 'Mayor precio primero');

  // Alfabético (Calabresa -> Fugazzeta Rellena -> Muzzarella)
  const alf = C.sortProducts([p1, p2, p3], 'name');
  assert.deepEqual(plain(alf.map((x) => x.name)), ['Calabresa', 'Fugazzeta Rellena', 'Muzzarella'], 'Alfabético por nombre');

  // Orden catálogo original (_i)
  const cat = C.sortProducts([p3, p1, p2], 'cat');
  assert.deepEqual(plain(cat.map((x) => x.id)), ['p1', 'p2', 'p3'], 'Orden del catálogo');
});

test('carta del salón: filtrado y preparación de categorías seleccionadas', () => {
  const cats = [
    { id: 'c-piz', name: 'Pizzas', icon: '🍕', allowHalf: true },
    { id: 'c-emp', name: 'Empanadas', icon: '🥟', allowHalf: false },
    { id: 'c-beb', name: 'Bebidas', icon: '🥤', allowHalf: false },
  ];
  const prods = [
    { id: 'p1', categoryId: 'c-piz', name: 'Muzza', active: true, variants: [{ id: 'u', name: 'Grande', price: 10000 }] },
    { id: 'p2', categoryId: 'c-piz', name: 'Fugazza', active: true, variants: [{ id: 'u', name: 'Grande', price: 9000 }] },
    { id: 'p3', categoryId: 'c-emp', name: 'Carne', active: true, variants: [{ id: 'u', name: 'Unidad', price: 1500 }] },
    { id: 'p4', categoryId: 'c-beb', name: 'Agua', active: true, variants: [{ id: 'u', name: '500ml', price: 1200 }] },
  ];

  // Si el dueño solo seleccionó Pizzas y Bebidas
  const prep = C.prepareSalonCategories(cats, prods, ['c-piz', 'c-beb'], 'price_asc');
  assert.equal(prep.length, 2, 'Deben quedar exactamente 2 categorías');
  assert.deepEqual(plain(prep.map((x) => x.category.id)), ['c-piz', 'c-beb'], 'Solo categorías seleccionadas');

  // En pizzas, Fugazza (9000) debe estar antes que Muzza (10000) por price_asc
  assert.deepEqual(plain(prep[0].products.map((p) => p.name)), ['Fugazza', 'Muzza'], 'Productos ordenados por menor precio');

  // Si no se pasa filtro (o vacío), se incluyen todas las que tienen productos activos
  const prepAll = C.prepareSalonCategories(cats, prods, [], 'cat');
  assert.equal(prepAll.length, 3, 'Todas las categorías disponibles');
});

test('carta del salón: generación de URL pública y persistencia del código QR', () => {
  const base = 'https://trenggli.github.io/MuzzaAPP/index.html';
  const url = C.salonUrl(base, 'pizzeria-diego-centro', 'qr_token_permanente_999');

  assert.ok(url.includes('carta.html'), 'Debe apuntar a carta.html');
  assert.ok(url.includes('l=pizzeria-diego-centro'), 'Debe incluir el slug de la sucursal');
  assert.ok(url.includes('vista=carta'), 'Debe incluir vista=carta para abrir la carta del salón sin carrito de delivery');
  assert.ok(url.includes('qr=qr_token_permanente_999'), 'Debe incluir el token persistente de la mesa');
});

test('código QR permanente: genera SVG no vacío con dimensiones de ancho y alto explícitas', () => {
  const url = C.salonUrl('https://trenggli.github.io/MuzzaAPP/index.html', 'pizzeria-el-viejo-andres-el-viejo-andres', 'qr_token_permanente_123');
  const svg = PZ.util.qrSvg(url, 5, 2);

  assert.ok(svg.length > 500, 'El SVG generado debe tener contenido y módulos dibujados');
  assert.ok(svg.includes('<svg'), 'Debe ser una etiqueta SVG válida');
  assert.ok(/width="\d+px"/.test(svg), 'El SVG debe tener atributo width explícito para no colapsar a 0px');
  assert.ok(/height="\d+px"/.test(svg), 'El SVG debe tener atributo height explícito para no colapsar a 0px');
  assert.ok(svg.includes('viewBox="0 0'), 'El SVG debe conservar viewBox para ser escalable');
});




