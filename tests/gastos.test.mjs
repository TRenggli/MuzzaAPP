import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, withMenu } from './helpers/load.mjs';

test('gastos: cálculo de rentabilidad histórica y margen con datos remotos', async () => {
  const { PZ, S, setOnline } = loadApp();
  withMenu(S);
  setOnline(true);

  const ninetyDaysAgo = Date.now() - 90 * 864e5;
  const from = ninetyDaysAgo;
  const to = ninetyDaysAgo + 30 * 864e5;

  // Pedidos remotos devueltos por Supabase
  const remoteOrders = [
    {
      id: 'ord-hist-1',
      createdAt: from + 1000,
      paidAt: from + 5000,
      paid: true,
      voided: false,
      total: 50000,
      items: [{ cost: 15000, qty: 1 }],
    },
    {
      id: 'ord-hist-2',
      createdAt: from + 10000,
      paidAt: from + 12000,
      paid: true,
      voided: false,
      total: 30000,
      items: [{ cost: 9000, qty: 1 }],
    },
    {
      id: 'ord-hist-voided',
      createdAt: from + 15000,
      paidAt: from + 16000,
      paid: true,
      voided: true, // anulada, no debe sumar
      total: 20000,
      items: [{ cost: 6000, qty: 1 }],
    },
  ];

  PZ.cloud.ordersRange = async (_branchId, _from, _to) => remoteOrders;

  // Gastos del período
  S.addExpense({ category: 'Alquiler', amount: 20000, at: from + 2000 });
  S.addExpense({ category: 'Sueldos', amount: 15000, at: from + 4000 });
  S.addExpense({ category: 'Servicios', amount: 5000, at: from + 6000 });

  const p = await S.profitInRange(from, to);

  assert.equal(p.complete, true, 'debe marcar complete cuando consulta al servidor con conexión');
  assert.equal(p.orders.length, 2, 'solo pedidos pagados y no anulados');
  assert.equal(p.sales, 80000, '50000 + 30000');
  assert.equal(p.cogs, 24000, '15000 + 9000');
  assert.equal(p.expenses, 40000, '20000 + 15000 + 5000');
  assert.equal(p.result, 40000, 'ventas 80000 - gastos 40000');
  assert.equal(p.margin, 0.5, 'margen 50%');
  assert.equal(p.byCat['Alquiler'], 20000);
  assert.equal(p.byCat['Sueldos'], 15000);
  assert.equal(p.byCat['Servicios'], 5000);
});

test('gastos: sin conexión a internet el período histórico marca incomplete', async () => {
  const { S, setOnline } = loadApp();
  setOnline(false);

  const ninetyDaysAgo = Date.now() - 90 * 864e5;
  const p = await S.profitInRange(ninetyDaysAgo, ninetyDaysAgo + 864e5);

  assert.equal(p.complete, false, 'offline en fechas viejas no puede considerarse completo');
  assert.equal(p.sales, 0);
});

test('gastos: selector de meses abarca 24 meses históricos', () => {
  const months = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  assert.equal(months.length, 24);
  assert.ok(months[0].match(/^\d{4}-\d{2}$/));
  assert.ok(months[23].match(/^\d{4}-\d{2}$/));
});

test('gastos: banners visuales para sincronizado, cargando y sin conexión', () => {
  const localSince = Date.now() - 44 * 864e5;
  const getBanner = (from, complete, onLine) => {
    if (from < localSince) {
      if (complete) {
        return 'sincronizado';
      } else if (onLine) {
        return 'cargando';
      } else {
        return 'offline';
      }
    }
    return 'normal';
  };

  const pastDate = Date.now() - 60 * 864e5;
  const currentDate = Date.now();

  assert.equal(getBanner(currentDate, false, true), 'normal', 'mes actual no requiere banner histórico');
  assert.equal(getBanner(pastDate, true, true), 'sincronizado', 'período histórico completado');
  assert.equal(getBanner(pastDate, false, true), 'cargando', 'período histórico en carga');
  assert.equal(getBanner(pastDate, false, false), 'offline', 'período histórico sin internet');
});
