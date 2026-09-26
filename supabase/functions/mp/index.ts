// Mercado Pago · cobro con QR dinámico
//   account       → ¿el negocio tiene Mercado Pago conectado? ¿la sucursal está lista?
//   connect       → el dueño guarda su Access Token (se valida y nunca se devuelve)
//   disconnect    → el dueño desconecta la cuenta
//   setup_branch  → crea la sucursal y la caja en Mercado Pago (una vez por sucursal)
//   create        → genera el QR con el monto de la venta
//   status        → consulta si ya se pagó
//   cancel        → anula un QR que no se usó
import { adminClient, cors, json } from '../_shared/common.ts';
import { externalIds, MpError, mpClient, orderState, qrOrderBody, validReference } from '../_shared/mp.ts';

type Member = { role: string; active: boolean; branch_ids: string[] | null };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  try {
    const admin = adminClient();
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await admin.auth.getUser(token);
    const caller = auth?.user;
    if (!caller) return json({ error: 'Sesión inválida' }, 401);

    const body = await req.json();
    const { action } = body;
    const orgId = String(body.org_id || '');
    const branchId = String(body.branch_id || '');
    if (!orgId) return json({ error: 'Falta el negocio' }, 400);

    // ---------- permisos ----------
    const [{ data: pa }, { data: me }, { data: org }] = await Promise.all([
      admin.from('platform_admins').select('user_id').eq('user_id', caller.id).maybeSingle(),
      admin.from('members').select('role, active, branch_ids').eq('org_id', orgId).eq('user_id', caller.id).maybeSingle(),
      admin.from('organizations').select('id, name, status, features').eq('id', orgId).maybeSingle(),
    ]);
    if (!org) return json({ error: 'Negocio inexistente' }, 404);
    const isPlatform = !!pa;
    const m = me as Member | null;
    if (!isPlatform && (!m || !m.active || org.status !== 'active')) return json({ error: 'Sin acceso a este negocio' }, 403);
    if ((org.features || {}).mercadopago === false) return json({ error: 'El módulo de Mercado Pago no está habilitado para este negocio' }, 403);
    const role = isPlatform ? 'owner' : m!.role;
    const isOwner = role === 'owner';
    const canBranch = (id: string) => isOwner || !(m!.branch_ids || []).length || (m!.branch_ids || []).includes(id);
    const needBranch = async () => {
      if (!branchId || !canBranch(branchId)) return null;
      const { data } = await admin.from('branches').select('id, name, org_id').eq('id', branchId).eq('org_id', orgId).maybeSingle();
      return data;
    };

    const { data: acc } = await admin.from('mp_accounts').select('*').eq('org_id', orgId).maybeSingle();

    // ---------- estado ----------
    if (action === 'account') {
      let branchReady = false;
      if (branchId && canBranch(branchId)) {
        const { data } = await admin.from('mp_pos').select('branch_id').eq('branch_id', branchId).maybeSingle();
        branchReady = !!data;
      }
      return json({
        connected: !!acc, nickname: acc?.nickname || '', site_id: acc?.site_id || '',
        branchReady: !!acc && branchReady, canManage: isOwner, canSetup: isOwner || role === 'admin',
      });
    }

    // ---------- conectar / desconectar (dueño) ----------
    if (action === 'connect') {
      if (!isOwner) return json({ error: 'Solo el dueño puede conectar Mercado Pago' }, 403);
      const tk = String(body.access_token || '').trim();
      if (!/^(APP_USR|TEST)-[A-Za-z0-9-]{20,}$/.test(tk)) return json({ error: 'Pegá el Access Token completo (empieza con APP_USR-)' }, 400);
      const user = await mpClient(tk).me();
      if (acc && Number(acc.mp_user_id) !== Number(user.id)) {
        // otra cuenta: las cajas creadas con la anterior ya no sirven
        await admin.from('mp_pos').delete().eq('org_id', orgId);
      }
      const { error } = await admin.from('mp_accounts').upsert({
        org_id: orgId, access_token: tk, mp_user_id: user.id, nickname: user.nickname || '', site_id: user.site_id || '',
        created_by: caller.id, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return json({ connected: true, nickname: user.nickname || '', site_id: user.site_id || '' });
    }

    if (action === 'disconnect') {
      if (!isOwner) return json({ error: 'Solo el dueño puede desconectar Mercado Pago' }, 403);
      await admin.from('mp_pos').delete().eq('org_id', orgId);
      await admin.from('mp_accounts').delete().eq('org_id', orgId);
      return json({ connected: false });
    }

    if (!acc) return json({ error: 'Este negocio no tiene Mercado Pago conectado' }, 400);
    const mp = mpClient(acc.access_token);

    // ---------- preparar la sucursal (encargado o dueño) ----------
    if (action === 'setup_branch') {
      if (!isOwner && role !== 'admin') return json({ error: 'Solo el dueño o un encargado' }, 403);
      const br = await needBranch();
      if (!br) return json({ error: 'Sucursal inválida' }, 400);
      const loc = body.location || {};
      const need = ['street_name', 'street_number', 'city_name', 'state_name'];
      if (need.some((k) => !String(loc[k] || '').trim())) return json({ error: 'Completá calle, número, ciudad y provincia' }, 400);
      const lat = Number(loc.latitude);
      const lng = Number(loc.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
        return json({ error: 'Falta la ubicación del local (latitud y longitud)' }, 400);
      }
      const ids = externalIds(branchId);
      const storeName = `${org.name} ${br.name}`.replace(/\s+/g, ' ').trim();
      let store = await mp.findStore(acc.mp_user_id, ids.store).catch(() => null);
      if (!store) {
        const s = await mp.createStore(acc.mp_user_id, {
          name: storeName, externalId: ids.store,
          location: { street_name: String(loc.street_name).trim(), street_number: String(loc.street_number).trim(), city_name: String(loc.city_name).trim(), state_name: String(loc.state_name).trim(), latitude: lat, longitude: lng, reference: String(loc.reference || '').slice(0, 100) },
        });
        store = { id: String(s.id) };
      }
      let pos = await mp.findPos(ids.pos).catch(() => null);
      if (!pos) {
        const p = await mp.createPos({ name: `Caja ${br.name}`, storeId: store.id, externalId: ids.pos }, crypto.randomUUID());
        pos = { id: String(p.id) };
      }
      const { error } = await admin.from('mp_pos').upsert({
        branch_id: branchId, org_id: orgId, store_id: store.id, external_store_id: ids.store, pos_id: pos.id, external_pos_id: ids.pos,
      });
      if (error) throw error;
      return json({ ok: true });
    }

    // ---------- cobrar ----------
    if (action === 'create') {
      if (!['owner', 'admin', 'cajero'].includes(role)) return json({ error: 'Tu rol no puede cobrar' }, 403);
      const br = await needBranch();
      if (!br) return json({ error: 'Sucursal inválida' }, 400);
      const { data: pos } = await admin.from('mp_pos').select('*').eq('branch_id', branchId).maybeSingle();
      if (!pos) return json({ error: 'Falta activar Mercado Pago en esta sucursal (Configuración → Cobros)' }, 400);
      const total = Math.round(Number(body.amount) * 100) / 100;
      if (!(total > 0) || total > 50_000_000) return json({ error: 'Monto inválido' }, 400);
      const reference = String(body.reference || '');
      if (!validReference(reference)) return json({ error: 'Referencia inválida' }, 400);
      const order = await mp.createQrOrder(
        qrOrderBody({ total, reference, externalPosId: pos.external_pos_id, description: String(body.description || `${org.name} · ${br.name}`), minutes: 10 }),
        reference,
      );
      await admin.from('mp_payments').upsert({
        id: order.id, org_id: orgId, branch_id: branchId, external_reference: reference, amount: total,
        status: order.status, status_detail: order.status_detail || null, created_by: caller.id,
      });
      return json({ id: order.id, qr_data: order.type_response?.qr_data || '', state: orderState(order), minutes: 10 });
    }

    if (action === 'status' || action === 'cancel') {
      const id = String(body.id || '');
      const { data: row } = await admin.from('mp_payments').select('*').eq('id', id).eq('org_id', orgId).maybeSingle();
      if (!row || !canBranch(row.branch_id)) return json({ error: 'Cobro inexistente' }, 404);
      let order;
      if (action === 'cancel') {
        try { order = await mp.cancelOrder(id, crypto.randomUUID()); } catch (e) {
          // si ya se pagó no se puede cancelar: se informa el estado real
          order = await mp.getOrder(id);
          if (orderState(order) === 'pending') throw e;
        }
      } else {
        order = await mp.getOrder(id);
      }
      const pay = order.transactions?.payments?.[0];
      await admin.from('mp_payments').update({
        status: order.status, status_detail: order.status_detail || null, payment_id: pay?.id || null, updated_at: new Date().toISOString(),
      }).eq('id', id);
      return json({
        id, state: orderState(order), status: order.status, status_detail: order.status_detail || '',
        payment_id: pay?.id || '', amount: Number(pay?.paid_amount || pay?.amount || row.amount),
        method: pay?.payment_method?.type || '',
      });
    }

    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    console.error(e);
    if (e instanceof MpError) return json({ error: e.message }, 502);
    return json({ error: (e as Error).message || 'Error inesperado' }, 500);
  }
});
