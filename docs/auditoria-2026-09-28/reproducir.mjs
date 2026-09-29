// Diagnósticos locales. No accede a Supabase ni modifica datos de la aplicación.
// Ejecutar desde la raíz: node docs/auditoria-2026-09-28/reproducir.mjs
import assert from 'node:assert/strict';
import { loadApp, withMenu } from '../../tests/helpers/load.mjs';

const a = loadApp({ online: false });
const b = loadApp({ online: false });
for (const x of [a, b]) {
  withMenu(x.S);
  x.S.save = () => {};
  x.S.rebuildShadow();
  const p = x.S.data.products[0];
  x.S.createOrder({ items: [x.S.makeItem({ product: p, variant: p.variants[0] })] });
  x.S.diff();
}
for (const x of [a, b]) { x.setOnline(true); await x.S.flush(); }
const patchA = a.sent.docs.find(d => d.col === 'ingredient' && d.id.endsWith('i-muz')).data;
const patchB = b.sent.docs.find(d => d.col === 'ingredient' && d.id.endsWith('i-muz')).data;
// Equivalente al merge superficial docs.data || excluded.data del SQL actual.
const remote = { stock: 10, ...patchA, ...patchB };
assert.equal(remote.stock, 9.7);
console.log('REPRODUCIDO: dos consumos de 0,3 kg dejan 9,7 kg; deberían dejar 9,4 kg.');

const c = loadApp({ online: false });
const numbers = Array.from({ length: 5 }, () => c.S.nextNumber('order'));
assert.ok(new Set(numbers).size < numbers.length);
console.log('REPRODUCIDO: números sin bloques reservados:', numbers);

const d = loadApp();
d.S.rebuildShadow();
d.S.data.customers.push({ id: 'new-customer', name: 'Test' });
d.S.data.orders.push({ id: 'order-1', createdAt: 1, items: [], total: 0 });
d.S.diff();
d.S.refresh = async () => {};
d.PZ.cloud.upsertDocs = async () => {
  throw Object.assign(new Error('Rechazo simulado de documento, esperado por esta reproducción'), { code: 'P0001' });
};
await d.S.flush();
assert.equal(d.S.status.pending, 0);
assert.equal(d.sent.orders.length, 0);
assert.equal(d.S.status.state, 'error');
console.log('REPRODUCIDO: un rechazo de documentos deja 0 pendientes y el pedido del mismo lote no se envía.');
console.log('Estos resultados confirman defectos actuales; no son pruebas de que estén corregidos.');
