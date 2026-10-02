-- ============================================================================
-- v6 · Salón en vivo con mozos, cuentas de mesa compartidas y reglas de
-- mitad y mitad por pizza.
--
--   1. Nuevo rol "mozo": atiende mesas (abre, manda tandas, pide la cuenta,
--      marca servido). No cobra ni modifica montos.
--   2. La caja y los mozos pueden escribir las cuentas de mesa (antes solo el
--      encargado: si un cajero abría una mesa, la nube lo rechazaba y los
--      demás equipos nunca la veían).
--   3. La caja (cajero) puede aceptar pedidos de la carta online.
--   4. Mitad y mitad: cada pizza puede ser "solo entera" o combinarse solo con
--      algunas; la carta pública recibe la regla y el servidor la valida.
--   5. Fotos de productos: la carta pública recibe también el encuadre.
-- ============================================================================

-- 1. Rol mozo -----------------------------------------------------------------
alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('owner', 'admin', 'cajero', 'mozo', 'cocina', 'delivery'));
alter table public.invites drop constraint invites_role_check;
alter table public.invites add constraint invites_role_check
  check (role in ('admin', 'cajero', 'mozo', 'cocina', 'delivery'));

create or replace function public.create_invite(p_branch uuid, p_role text, p_days int default 7, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid;
  v_role  text;
  v_code  text;
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_pos   int[] := array[0, 1, 2, 3, 4, 5, 10, 11];
  i       int;
begin
  select org_id into v_org from branches where id = p_branch and active;
  if v_org is null then raise exception 'Sucursal inválida'; end if;
  v_role := private.my_role(v_org);
  if v_role is null or v_role not in ('owner', 'admin') or not private.can_branch(v_org, p_branch) then
    raise exception 'No tenés permiso para invitar en esta sucursal';
  end if;
  if p_role not in ('admin', 'cajero', 'mozo', 'cocina', 'delivery') then raise exception 'Rol inválido'; end if;
  if p_role = 'admin' and v_role <> 'owner' then raise exception 'Solo el dueño puede invitar encargados'; end if;
  loop
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := '';
    foreach i in array v_pos loop
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
    exit when not exists (select 1 from invites where code = v_code);
  end loop;
  insert into invites (code, org_id, branch_id, role, note, created_by, expires_at)
  values (v_code, v_org, p_branch, p_role, coalesce(p_note, ''), auth.uid(),
          now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30))));
  return v_code;
end $$;

-- 2. Quién escribe qué documentos ----------------------------------------------
create or replace function private.role_can_write(p_org uuid, p_branch uuid, p_col text)
returns boolean language sql stable security definer set search_path = public as $$
  select case private.my_role(p_org)
    when 'owner' then private.can_branch(p_org, p_branch)
    when 'admin' then private.can_branch(p_org, p_branch)
    when 'cajero' then private.can_branch(p_org, p_branch)
      and p_col in ('customer', 'cash_session', 'cash_move', 'expense', 'audit', 'stock_move', 'table_session', 'order')
    when 'mozo' then private.can_branch(p_org, p_branch)
      and p_col in ('table_session', 'audit', 'stock_move', 'customer')
    else false end
$$;

-- Pedidos: el mozo crea tandas SIN cobrar y después solo cambia el estado
-- (servido), la mesa o la cuenta a la que pertenecen. Nunca montos ni pagos.
create or replace function public.upsert_orders(p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb; v_org uuid; v_branch uuid; v_role text; v_keys text[];
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    v_org := (r ->> 'org_id')::uuid; v_branch := (r ->> 'branch_id')::uuid; v_role := private.my_role(v_org);
    if not private.can_branch(v_org, v_branch) then raise exception 'Sin permiso para esta sucursal' using errcode = '42501'; end if;
    select array_agg(k) into v_keys from jsonb_object_keys(r -> 'data') k;
    if v_role in ('cocina', 'delivery') then
      if exists (select 1 from unnest(coalesce(v_keys, '{}'::text[])) k where k not in ('status', 'statusTimes')) then
        raise exception 'Ese rol solo puede cambiar el estado del pedido' using errcode = '42501';
      end if;
    elsif v_role = 'mozo' then
      if exists (select 1 from orders where org_id = v_org and id = r ->> 'id') then
        if exists (select 1 from unnest(coalesce(v_keys, '{}'::text[])) k
                   where k not in ('status', 'statusTimes', 'table', 'tableSessionId', 'notes')) then
          raise exception 'El mozo solo puede cambiar el estado o la mesa del pedido' using errcode = '42501';
        end if;
      elsif coalesce((r -> 'data' ->> 'paid')::boolean, false)
            or jsonb_array_length(coalesce(r -> 'data' -> 'payments', '[]'::jsonb)) > 0
            or coalesce(r -> 'data' ->> 'type', '') <> 'mesa' then
        raise exception 'El mozo solo carga pedidos de mesa sin cobrar' using errcode = '42501';
      end if;
    elsif v_role not in ('owner', 'admin', 'cajero') then
      raise exception 'Sin permiso para modificar pedidos' using errcode = '42501';
    end if;

    -- UPDATE primero: el trigger ve el merge completo (old.data || patch)
    update orders set data = orders.data || (r -> 'data'), updated_at = now()
      where org_id = v_org and id = (r ->> 'id');
    if found then continue; end if;
    insert into orders (org_id, id, branch_id, data, updated_at)
      values (v_org, r ->> 'id', v_branch, r -> 'data', now());
  end loop;
end $$;

create or replace function private.dining_allowed(p_org uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.my_role(p_org) in ('owner', 'admin', 'cajero', 'mozo') and private.can_branch(p_org, p_branch)
$$;

-- 3. La caja también atiende los pedidos de la carta online ----------------------
create or replace function private.online_orders_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if coalesce(private.my_role(old.org_id), '') not in ('owner', 'admin', 'cajero') or not private.can_branch(old.org_id, old.branch_id) then
    raise exception 'Solo la caja o un encargado pueden atender pedidos web' using errcode = '42501';
  end if;
  if old.status <> 'nuevo' and new.status is distinct from old.status then raise exception 'Este pedido web ya fue %', old.status; end if;
  if new.status = 'aceptado' and current_setting('app.accepting_web', true) is distinct from 'true' then raise exception 'La aceptación debe crear la comanda en el servidor' using errcode = '42501'; end if;
  if new.status is distinct from old.status then new.handled_by := auth.uid(); new.handled_at := now(); end if;
  return new;
end $$;

-- 4. Mitad y mitad por pizza -----------------------------------------------------
-- La carta pública recibe la regla de cada pizza (solo entera / con cuáles)
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
                 'desc', coalesce(p.data ->> 'desc', ''), 'color', p.data ->> 'color', 'photo', p.data ->> 'photo',
                 'photoPos', p.data ->> 'photoPos', 'active', true,
                 'allowHalf', coalesce((p.data ->> 'allowHalf')::boolean, true),
                 'halfWith', case when jsonb_typeof(p.data -> 'halfWith') = 'array' then p.data -> 'halfWith' else null end,
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

-- ¿Se pueden combinar estas dos pizzas? (misma regla que la app: vale para las dos)
create or replace function private.half_pair_ok(p_a jsonb, p_a_id text, p_b jsonb, p_b_id text)
returns boolean language sql immutable set search_path = public as $$
  select p_a_id <> p_b_id
    and coalesce((p_a ->> 'allowHalf')::boolean, true)
    and coalesce((p_b ->> 'allowHalf')::boolean, true)
    and (jsonb_typeof(p_a -> 'halfWith') is distinct from 'array' or (p_a -> 'halfWith') ? p_b_id)
    and (jsonb_typeof(p_b -> 'halfWith') is distinct from 'array' or (p_b -> 'halfWith') ? p_a_id)
$$;

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

  if (select count(*) from online_orders where branch_id = b.id and created_at > now() - interval '1 minute') >= 15 then
    raise exception 'Estamos recibiendo muchos pedidos. Probá de nuevo en un minuto.';
  end if;
  if (select count(*) from online_orders where branch_id = b.id and phone = v_phone and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'Ya recibimos pedidos tuyos recién. Si querés cambiar algo, escribinos por WhatsApp.';
  end if;

  if v_type = 'delivery' then
    select z into v_zone from jsonb_array_elements(coalesce(st -> 'zones', '[]'::jsonb)) z where z ->> 'id' = p_order ->> 'zoneId';
    if v_zone is null and jsonb_array_length(coalesce(st -> 'zones', '[]'::jsonb)) > 0 then
      raise exception 'Elegí la zona de envío';
    end if;
    v_fee := greatest(0, coalesce((v_zone ->> 'fee')::numeric, 0));
  end if;

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

    -- Mitad y mitad: la categoría lo permite y las dos pizzas se aceptan entre sí
    hprod := null;
    if coalesce(it ->> 'halfId', '') <> '' then
      if not coalesce((cat ->> 'allowHalf')::boolean, false) or not coalesce((prod ->> 'allowHalf')::boolean, true) then
        raise exception '% se vende solo entera', prod ->> 'name';
      end if;
      select p.data into hprod from docs p
       where p.org_id = b.org_id and p.col = 'product' and p.id = v_prefix || (it ->> 'halfId')
         and coalesce((p.data ->> 'active')::boolean, true) and coalesce((p.data ->> 'online')::boolean, true)
         and exists (select 1 from docs c where c.org_id = b.org_id and c.col = 'category'
                       and c.id = v_prefix || coalesce(p.data ->> 'categoryId', '') and coalesce((c.data ->> 'allowHalf')::boolean, false));
      if hprod is null then raise exception 'La otra mitad elegida ya no está disponible'; end if;
      if not private.half_pair_ok(prod, it ->> 'productId', hprod, it ->> 'halfId') then
        raise exception '% no se puede combinar con %', prod ->> 'name', hprod ->> 'name';
      end if;
      select v into hvar from jsonb_array_elements(coalesce(hprod -> 'variants', '[]'::jsonb)) v where v ->> 'id' = var ->> 'id';
      if hvar is null then hvar := hprod -> 'variants' -> 0; end if;
      v_unit := case when coalesce(st ->> 'halfPricing', 'max') = 'avg'
                     then round((v_unit + coalesce((hvar ->> 'price')::numeric, 0)) / 2)
                     else greatest(v_unit, coalesce((hvar ->> 'price')::numeric, 0)) end;
    end if;

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

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke all on function public.carta_order(text, jsonb) from public;
grant execute on function public.carta_order(text, jsonb) to anon, authenticated;
revoke all on function public.create_invite(uuid, text, int, text) from public, anon;
grant execute on function public.create_invite(uuid, text, int, text) to authenticated;
revoke all on function public.upsert_orders(jsonb) from public, anon;
grant execute on function public.upsert_orders(jsonb) to authenticated;
