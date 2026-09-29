// Webhook autónomo de Mercado Pago (IPN / Webhooks v1 y v2)
// Recibe avisos de Mercado Pago cuando un cliente abona un QR dinámico,
// incluso si el cajero cerró el navegador o perdió la conexión.
// Concilia automáticamente el estado en mp_payments y marca la comanda como pagada.

import { adminClient, cors, json } from '../_shared/common.ts';
import { MpError, mpClient, orderState, parseMpWebhook } from '../_shared/mp.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Método no permitido' }, 405);

  try {
    const url = new URL(req.url);
    let body: unknown = null;
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch (_) {
        body = null;
      }
    }

    const { id: resourceId, topic, userId } = parseMpWebhook(url.searchParams, body);
    if (!resourceId) {
      return json({ received: true, ignored: 'missing_id' }, 200);
    }

    const admin = adminClient();

    // 1. Localizar registro de cobro en mp_payments
    let { data: row } = await admin.from('mp_payments').select('*').eq('id', resourceId).maybeSingle();
    if (!row) {
      const { data: byPay } = await admin.from('mp_payments').select('*').eq('payment_id', resourceId).maybeSingle();
      row = byPay;
    }
    if (!row) {
      const { data: byRef } = await admin.from('mp_payments').select('*').eq('external_reference', resourceId).maybeSingle();
      row = byRef;
    }

    // 2. Si no se encontró por ID de orden/pago local, buscar la cuenta por collector user_id
    let acc: { org_id: string; access_token: string } | null = null;
    if (row) {
      const { data } = await admin.from('mp_accounts').select('org_id, access_token').eq('org_id', row.org_id).maybeSingle();
      acc = data;
    } else if (userId) {
      const { data } = await admin.from('mp_accounts').select('org_id, access_token').eq('mp_user_id', Number(userId)).maybeSingle();
      acc = data;
    }

    // Si tenemos cuenta y el evento es de pago, consultar pago en MP para vincular la orden
    if (!row && acc && (topic === 'payment' || topic.includes('payment'))) {
      try {
        const mp = mpClient(acc.access_token);
        const payObj = await mp.getPayment(resourceId);
        const orderId = payObj?.order?.id || payObj?.merchant_order_id;
        const extRef = payObj?.external_reference;
        if (orderId) {
          const { data: byOrd } = await admin.from('mp_payments').select('*').eq('id', String(orderId)).maybeSingle();
          row = byOrd;
        }
        if (!row && extRef) {
          const { data: byExt } = await admin.from('mp_payments').select('*').eq('external_reference', String(extRef)).maybeSingle();
          row = byExt;
        }
      } catch (e) {
        console.warn('Error resolviendo payment en MP:', e);
      }
    }

    if (!row || !acc) {
      // Notificación de otro recurso o aún no sincronizado: se responde 200 a MP para evitar reintentos continuos
      return json({ received: true, ignored: 'not_tracked', id: resourceId }, 200);
    }

    // 3. Consultar estado fehaciente de la orden en Mercado Pago
    const mp = mpClient(acc.access_token);
    const order = await mp.getOrder(row.id).catch((e) => {
      console.warn('Error consultando orden en MP:', e);
      return null;
    });

    if (!order) {
      return json({ received: true, warning: 'order_not_found_in_mp' }, 200);
    }

    const pay = order.transactions?.payments?.[0];
    const st = orderState(order);

    // 4. Actualizar registro en mp_payments
    await admin.from('mp_payments').update({
      status: order.status,
      status_detail: order.status_detail || null,
      payment_id: pay?.id ? String(pay.id) : row.payment_id,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);

    // 5. Si está pagado, conciliar y marcar comanda / pedido
    let reconciledCount = 0;
    if (st === 'paid') {
      const extRef = row.external_reference;

      // Buscar en pedidos del local
      const { data: orders } = await admin
        .from('orders')
        .select('id, data')
        .eq('org_id', row.org_id)
        .eq('branch_id', row.branch_id)
        .or(`id.eq.${extRef},data->>external_reference.eq.${extRef},data->>mpOrderId.eq.${row.id}`);

      if (orders && orders.length) {
        for (const o of orders) {
          const d = o.data || {};
          if (!d.paid) {
            d.paid = true;
            d.paidAt = Date.now();
            d.payments = Array.isArray(d.payments) ? d.payments : [];
            d.payments.push({
              method: 'qr',
              amount: Number(pay?.paid_amount || pay?.amount || row.amount),
              ref: `MP ${pay?.id || row.id}`,
              mp: { order: row.id, payment: pay?.id ? String(pay.id) : '' },
            });
            await admin.from('orders').update({
              data: d,
              updated_at: new Date().toISOString(),
            }).eq('org_id', row.org_id).eq('id', o.id);
            reconciledCount++;
          }
        }
      }

      // Buscar también en pedidos online si aplica
      const { data: onlineList } = await admin
        .from('online_orders')
        .select('id, data')
        .eq('org_id', row.org_id)
        .eq('branch_id', row.branch_id)
        .or(`data->>external_reference.eq.${extRef},data->>mpOrderId.eq.${row.id}`);

      if (onlineList && onlineList.length) {
        for (const oo of onlineList) {
          const d = oo.data || {};
          if (!d.paid) {
            d.paid = true;
            d.paidAt = Date.now();
            d.payments = Array.isArray(d.payments) ? d.payments : [];
            d.payments.push({
              method: 'qr',
              amount: Number(pay?.paid_amount || pay?.amount || row.amount),
              ref: `MP ${pay?.id || row.id}`,
              mp: { order: row.id, payment: pay?.id ? String(pay.id) : '' },
            });
            await admin.from('online_orders').update({
              data: d,
            }).eq('id', oo.id);
            reconciledCount++;
          }
        }
      }
    }

    return json({
      received: true,
      state: st,
      status: order.status,
      order_id: row.id,
      reconciled_orders: reconciledCount,
    }, 200);
  } catch (e) {
    console.error('Error procesando webhook de Mercado Pago:', e);
    if (e instanceof MpError) return json({ error: e.message }, 502);
    return json({ error: (e as Error).message || 'Error interno' }, 500);
  }
});
