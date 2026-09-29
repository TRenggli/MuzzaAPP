// Cliente de Mercado Pago con respuestas simuladas (sin tocar la cuenta real)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amount, externalIds, mpClient, MpError, orderState, parseMpWebhook, qrOrderBody, validReference } from '../supabase/functions/_shared/mp.ts';

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const r = responses.shift();
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fn, calls };
}

test('mp: el cuerpo del QR dinámico tiene lo que pide la API', () => {
  const b = qrOrderBody({ total: 23500, reference: 'pz-abc123', externalPosId: 'PZABCC1', description: 'Pedido #12', minutes: 10 });
  assert.equal(b.type, 'qr');
  assert.equal(b.total_amount, '23500.00');
  assert.equal(b.transactions.payments[0].amount, '23500.00');
  assert.equal(b.config.qr.mode, 'dynamic');
  assert.equal(b.config.qr.external_pos_id, 'PZABCC1');
  assert.equal(b.expiration_time, 'PT10M');
  assert.equal(b.external_reference, 'pz-abc123');
  assert.throws(() => qrOrderBody({ total: 0, reference: 'x', externalPosId: 'p' }), /mayor a cero/);
  assert.throws(() => qrOrderBody({ total: 10, reference: 'con espacio', externalPosId: 'p' }), /Referencia/);
});

test('mp: montos, referencias e identificadores', () => {
  assert.equal(amount(1500), '1500.00');
  assert.equal(amount(99.999), '100.00');
  assert.equal(validReference('pz-abc_123'), true);
  assert.equal(validReference('pz.abc'), false);
  const ids = externalIds('3f2a1b4c-0000-4000-8000-1234567890ab');
  assert.match(ids.store, /^PZ[A-Z0-9]{20}$/);
  assert.equal(ids.pos, ids.store + 'C1');
  assert.ok(ids.pos.length <= 40, 'la caja admite hasta 40 caracteres');
});

test('mp: estado de la orden para la caja', () => {
  assert.equal(orderState({ status: 'created' }), 'pending');
  assert.equal(orderState({ status: 'processed', status_detail: 'accredited' }), 'paid');
  assert.equal(orderState({ status: 'expired' }), 'expired');
  assert.equal(orderState({ status: 'canceled' }), 'canceled');
  assert.equal(orderState({ status: 'refunded' }), 'refunded');
});

test('mp: crea la orden con token, idempotencia y devuelve el qr_data', async () => {
  const { fn, calls } = fakeFetch([{ status: 201, body: { id: 'ORD01', status: 'created', type_response: { qr_data: '000201...' } } }]);
  const mp = mpClient('APP_USR-token', fn);
  const o = await mp.createQrOrder(qrOrderBody({ total: 100, reference: 'pz-1', externalPosId: 'PZX' }), 'pz-1');
  assert.equal(o.type_response.qr_data, '000201...');
  assert.equal(calls[0].url, 'https://api.mercadopago.com/v1/orders');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer APP_USR-token');
  assert.equal(calls[0].headers['X-Idempotency-Key'], 'pz-1');
});

test('mp: los errores llegan en castellano y sin exponer el token', async () => {
  const { fn } = fakeFetch([{ status: 401, body: { message: 'invalid_token' } }, { status: 400, body: { errors: [{ code: 'invalid_external_pos_id', message: 'external_pos_id not found' }] } }]);
  const mp = mpClient('APP_USR-secreto', fn);
  await assert.rejects(mp.me(), (e) => e instanceof MpError && e.status === 401 && /credenciales/.test(e.message) && !e.message.includes('secreto'));
  await assert.rejects(mp.getOrder('ORD1'), (e) => /external_pos_id not found/.test(e.message));
});

test('mp: getPayment consulta /v1/payments/{id}', async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: { id: 888123, status: 'approved', order: { id: 'ORD-99' } } }]);
  const mp = mpClient('APP_USR-token', fn);
  const pay = await mp.getPayment('888123');
  assert.equal(pay.id, 888123);
  assert.equal(calls[0].url, 'https://api.mercadopago.com/v1/payments/888123');
  assert.equal(calls[0].headers.Authorization, 'Bearer APP_USR-token');
});

test('mp: parseMpWebhook procesa query params y JSON body de webhooks v1 y v2', () => {
  // IPN tradicional vía query params
  const q1 = new URLSearchParams('topic=merchant_order&id=123456&user_id=789');
  const r1 = parseMpWebhook(q1);
  assert.equal(r1.id, '123456');
  assert.equal(r1.topic, 'merchant_order');
  assert.equal(r1.userId, '789');

  // Webhooks v2 con body JSON
  const q2 = new URLSearchParams('');
  const b2 = { action: 'payment.updated', data: { id: 987654 }, type: 'payment', user_id: 5555 };
  const r2 = parseMpWebhook(q2, b2);
  assert.equal(r2.id, '987654');
  assert.equal(r2.topic, 'payment');
  assert.equal(r2.userId, '5555');

  // Query params estilo v2 (data.id)
  const q3 = new URLSearchParams('data.id=ORD-999&type=merchant_order');
  const r3 = parseMpWebhook(q3);
  assert.equal(r3.id, 'ORD-999');
  assert.equal(r3.topic, 'merchant_order');
});

