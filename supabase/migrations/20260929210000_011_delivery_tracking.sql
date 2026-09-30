-- ============================================================================
-- v11 · Seguimiento en tiempo real de repartidores (Delivery Tracking GPS)
-- ============================================================================

-- Tabla para almacenar la última posición geográfica reportada por el repartidor
create table if not exists public.delivery_locations (
  branch_id   uuid not null references public.branches(id) on delete cascade,
  order_id    text not null,
  driver      text not null,
  lat         double precision not null,
  lng         double precision not null,
  accuracy    double precision,
  heading     double precision,
  speed       double precision,
  updated_at  timestamptz not null default now(),
  primary key (branch_id, order_id)
);

create index if not exists delivery_locations_branch_idx on public.delivery_locations (branch_id, updated_at desc);

alter table public.delivery_locations enable row level security;

-- 1. Políticas RLS:
-- Usuarios autenticados de la sucursal (cajero, delivery, admin, owner) pueden ver las ubicaciones
drop policy if exists dl_select on public.delivery_locations;
create policy dl_select on public.delivery_locations for select to authenticated
  using (private.can_branch((select org_id from public.branches where id = branch_id), branch_id));

-- Inserción / actualización de ubicación por personal autorizado
drop policy if exists dl_upsert on public.delivery_locations;
create policy dl_upsert on public.delivery_locations for all to authenticated
  using (private.can_branch((select org_id from public.branches where id = branch_id), branch_id))
  with check (private.can_branch((select org_id from public.branches where id = branch_id), branch_id));

-- 2. Función para que el repartidor reporte su posición
create or replace function public.report_delivery_location(
  p_branch_id uuid,
  p_order_id text,
  p_driver text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision default null,
  p_heading double precision default null,
  p_speed double precision default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Coordenadas GPS inválidas';
  end if;

  insert into public.delivery_locations (
    branch_id, order_id, driver, lat, lng, accuracy, heading, speed, updated_at
  )
  values (
    p_branch_id, p_order_id, p_driver, p_lat, p_lng, p_accuracy, p_heading, p_speed, now()
  )
  on conflict (branch_id, order_id) do update set
    driver = excluded.driver,
    lat = excluded.lat,
    lng = excluded.lng,
    accuracy = excluded.accuracy,
    heading = excluded.heading,
    speed = excluded.speed,
    updated_at = now();

  return jsonb_build_object('ok', true, 'updatedAt', now());
end $$;

-- 3. Función para que el cliente consulte la ubicación del repartidor de su pedido
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

  -- Obtener última ubicación registrada
  select lat, lng, accuracy, heading, speed, updated_at, driver
  into v_loc
  from public.delivery_locations
  where branch_id = v_branch and (order_id = p_order_id or order_id = (select order_id from public.online_orders where id::text = p_order_id))
  order by updated_at desc
  limit 1;

  -- Obtener datos de la sucursal (dirección) para pintar en el mapa
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
grant execute on function public.report_delivery_location(uuid, text, text, double precision, double precision, double precision, double precision, double precision) to anon, authenticated;
grant execute on function public.carta_delivery_location(text) to anon, authenticated;

-- Agregar a publicación Realtime de Supabase
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'delivery_locations'
  ) then
    alter publication supabase_realtime add table public.delivery_locations;
  end if;
end $$;
