// Pedidos y configuraciones de ejemplo para comprobar la salida de los comprobantes en los cinco formatos
// (pantalla, térmica del cliente, texto de WhatsApp, comanda en pantalla y comanda térmica).
import fs from 'node:fs';
import vm from 'node:vm';
import { loadApp } from './load.mjs';

// la fecha y la hora salen en horario local: se fija para que la salida sea la misma en cualquier equipo
process.env.TZ = 'America/Argentina/Buenos_Aires';

const T0 = Date.UTC(2026, 9, 3, 18, 30); // 15:30 en Buenos Aires

const item = (extra = {}) => ({
  id: 'it-1', productId: 'p-muz', variantId: 'grande', variantName: 'Grande', name: 'Muzzarella', extras: [], qty: 1, unitPrice: 10000, total: 10000, cost: 0, notes: '', ...extra,
});

/** Pedidos de ejemplo (objetos planos: no dependen de la numeración ni del reloj) */
export function orders() {
  const base = {
    ticketNumber: null, createdAt: T0, paidAt: null, userId: 'u-owner', type: 'mostrador', table: '', customerName: '', phone: '', address: '',
    discount: null, discountAmount: 0, cashDiscount: 0, surcharge: 0, deliveryFee: 0, payments: [], paid: false, status: 'pendiente', notes: '', voided: false,
  };
  const two = [item({ qty: 2, total: 20000, extras: [{ id: 'e1', name: 'Huevo', price: 1000 }], notes: 'bien cocida' }), item({ id: 'it-2', name: 'Fugazzeta', variantName: '', unitPrice: 12000, total: 12000 })];
  return {
    pago_delivery: {
      ...base, id: 'o-1', number: 41, ticketNumber: 12, paidAt: T0 + 600000, type: 'delivery', customerName: 'María Gómez', phone: '3415551234', address: 'San Martín 123 4°B',
      items: two, subtotal: 32000, discount: { type: '%', value: 10 }, discountAmount: 3200, deliveryFee: 1500, total: 30300, paid: true, status: 'entregado', eta: '21:30',
      payments: [{ method: 'efectivo', amount: 30300, tendered: 40000 }], notes: 'Timbre roto, llamar',
    },
    pago_mixto: {
      ...base, id: 'o-2', number: 42, ticketNumber: 13, paidAt: T0 + 900000, type: 'mostrador', userId: 'u-caja',
      items: [item({ qty: 3, total: 30000 })], subtotal: 30000, cashDiscount: 1000, surcharge: 500, total: 29500, paid: true, status: 'entregado',
      payments: [{ method: 'transferencia', amount: 10000, ref: 'OP-998877' }, { method: 'tarjeta', amount: 10000, cardType: 'crédito' }, { method: 'efectivo', amount: 9500, tendered: 9500 }],
    },
    cobrar_efectivo: {
      ...base, id: 'o-3', number: 43, type: 'delivery', customerName: 'Juan Pérez', phone: '3415559999', address: 'Mitre 45',
      items: two, subtotal: 32000, deliveryFee: 1500, total: 33500, collect: { method: 'efectivo', amount: 33000, tendered: 50000 }, status: 'listo', eta: '22:00',
    },
    cobrar_justo: {
      ...base, id: 'o-4', number: 44, type: 'delivery', customerName: 'Lu', address: 'Sarmiento 9', items: [item()], subtotal: 10000, total: 10000,
      collect: { method: 'efectivo', amount: 10000, tendered: 10000 },
    },
    cobrar_transferencia: {
      ...base, id: 'o-5', number: 45, type: 'retiro', customerName: 'Pedro', phone: '3415550000', items: [item({ qty: 2, total: 20000 })], subtotal: 20000, total: 20000, status: 'horno',
      notes: 'Sin cebolla',
    },
    cuenta: {
      ...base, id: 's-1', tableBill: true, number: 'Mesa 5', type: 'mesa', table: '5', createdAt: T0 - 3600000, items: two, subtotal: 32000, total: 32000,
      status: 'entregado', notes: '3 tandas · 4 personas',
    },
    cuenta_pagada: {
      ...base, id: 's-2', tableBill: true, number: 'Mesa 5', type: 'mesa', table: '5', createdAt: T0 - 3600000, ticketNumber: 30, paidAt: T0, items: two, subtotal: 32000, total: 32000,
      paid: true, status: 'entregado', payments: [{ method: 'qr', amount: 32000, tendered: 32000, change: 0 }], notes: '3 tandas',
    },
    anulado: {
      ...base, id: 'o-6', number: 46, ticketNumber: 14, paidAt: T0, items: [item()], subtotal: 10000, total: 10000, paid: true, voided: true, status: 'cancelado',
      payments: [{ method: 'efectivo', amount: 10000, tendered: 10000 }],
    },
    mesa_tanda: {
      ...base, id: 'o-7', number: 47, type: 'mesa', table: '5', tableSessionId: 'ts-1', batchNumber: 2, items: two, subtotal: 32000, total: 32000, notes: 'Para compartir', customerName: 'Familia Ruiz',
    },
  };
}

/** Configuraciones del local (cada una cambia qué datos hay para mostrar) */
export const VARIANTS = {
  completa: {
    ticket: { width: 80, qrMode: 'instagram', qrText: '', legend: 'Comprobante no válido como factura', footer: '¡Gracias por tu compra!', showLogo: true, logo: null, docTitle: 'Comprobante de pago', escposAccents: false },
    business: { name: 'La Piedra Pizzería', slogan: 'La de siempre', address: 'Belgrano 456', city: 'Rosario', phone: '341 555-0101', cuit: '20-12345678-6', taxCondition: 'Monotributista', instagram: '@lapiedra' },
    payments: { alias: 'lapiedra.pizza', cbu: '0000003100000000000001', holder: 'La Piedra SRL' },
    branches: 1,
  },
  angosta: {
    ticket: { width: 58, qrMode: 'custom', qrText: 'https://g.page/r/lapiedra', legend: 'Gracias', footer: 'Volvé pronto', showLogo: false, docTitle: 'Recibo', escposAccents: true },
    business: { name: 'La Piedra Pizzería', slogan: '', address: 'Belgrano 456', city: '', phone: '', cuit: '', taxCondition: '', instagram: '' },
    payments: { alias: 'lapiedra.pizza', cbu: '', holder: '' },
    branches: 2,
  },
  minima: {
    ticket: { width: 80, qrMode: 'none', qrText: '', legend: '', footer: '', showLogo: false, docTitle: 'Ticket', escposAccents: false },
    business: { name: 'Pizza', slogan: '', address: '', city: '', phone: '', cuit: '', taxCondition: '', instagram: '' },
    payments: { alias: '', cbu: '', holder: '' },
    branches: 1,
  },
};

/** Una instancia de la app con el módulo de comprobantes de `file` cargado y la configuración de `variant` */
export function ticketApp(variantName, file = new URL('../../js/ticket.js', import.meta.url), { layout } = {}) {
  const app = loadApp();
  const { PZ, S, ctx } = app;
  ctx.document = { createElement: () => ({}), head: { appendChild() {} } };
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'ticket.js' });
  const v = VARIANTS[variantName];
  Object.assign(S.data.settings.ticket, v.ticket);
  Object.assign(S.data.settings.business, v.business);
  Object.assign(S.data.settings.payments, v.payments);
  if (layout) S.data.settings.ticket.layout = layout;
  S.ctx.branches = Array.from({ length: v.branches }, (_, i) => ({ id: i ? 'br-' + (i + 1) : 'br-1', name: i ? 'Norte' : 'Centro', active: true }));
  S.ctx.members = [
    { user_id: 'u-owner', name: 'Dueño', username: 'dueno', role: 'owner', active: true, branch_ids: [] },
    { user_id: 'u-caja', name: 'Sofía', username: 'sofia', role: 'cajero', active: true, branch_ids: [] },
  ];
  S.afterLoad();
  return app;
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

/** La salida de un pedido en los cinco formatos */
export async function renderAll(app, o) {
  const T = app.PZ.ticket;
  const t = app.S.data.settings.ticket;
  return {
    customerHTML: T.customerHTML(o),
    customerHTMLCopia: T.customerHTML(o, { copy: 'Original' }),
    kitchenHTML: T.kitchenHTML(o),
    plain: T.plainText(o),
    // la térmica con logo necesita un canvas (navegador): se prueba solo sin logo
    escCustomer: t.showLogo ? null : b64(await T.escpos.customer(o)),
    escKitchen: b64(T.escpos.kitchen(o)),
  };
}

/** Los bytes de ESC/POS en texto legible (sin comandos de control) para buscar frases */
export const escText = (base64) => Buffer.from(base64, 'base64').toString('latin1').replace(/[\x00-\x08\x0b-\x1f]/g, '');
