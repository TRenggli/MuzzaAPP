-- ============================================================================
-- Delivery en efectivo que cobra el repartidor
--
--   · Desde Vender, un delivery en efectivo puede quedar "a cobrar": el pedido
--     guarda collect = { method: 'efectivo', amount, tendered } (cuánto cobra,
--     con el descuento por efectivo si hay, y con cuánto paga el cliente).
--   · El panel del repartidor recibe ese dato para mostrar cuánto cobrar y el
--     vuelto que tiene que llevar. Mismo cuerpo que la versión en producción,
--     solo se agrega 'collect'.
-- ============================================================================

create or replace function public.reparto_active_orders(p_slug text, p_driver text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_branch uuid;
  v_res jsonb;
begin
  select id into v_branch from public.branches where slug = lower(trim(p_slug));
  if v_branch is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'number', coalesce((o.data ->> 'number')::int, 0),
      'customerName', coalesce(o.data ->> 'customerName', o.data ->> 'name', ''),
      'phone', coalesce(o.data ->> 'phone', ''),
      'address', coalesce(o.data ->> 'address', ''),
      'notes', coalesce(o.data ->> 'notes', ''),
      'status', o.status,
      'driver', coalesce(o.data ->> 'driver', ''),
      'total', coalesce(o.total, 0),
      'paid', coalesce(o.paid, false),
      'payment', coalesce(o.data ->> 'payment', 'efectivo'),
      'collect', case when jsonb_typeof(o.data -> 'collect') = 'object' then o.data -> 'collect' else null end,
      'items', coalesce(o.data -> 'items', '[]'::jsonb),
      'createdAt', o.created_at,
      'onlineOrderId', (select id from public.online_orders w where w.order_id = o.id limit 1)
    ) order by
      case when o.status = 'en_camino' then 1 when o.status = 'listo' then 2 else 3 end,
      o.created_at desc
  ), '[]'::jsonb)
  into v_res
  from public.orders o
  where o.branch_id = v_branch
    and not o.voided
    and o.status in ('listo', 'en_camino', 'horno', 'pendiente')
    and (o.data ->> 'type') = 'delivery'
    and (
      p_driver is null or trim(p_driver) = ''
      or lower(trim(coalesce(o.data ->> 'driver', ''))) = lower(trim(p_driver))
      or coalesce(o.data ->> 'driver', '') = ''
    );

  return v_res;
end $$;
