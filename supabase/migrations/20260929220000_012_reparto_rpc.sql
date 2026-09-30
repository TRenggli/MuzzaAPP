-- ============================================================================
-- v12 · RPCs para la app de Reparto (reparto.html) y tracking en tiempo real
-- ============================================================================

-- 1. Actualización de carta_order_status para incluir dirección y repartidor
create or replace function public.carta_order_status(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', w.id,
    'number', w.number,
    'status', w.status,
    'reason', w.reason,
    'createdAt', w.created_at,
    'type', w.data ->> 'type',
    'address', coalesce(w.data ->> 'address', o.data ->> 'address', ''),
    'driver', coalesce(o.data ->> 'driver', ''),
    'items', w.data -> 'items',
    'deliveryFee', w.data -> 'deliveryFee',
    'total', w.total,
    'orderId', coalesce(o.id, w.order_id, w.id::text),
    'orderNumber', o.data -> 'number',
    'orderStatus', case when o.voided then 'cancelado' else o.status end
  )
  from public.online_orders w
  left join public.orders o on o.org_id = w.org_id and o.id = w.order_id
  where w.id = p_id;
$$;

-- 2. Inicialización de la app de reparto (datos del negocio y lista de choferes)
create or replace function public.reparto_init(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_res jsonb;
begin
  select jsonb_build_object(
    'branch', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'org', o.name),
    'settings', jsonb_build_object(
      'business', jsonb_build_object('name', coalesce(b.settings #>> '{business,name}', b.name), 'city', coalesce(b.settings #>> '{business,city}', '')),
      'drivers', coalesce(b.settings -> 'drivers', '["Repartidor 1", "Repartidor 2"]'::jsonb)
    )
  )
  into v_res
  from public.branches b
  join public.organizations o on o.id = b.org_id
  where (b.slug = lower(trim(p_slug)) or (lower(trim(p_slug)) in ('diego', 'demo') and b.slug like '%andres%'))
    and b.active
  limit 1;

  return v_res;
end $$;

-- 3. Lista de pedidos activos asignados al repartidor o listos para entregar
create or replace function public.reparto_active_orders(p_slug text, p_driver text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_branch uuid;
  v_res jsonb;
begin
  select id into v_branch from public.branches
  where (slug = lower(trim(p_slug)) or (lower(trim(p_slug)) in ('diego', 'demo') and slug like '%andres%'))
    and active
  limit 1;

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

-- 4. Transición de estado por el repartidor (Salir a entregar / Ya lo entregué)
create or replace function public.reparto_update_status(
  p_slug text,
  p_order_id text,
  p_driver text,
  p_status text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_branch uuid;
  v_order record;
begin
  if p_status not in ('en_camino', 'entregado') then
    raise exception 'Estado de entrega inválido: %', p_status;
  end if;

  select id into v_branch from public.branches
  where (slug = lower(trim(p_slug)) or (lower(trim(p_slug)) in ('diego', 'demo') and slug like '%andres%'))
    and active
  limit 1;

  if v_branch is null then
    raise exception 'Sucursal no encontrada';
  end if;

  select * into v_order from public.orders
  where branch_id = v_branch and id = p_order_id for update;

  if v_order.id is null then
    -- Podría ser un id de online_orders
    select * into v_order from public.orders
    where branch_id = v_branch and id = (select order_id from public.online_orders where id::text = p_order_id)
    for update;
  end if;

  if v_order.id is not null then
    update public.orders set
      data = jsonb_set(
        jsonb_set(data, '{status}', to_jsonb(p_status)),
        '{driver}',
        to_jsonb(coalesce(nullif(trim(p_driver), ''), data ->> 'driver', ''))
      ),
      updated_at = now()
    where org_id = v_order.org_id and id = v_order.id;

    -- Si el pedido era de online_orders, sincronizamos
    update public.online_orders set
      status = case when p_status = 'entregado' then 'aceptado' else status end
    where order_id = v_order.id;
  end if;

  return jsonb_build_object('ok', true, 'status', p_status, 'orderId', coalesce(v_order.id, p_order_id));
end $$;

-- 5. Actualización de carta_delivery_location para resolver id bidireccional
create or replace function public.carta_delivery_location(p_order_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_loc record;
  v_status text;
  v_addr text;
  v_branch uuid;
  v_shop jsonb;
begin
  -- Buscar en online_orders por UUID o ID
  select w.branch_id, coalesce(w.data ->> 'address', ''),
         case when o.voided then 'cancelado' else coalesce(o.status, w.status) end
  into v_branch, v_addr, v_status
  from public.online_orders w
  left join public.orders o on o.org_id = w.org_id and o.id = w.order_id
  where w.id::text = p_order_id or w.order_id = p_order_id
  limit 1;

  -- Si no se encontró en online_orders, buscar en orders
  if v_branch is null then
    select o.branch_id, coalesce(o.data ->> 'address', ''),
           case when o.voided then 'cancelado' else o.status end
    into v_branch, v_addr, v_status
    from public.orders o
    where o.id = p_order_id
    limit 1;
  end if;

  if v_branch is null then
    return null;
  end if;

  -- Solo devolvemos la ubicación si el pedido está en camino
  if v_status <> 'en_camino' then
    return jsonb_build_object('status', v_status, 'inRoute', false);
  end if;

  -- Obtener última ubicación registrada (bidireccional)
  select lat, lng, accuracy, heading, speed, updated_at, driver
  into v_loc
  from public.delivery_locations
  where branch_id = v_branch
    and (
      order_id = p_order_id
      or order_id = (select order_id from public.online_orders where id::text = p_order_id)
      or order_id = (select id::text from public.online_orders where order_id = p_order_id)
    )
  order by updated_at desc
  limit 1;

  -- Obtener datos de la sucursal (dirección) para el mapa
  select jsonb_build_object('name', b.name, 'address', b.settings #>> '{business,address}', 'city', b.settings #>> '{business,city}')
  into v_shop
  from public.branches b where b.id = v_branch;

  return jsonb_build_object(
    'status', v_status,
    'inRoute', true,
    'destinationAddress', v_addr,
    'shop', v_shop,
    'driver', v_loc.driver,
    'lat', v_loc.lat,
    'lng', v_loc.lng,
    'accuracy', v_loc.accuracy,
    'heading', v_loc.heading,
    'speed', v_loc.speed,
    'updatedAt', v_loc.updated_at
  );
end $$;

-- Permisos
grant execute on function public.carta_order_status(uuid) to anon, authenticated;
grant execute on function public.reparto_init(text) to anon, authenticated;
grant execute on function public.reparto_active_orders(text, text) to anon, authenticated;
grant execute on function public.reparto_update_status(text, text, text, text) to anon, authenticated;
grant execute on function public.carta_delivery_location(text) to anon, authenticated;
