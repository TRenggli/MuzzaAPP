-- ============================================================================
-- Repartidores con usuario y contraseña (cierra el agujero del panel de reparto)
--
-- Antes, reparto_active_orders / reparto_update_status / report_delivery_location
-- se podían llamar SIN sesión con solo el slug de la sucursal (que es público en
-- el link de la carta): cualquiera veía nombre, teléfono y dirección de los
-- deliveries activos y los podía marcar como entregados.
--
-- Ahora el repartidor es un empleado con rol "delivery" que entra con su usuario.
-- Estas funciones exigen sesión y validan el rol y la sucursal en el servidor.
-- Las funciones viejas se eliminan en la migración siguiente, DESPUÉS de publicar
-- el cliente nuevo (para que los equipos que todavía tienen la versión vieja no
-- se queden sin panel de golpe).
-- ============================================================================

-- Quién llama, en qué negocio y con qué nombre. Falla si no tiene permiso.
create or replace function private.reparto_ctx(p_branch uuid)
returns table (org uuid, role text, uname text)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_role text; v_name text;
begin
  if auth.uid() is null then
    raise exception 'Necesitás iniciar sesión' using errcode = '42501';
  end if;
  select b.org_id into v_org from branches b where b.id = p_branch and b.active;
  if v_org is null or not private.can_branch(v_org, p_branch) then
    raise exception 'Sin permiso para esta sucursal' using errcode = '42501';
  end if;
  v_role := private.my_role(v_org);
  if v_role is null or v_role not in ('owner', 'admin', 'cajero', 'delivery') then
    raise exception 'Tu rol no usa el reparto' using errcode = '42501';
  end if;
  select m.name into v_name from members m where m.org_id = v_org and m.user_id = auth.uid();
  return query select v_org, v_role, coalesce(v_name, '');
end $$;

-- ¿Este pedido es de este repartidor? Asignado a él, sin asignar, o (pedidos
-- viejos, antes de driverId) con su nombre como repartidor.
create or replace function private.reparto_mine(p_data jsonb, p_uid uuid, p_name text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(
    (p_data ->> 'driverId') = p_uid::text
    or (
      coalesce(p_data ->> 'driverId', '') = ''
      and (
        coalesce(trim(p_data ->> 'driver'), '') = ''
        or lower(trim(p_data ->> 'driver')) = lower(trim(p_name))
      )
    ),
    false)
$$;

-- Deliveries activos de la sucursal. Rol delivery: los suyos y los sin asignar.
-- Dueño, encargado y cajero: todos.
create or replace function public.reparto_orders(p_branch uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from private.reparto_ctx(p_branch);
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'number', coalesce((o.data ->> 'number')::int, 0),
        'customerName', coalesce(o.data ->> 'customerName', o.data ->> 'name', ''),
        'phone', coalesce(o.data ->> 'phone', ''),
        'address', coalesce(o.data ->> 'address', ''),
        'notes', coalesce(o.data ->> 'notes', ''),
        'status', o.status,
        'driver', coalesce(o.data ->> 'driver', ''),
        'driverId', coalesce(o.data ->> 'driverId', ''),
        'total', coalesce(o.total, 0),
        'paid', coalesce(o.paid, false),
        'payment', coalesce(o.data ->> 'payment', 'efectivo'),
        'collect', case when jsonb_typeof(o.data -> 'collect') = 'object' then o.data -> 'collect' else null end,
        'items', coalesce(o.data -> 'items', '[]'::jsonb),
        'createdAt', o.created_at,
        'onlineOrderId', (select w.id from online_orders w where w.order_id = o.id limit 1)
      ) order by
        case when o.status = 'en_camino' then 1 when o.status = 'listo' then 2 else 3 end,
        o.created_at desc
    )
    from orders o
    where o.branch_id = p_branch
      and not o.voided
      and o.status in ('pendiente', 'horno', 'listo', 'en_camino')
      and (o.data ->> 'type') = 'delivery'
      and (c.role <> 'delivery' or private.reparto_mine(o.data, auth.uid(), c.uname))
  ), '[]'::jsonb);
end $$;

-- "Salir a entregar" / "Ya lo entregué". El repartidor solo toca los suyos o los
-- sin asignar (si estaba sin asignar, se lo asigna).
create or replace function public.reparto_status(p_branch uuid, p_order_id text, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c       record;
  v_order orders%rowtype;
  v_now   bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_patch jsonb;
begin
  if p_status not in ('en_camino', 'entregado') then
    raise exception 'Estado de entrega inválido: %', p_status using errcode = '22023';
  end if;
  select * into c from private.reparto_ctx(p_branch);

  select * into v_order from orders where branch_id = p_branch and id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;
  if coalesce(v_order.data ->> 'type', '') <> 'delivery' then
    raise exception 'Ese pedido no es un delivery' using errcode = '22023';
  end if;
  if c.role = 'delivery' and not private.reparto_mine(v_order.data, auth.uid(), c.uname) then
    raise exception 'Ese pedido está asignado a otro repartidor' using errcode = '42501';
  end if;
  -- doble toque: ya está en ese estado
  if v_order.status = p_status then
    return jsonb_build_object('ok', true, 'status', p_status, 'orderId', v_order.id);
  end if;
  if v_order.voided or v_order.status not in ('pendiente', 'horno', 'listo', 'en_camino') then
    raise exception 'El pedido ya no está activo' using errcode = 'P0002';
  end if;

  v_patch := jsonb_build_object(
    'status', p_status,
    'statusTimes', coalesce(v_order.data -> 'statusTimes', '{}'::jsonb) || jsonb_build_object(p_status, v_now)
  );
  if c.role = 'delivery' then
    v_patch := v_patch || jsonb_build_object('driverId', auth.uid()::text, 'driver', c.uname);
  end if;

  update orders set data = data || v_patch, updated_at = now()
   where org_id = v_order.org_id and id = v_order.id;

  update online_orders set status = case when p_status = 'entregado' then 'aceptado' else status end
   where order_id = v_order.id;

  return jsonb_build_object('ok', true, 'status', p_status, 'orderId', v_order.id);
end $$;

-- Posición del repartidor (la ve el cliente en el seguimiento del pedido).
-- Firma nueva: sin p_driver (el nombre sale de la sesión). La vieja se elimina después.
create or replace function public.report_delivery_location(
  p_branch_id uuid,
  p_order_id text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision default null,
  p_heading double precision default null,
  p_speed double precision default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; v_order orders%rowtype;
begin
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Coordenadas GPS inválidas' using errcode = '22023';
  end if;
  select * into c from private.reparto_ctx(p_branch_id);

  select * into v_order from orders where branch_id = p_branch_id and id = p_order_id;
  if not found or coalesce(v_order.data ->> 'type', '') <> 'delivery' or v_order.voided
     or v_order.status not in ('pendiente', 'horno', 'listo', 'en_camino') then
    raise exception 'Ese pedido no está en reparto' using errcode = 'P0002';
  end if;
  if c.role = 'delivery' and not private.reparto_mine(v_order.data, auth.uid(), c.uname) then
    raise exception 'Ese pedido está asignado a otro repartidor' using errcode = '42501';
  end if;

  insert into delivery_locations (branch_id, order_id, driver, lat, lng, accuracy, heading, speed, updated_at)
  values (p_branch_id, p_order_id, coalesce(nullif(c.uname, ''), 'Repartidor'), p_lat, p_lng, p_accuracy, p_heading, p_speed, now())
  on conflict (branch_id, order_id) do update set
    driver = excluded.driver, lat = excluded.lat, lng = excluded.lng,
    accuracy = excluded.accuracy, heading = excluded.heading, speed = excluded.speed, updated_at = now();

  return jsonb_build_object('ok', true, 'updatedAt', now());
end $$;

-- Solo con sesión
revoke all on function public.reparto_orders(uuid) from public, anon;
revoke all on function public.reparto_status(uuid, text, text) from public, anon;
revoke all on function public.report_delivery_location(uuid, text, double precision, double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.reparto_orders(uuid) to authenticated;
grant execute on function public.reparto_status(uuid, text, text) to authenticated;
grant execute on function public.report_delivery_location(uuid, text, double precision, double precision, double precision, double precision, double precision) to authenticated;

-- La ubicación solo se escribe por report_delivery_location (que valida todo):
-- se quita la escritura directa a la tabla. La lectura sigue para el personal.
drop policy if exists dl_upsert on public.delivery_locations;
