-- ============================================================================
-- v5 · Carta online
--
--   1. Cada sucursal puede tener una dirección pública (carta.html?l=<slug>).
--   2. carta_menu: la carta que ven los clientes, sin costos ni recetas.
--   3. carta_order: el cliente hace el pedido; el SERVIDOR calcula los
--      precios con el menú actual (no se confía en lo que manda el teléfono).
--   4. online_orders: pedidos web que el local acepta o rechaza.
--   5. carta_order_status: seguimiento del pedido para el cliente.
--   6. Bucket "menu" para fotos de productos, logo y portada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Dirección pública
-- ---------------------------------------------------------------------------
alter table public.branches add column slug text;
alter table public.branches add constraint branches_slug_chk
  check (slug is null or slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$');
create unique index branches_slug_idx on public.branches (slug) where slug is not null;

-- ---------------------------------------------------------------------------
-- Horario: ¿está tomando pedidos? (hora de Argentina)
-- ---------------------------------------------------------------------------
create or replace function private.carta_open(p_online jsonb, p_now timestamptz default now())
returns boolean language plpgsql stable set search_path = public as $$
declare
  h     jsonb := coalesce(p_online -> 'hours', '{}'::jsonb);
  loc   timestamp := p_now at time zone 'America/Argentina/Buenos_Aires';
  t     time := loc::time;
  dow   int := extract(dow from loc)::int;          -- 0 = domingo
  yday  int := (extract(dow from loc)::int + 6) % 7;
  days  jsonb := coalesce(h -> 'days', '[0,1,2,3,4,5,6]'::jsonb);
  f     time;
  e     time;
begin
  if coalesce((p_online ->> 'paused')::boolean, false) then return false; end if;
  if coalesce(h ->> 'mode', 'always') <> 'schedule' then return true; end if;
  begin
    f := (h ->> 'from')::time;
    e := (h ->> 'to')::time;
  exception when others then
    return true;  -- horario mal cargado: no bloquear las ventas
  end;
  if f is null or e is null then return true; end if;
  if f <= e then
    return days @> to_jsonb(dow) and t >= f and t < e;
  end if;
  -- cruza la medianoche (ej: 19:00 a 01:00)
  return (days @> to_jsonb(dow) and t >= f) or (days @> to_jsonb(yday) and t < e);
end $$;

-- ---------------------------------------------------------------------------
-- 2. La carta pública de una sucursal (sin costos, recetas ni datos internos)
-- ---------------------------------------------------------------------------
create or replace function private.carta_data(p_branch uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with b as (
    select br.id, br.org_id, br.name, br.slug, br.settings, o.name as org_name, o.features
    from branches br join organizations o on o.id = br.org_id
    where br.id = p_branch
  ),
  d as (
    select x.col, substring(x.id from position('/' in x.id) + 1) as lid, x.data
    from docs x join b on x.org_id = b.org_id and x.branch_id = b.id
    where x.col in ('category', 'product', 'extra')
  ),
  prods as (
    select * from d
    where col = 'product'
      and coalesce((data ->> 'active')::boolean, true)
      and coalesce((data ->> 'online')::boolean, true)
  )
  select jsonb_build_object(
    'branch', (select jsonb_build_object('id', id, 'name', name, 'slug', slug, 'org', org_name) from b),
    'settings', (select jsonb_build_object(
        'business', jsonb_build_object(
            'name', settings #>> '{business,name}', 'slogan', settings #>> '{business,slogan}',
            'address', settings #>> '{business,address}', 'city', settings #>> '{business,city}',
            'phone', settings #>> '{business,phone}', 'instagram', settings #>> '{business,instagram}'),
        'online', coalesce(settings -> 'online', '{}'::jsonb),
        'halfPricing', coalesce(settings ->> 'halfPricing', 'max'),
        'zones', case when features ->> 'delivery' = 'false' then '[]'::jsonb
                      else coalesce((select jsonb_agg(jsonb_build_object('id', z ->> 'id', 'name', z ->> 'name', 'fee', coalesce((z ->> 'fee')::numeric, 0)))
                                     from jsonb_array_elements(coalesce(settings -> 'zones', '[]'::jsonb)) z), '[]'::jsonb) end,
        'transfer', case when coalesce((settings #>> '{online,payments,transferencia}')::boolean, false)
                         then jsonb_build_object('alias', settings #>> '{payments,alias}', 'cbu', settings #>> '{payments,cbu}',
                                                 'holder', settings #>> '{payments,holder}', 'bank', settings #>> '{payments,bank}')
                         else null end,
        'logo', coalesce(nullif(settings #>> '{online,logo}', ''),
                         case when coalesce((settings #>> '{ticket,showLogo}')::boolean, true) then settings #>> '{ticket,logo}' end)
      ) from b),
    'open', (select private.carta_open(coalesce(settings -> 'online', '{}'::jsonb)) from b),
    'categories', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.lid, 'name', c.data ->> 'name', 'icon', coalesce(c.data ->> 'icon', '🍽️'),
                                            'allowHalf', coalesce((c.data ->> 'allowHalf')::boolean, false))
                         order by coalesce((c.data ->> '_i')::int, 100000))
        from d c where c.col = 'category' and exists (select 1 from prods p where p.data ->> 'categoryId' = c.lid)), '[]'::jsonb),
    'products', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', p.lid, 'categoryId', p.data ->> 'categoryId', 'name', p.data ->> 'name',
                 'desc', coalesce(p.data ->> 'desc', ''), 'color', p.data ->> 'color', 'photo', p.data ->> 'photo', 'active', true,
                 'variants', (select coalesce(jsonb_agg(jsonb_build_object('id', v ->> 'id', 'name', v ->> 'name', 'price', coalesce((v ->> 'price')::numeric, 0))), '[]'::jsonb)
                              from jsonb_array_elements(coalesce(p.data -> 'variants', '[]'::jsonb)) v))
                 order by coalesce((p.data ->> '_i')::int, 100000))
        from prods p where jsonb_array_length(coalesce(p.data -> 'variants', '[]'::jsonb)) > 0), '[]'::jsonb),
    'extras', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.lid, 'name', x.data ->> 'name', 'price', coalesce((x.data ->> 'price')::numeric, 0))
                         order by coalesce((x.data ->> '_i')::int, 100000))
        from d x where x.col = 'extra'), '[]'::jsonb)
  )
$$;

/** Sucursal publicada (dirección válida, negocio activo, módulo y carta activos) */
create or replace function private.carta_branch(p_slug text)
returns uuid language sql stable security definer set search_path = public as $$
  select br.id from branches br join organizations o on o.id = br.org_id
  where br.slug = lower(p_slug) and br.active and o.status = 'active'
    and coalesce(o.features ->> 'carta', 'true') <> 'false'
    and coalesce((br.settings #>> '{online,enabled}')::boolean, false)
$$;

create or replace function public.carta_menu(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_branch uuid := private.carta_branch(p_slug);
begin
  if v_branch is null then return null; end if;
  return private.carta_data(v_branch);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Pedidos web
-- ---------------------------------------------------------------------------
create table public.online_orders (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  number      bigint not null,
  status      text not null default 'nuevo' check (status in ('nuevo', 'aceptado', 'rechazado')),
  data        jsonb not null,
  total       numeric not null,
  phone       text not null,
  order_id    text,
  reason      text not null default '',
  handled_by  uuid,
  handled_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index online_orders_branch_idx on public.online_orders (branch_id, created_at desc);
create index online_orders_phone_idx on public.online_orders (branch_id, phone, created_at desc);
alter table public.online_orders enable row level security;

create policy oo_select on public.online_orders for select to authenticated
  using (private.can_branch(org_id, branch_id));
create policy oo_update on public.online_orders for update to authenticated
  using (private.can_branch(org_id, branch_id)) with check (private.can_branch(org_id, branch_id));

-- Solo se crean con carta_order; el local solo cambia el estado
revoke all on public.online_orders from anon, authenticated;
grant select on public.online_orders to authenticated;
grant update (status, order_id, reason) on public.online_orders to authenticated;

create or replace function private.online_orders_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if old.status <> 'nuevo' and new.status is distinct from old.status then
    raise exception 'Este pedido web ya fue %', old.status;
  end if;
  if new.status = 'aceptado' and coalesce(new.order_id, '') = '' then
    raise exception 'Falta el pedido del local asociado';
  end if;
  if new.status is distinct from old.status then
    new.handled_by := auth.uid();
    new.handled_at := now();
  end if;
  return new;
end $$;
create trigger online_orders_guard before update on public.online_orders
  for each row execute function private.online_orders_guard();

-- ---------------------------------------------------------------------------
-- 3. El cliente hace el pedido (precios calculados acá, con el menú actual)
-- ---------------------------------------------------------------------------
create or replace function public.carta_order(p_slug text, p_order jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_branch  uuid := private.carta_branch(p_slug);
  b         record;
  st        jsonb;
  onl       jsonb;
  v_type    text := coalesce(p_order ->> 'type', 'retiro');
  v_name    text := left(btrim(coalesce(p_order ->> 'name', '')), 80);
  v_phone   text := left(regexp_replace(coalesce(p_order ->> 'phone', ''), '\D', '', 'g'), 20);
  v_addr    text := left(btrim(coalesce(p_order ->> 'address', '')), 200);
  v_table   text := left(btrim(coalesce(p_order ->> 'table', '')), 10);
  v_notes   text := left(btrim(coalesce(p_order ->> 'notes', '')), 300);
  v_pay     text := coalesce(p_order ->> 'payment', 'efectivo');
  v_cash    numeric := case when coalesce(p_order ->> 'cashWith', '') ~ '^\d{1,9}$' then (p_order ->> 'cashWith')::numeric else 0 end;
  v_zone    jsonb;
  v_fee     numeric := 0;
  it        jsonb;
  prod      jsonb;
  cat       jsonb;
  var       jsonb;
  hprod     jsonb;
  hvar      jsonb;
  x         jsonb;
  v_ext     jsonb;
  v_items   jsonb := '[]'::jsonb;
  v_sub     numeric := 0;
  v_unit    numeric;
  v_qty     int;
  v_prefix  text;
  v_num     bigint;
  v_id      uuid;
begin
  if v_branch is null then raise exception 'Esta carta no está disponible'; end if;
  select br.id, br.org_id, br.settings, o.features into b
    from branches br join organizations o on o.id = br.org_id where br.id = v_branch;
  st := b.settings;
  onl := coalesce(st -> 'online', '{}'::jsonb);
  v_prefix := b.id::text || '/';
  if not private.carta_open(onl) then raise exception 'El local no está tomando pedidos en este momento'; end if;

  -- Datos del cliente
  if length(v_name) < 2 then raise exception 'Falta tu nombre'; end if;
  if length(v_phone) < 8 then raise exception 'Revisá tu teléfono (con característica)'; end if;
  if v_type not in ('retiro', 'delivery', 'mesa') or not coalesce((onl #>> array['types', v_type])::boolean, v_type = 'retiro')
     or (v_type = 'delivery' and b.features ->> 'delivery' = 'false')
     or (v_type = 'mesa' and b.features ->> 'mesas' = 'false') then
    raise exception 'Ese tipo de pedido no está disponible';
  end if;
  if v_type = 'delivery' and length(v_addr) < 5 then raise exception 'Falta la dirección de entrega'; end if;
  if v_type = 'mesa' and v_table = '' then raise exception 'Falta el número de mesa'; end if;
  if v_pay not in ('efectivo', 'transferencia', 'tarjeta') or not coalesce((onl #>> array['payments', v_pay])::boolean, v_pay = 'efectivo') then
    raise exception 'Ese medio de pago no está disponible';
  end if;

  -- Límites contra pedidos falsos o repetidos
  if (select count(*) from online_orders where branch_id = b.id and created_at > now() - interval '1 minute') >= 15 then
    raise exception 'Estamos recibiendo muchos pedidos. Probá de nuevo en un minuto.';
  end if;
  if (select count(*) from online_orders where branch_id = b.id and phone = v_phone and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'Ya recibimos pedidos tuyos recién. Si querés cambiar algo, escribinos por WhatsApp.';
  end if;

  -- Envío
  if v_type = 'delivery' then
    select z into v_zone from jsonb_array_elements(coalesce(st -> 'zones', '[]'::jsonb)) z where z ->> 'id' = p_order ->> 'zoneId';
    if v_zone is null and jsonb_array_length(coalesce(st -> 'zones', '[]'::jsonb)) > 0 then
      raise exception 'Elegí la zona de envío';
    end if;
    v_fee := greatest(0, coalesce((v_zone ->> 'fee')::numeric, 0));
  end if;

  -- Productos
  if jsonb_typeof(p_order -> 'items') is distinct from 'array' or jsonb_array_length(p_order -> 'items') = 0 then
    raise exception 'El pedido está vacío';
  end if;
  if jsonb_array_length(p_order -> 'items') > 40 then raise exception 'Son demasiados productos para un pedido'; end if;

  for it in select * from jsonb_array_elements(p_order -> 'items') loop
    v_qty := case when coalesce(it ->> 'qty', '') ~ '^\d{1,2}$' then (it ->> 'qty')::int else 0 end;
    if v_qty < 1 or v_qty > 50 then raise exception 'Cantidad inválida'; end if;

    select data into prod from docs
     where org_id = b.org_id and col = 'product' and id = v_prefix || coalesce(it ->> 'productId', '')
       and coalesce((data ->> 'active')::boolean, true) and coalesce((data ->> 'online')::boolean, true);
    if prod is null then raise exception 'Un producto de tu pedido ya no está disponible. Actualizá la carta.'; end if;
    select data into cat from docs where org_id = b.org_id and col = 'category' and id = v_prefix || coalesce(prod ->> 'categoryId', '');

    select v into var from jsonb_array_elements(coalesce(prod -> 'variants', '[]'::jsonb)) v
     where v ->> 'id' = coalesce(nullif(it ->> 'variantId', ''), prod #>> '{variants,0,id}');
    if var is null then raise exception 'El tamaño elegido de % ya no está disponible', prod ->> 'name'; end if;
    v_unit := coalesce((var ->> 'price')::numeric, 0);

    -- Mitad y mitad (como en el mostrador: la más cara o el promedio)
    hprod := null;
    if coalesce(it ->> 'halfId', '') <> '' then
      if not coalesce((cat ->> 'allowHalf')::boolean, false) then raise exception '% no se puede pedir por mitades', prod ->> 'name'; end if;
      select p.data into hprod from docs p
       where p.org_id = b.org_id and p.col = 'product' and p.id = v_prefix || (it ->> 'halfId')
         and coalesce((p.data ->> 'active')::boolean, true) and coalesce((p.data ->> 'online')::boolean, true)
         and exists (select 1 from docs c where c.org_id = b.org_id and c.col = 'category'
                       and c.id = v_prefix || coalesce(p.data ->> 'categoryId', '') and coalesce((c.data ->> 'allowHalf')::boolean, false));
      if hprod is null then raise exception 'La otra mitad elegida ya no está disponible'; end if;
      select v into hvar from jsonb_array_elements(coalesce(hprod -> 'variants', '[]'::jsonb)) v where v ->> 'id' = var ->> 'id';
      if hvar is null then hvar := hprod -> 'variants' -> 0; end if;
      v_unit := case when coalesce(st ->> 'halfPricing', 'max') = 'avg'
                     then round((v_unit + coalesce((hvar ->> 'price')::numeric, 0)) / 2)
                     else greatest(v_unit, coalesce((hvar ->> 'price')::numeric, 0)) end;
    end if;

    -- Agregados (solo en categorías con mitad y mitad, igual que el mostrador)
    v_ext := '[]'::jsonb;
    if jsonb_typeof(it -> 'extras') = 'array' and jsonb_array_length(it -> 'extras') > 0 then
      if not coalesce((cat ->> 'allowHalf')::boolean, false) then raise exception '% no lleva agregados', prod ->> 'name'; end if;
      if jsonb_array_length(it -> 'extras') > 10 then raise exception 'Demasiados agregados'; end if;
      for x in select jsonb_build_object('id', substring(e.id from position('/' in e.id) + 1), 'name', e.data ->> 'name',
                                         'price', coalesce((e.data ->> 'price')::numeric, 0))
                 from docs e
                where e.org_id = b.org_id and e.col = 'extra' and e.branch_id = b.id
                  and substring(e.id from position('/' in e.id) + 1) in (select jsonb_array_elements_text(it -> 'extras'))
      loop
        v_ext := v_ext || jsonb_build_array(x);
        v_unit := v_unit + (x ->> 'price')::numeric;
      end loop;
      if jsonb_array_length(v_ext) <> (select count(distinct e) from jsonb_array_elements_text(it -> 'extras') e) then
        raise exception 'Un agregado de tu pedido ya no está disponible';
      end if;
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'id', 'it-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      'productId', it ->> 'productId',
      'variantId', var ->> 'id',
      'variantName', case when jsonb_array_length(prod -> 'variants') > 1 then var ->> 'name' else '' end,
      'half', case when hprod is null then null else jsonb_build_object('productId', it ->> 'halfId', 'name', hprod ->> 'name') end,
      'name', case when hprod is null then prod ->> 'name' else '½ ' || (prod ->> 'name') || ' + ½ ' || (hprod ->> 'name') end,
      'extras', v_ext,
      'qty', v_qty,
      'unitPrice', v_unit,
      'total', v_unit * v_qty,
      'notes', left(btrim(coalesce(it ->> 'notes', '')), 140)));
    v_sub := v_sub + v_unit * v_qty;
  end loop;

  if v_sub < coalesce(nullif(onl ->> 'minOrder', '')::numeric, 0) then
    raise exception 'El pedido mínimo es de $%', replace(to_char(coalesce(nullif(onl ->> 'minOrder', '')::numeric, 0), 'FM999,999,999'), ',', '.');
  end if;

  insert into counters (branch_id, kind, value) values (b.id, 'web', 1)
  on conflict (branch_id, kind) do update set value = counters.value + 1
  returning value into v_num;

  insert into online_orders (org_id, branch_id, number, data, total, phone)
  values (b.org_id, b.id, v_num, jsonb_build_object(
      'type', v_type, 'name', v_name, 'phone', v_phone,
      'address', case when v_type = 'delivery' then v_addr else '' end,
      'zoneId', v_zone ->> 'id', 'zoneName', v_zone ->> 'name',
      'table', case when v_type = 'mesa' then v_table else '' end,
      'payment', v_pay, 'cashWith', case when v_pay = 'efectivo' and v_cash > 0 then v_cash end,
      'notes', v_notes, 'items', v_items,
      'subtotal', v_sub, 'deliveryFee', v_fee, 'total', v_sub + v_fee),
    v_sub + v_fee, v_phone)
  returning id into v_id;

  return (select jsonb_build_object('id', id, 'number', number, 'createdAt', created_at) || data from online_orders where id = v_id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Seguimiento para el cliente (con el id secreto que recibió)
-- ---------------------------------------------------------------------------
create or replace function public.carta_order_status(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', w.id, 'number', w.number, 'status', w.status, 'reason', w.reason, 'createdAt', w.created_at,
    'type', w.data ->> 'type', 'items', w.data -> 'items', 'deliveryFee', w.data -> 'deliveryFee', 'total', w.total,
    'orderNumber', o.data -> 'number',
    'orderStatus', case when o.voided then 'cancelado' else o.status end)
  from online_orders w
  left join orders o on o.org_id = w.org_id and o.id = w.order_id
  where w.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- 6. Fotos del menú (público para ver; solo encargados de la sucursal suben)
--    Ruta: <negocio>/<sucursal>/<archivo>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu', 'menu', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function private.can_edit_menu_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  f text[] := storage.foldername(p_name);
begin
  if coalesce(array_length(f, 1), 0) < 2
     or f[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or f[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.is_org_admin(f[1]::uuid) and private.can_branch(f[1]::uuid, f[2]::uuid);
end $$;

create policy menu_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'menu' and private.can_edit_menu_path(name));
create policy menu_update on storage.objects for update to authenticated
  using (bucket_id = 'menu' and private.can_edit_menu_path(name));
create policy menu_delete on storage.objects for delete to authenticated
  using (bucket_id = 'menu' and private.can_edit_menu_path(name));
create policy menu_select on storage.objects for select to authenticated
  using (bucket_id = 'menu' and private.can_edit_menu_path(name));

-- ---------------------------------------------------------------------------
-- Permisos y tiempo real
-- ---------------------------------------------------------------------------
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

revoke all on function public.carta_menu(text) from public;
revoke all on function public.carta_order(text, jsonb) from public;
revoke all on function public.carta_order_status(uuid) from public;
grant execute on function public.carta_menu(text) to anon, authenticated;
grant execute on function public.carta_order(text, jsonb) to anon, authenticated;
grant execute on function public.carta_order_status(uuid) to anon, authenticated;

alter publication supabase_realtime add table public.online_orders;
