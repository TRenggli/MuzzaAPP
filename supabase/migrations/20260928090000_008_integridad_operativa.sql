-- v8 · Integridad de operaciones. Los documentos flexibles siguen sirviendo
-- para configuración, pero stock y aceptación web se resuelven en la base.

-- Una FK aislada no prueba que ambas referencias pertenezcan al mismo negocio.
create or replace function private.assert_branch_org()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.branch_id is not null and not exists (
    select 1 from branches b where b.id = new.branch_id and b.org_id = new.org_id
  ) then raise exception 'La sucursal no pertenece al negocio'; end if;
  return new;
end $$;

drop trigger if exists docs_branch_org_guard on docs;
create trigger docs_branch_org_guard before insert or update of org_id, branch_id on docs
for each row execute function private.assert_branch_org();
drop trigger if exists orders_branch_org_guard on orders;
create trigger orders_branch_org_guard before insert or update of org_id, branch_id on orders
for each row execute function private.assert_branch_org();

create or replace function private.role_can_write(p_org uuid, p_branch uuid, p_col text)
returns boolean language sql stable security definer set search_path = public as $$
  select case private.my_role(p_org)
    when 'owner' then private.can_branch(p_org, p_branch)
    when 'admin' then private.can_branch(p_org, p_branch)
    when 'cajero' then private.can_branch(p_org, p_branch)
      and p_col in ('customer', 'cash_session', 'cash_move', 'expense', 'audit', 'stock_move')
    else false end
$$;

-- Cada movimiento tiene una identidad estable. Solo los INSERT nuevos afectan
-- el saldo, por lo que un reintento nunca descuenta dos veces.
create or replace function private.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ingredient text := new.data ->> 'ingredientId'; v_delta numeric;
begin
  if new.col <> 'stock_move' then return new; end if;
  if v_ingredient is null or coalesce(new.data ->> 'delta', '') !~ '^-?[0-9]+(\.[0-9]+)?$' then
    raise exception 'Movimiento de stock inválido';
  end if;
  v_delta := (new.data ->> 'delta')::numeric;
  update docs set data = jsonb_set(data, '{stock}', to_jsonb(round((coalesce((data ->> 'stock')::numeric, 0) + v_delta)::numeric, 3)), true), updated_at = now()
   where org_id = new.org_id and col = 'ingredient' and branch_id = new.branch_id
     and id = new.branch_id::text || '/' || v_ingredient;
  if not found then raise exception 'Insumo inexistente para el movimiento'; end if;
  return new;
end $$;
drop trigger if exists stock_movement_apply on docs;
create trigger stock_movement_apply after insert on docs
for each row when (new.col = 'stock_move') execute function private.apply_stock_movement();

create or replace function private.consume_order_stock(p_org uuid, p_branch uuid, p_order text, p_items jsonb)
returns void language sql security definer set search_path = public as $$
  insert into docs (org_id, col, id, branch_id, data, updated_at)
  select p_org, 'stock_move', p_branch::text || '/sm-' || p_order || '-' || (it.item ->> 'id') || '-' || part.pid || '-' || (recipe.r ->> 'ingredientId'), p_branch,
    jsonb_build_object('operationId', 'sm-' || p_order || '-' || (it.item ->> 'id') || '-' || part.pid || '-' || (recipe.r ->> 'ingredientId'),
      'orderId', p_order, 'ingredientId', (recipe.r ->> 'ingredientId'),
      'delta', -round((recipe.r ->> 'qty')::numeric * (it.item ->> 'qty')::numeric
        * coalesce((variant.v ->> 'factor')::numeric, 1)
        * case when ing.data ->> 'unit' = 'u' and part.n > 1 then 0 when it.item ? 'half' and it.item -> 'half' is not null then .5 else 1 end, 3),
      'reason', 'consumo por pedido', 'at', floor(extract(epoch from clock_timestamp()) * 1000), 'userId', auth.uid()),
    now()
  from jsonb_array_elements(p_items) with ordinality it(item, item_n)
  cross join lateral jsonb_array_elements_text(case when it.item -> 'half' is not null then jsonb_build_array(it.item ->> 'productId', it.item -> 'half' ->> 'productId') else jsonb_build_array(it.item ->> 'productId') end) with ordinality part(pid, n)
  join docs prod on prod.org_id = p_org and prod.branch_id = p_branch and prod.col = 'product' and prod.id = p_branch::text || '/' || part.pid
  cross join lateral (select v from jsonb_array_elements(coalesce(prod.data -> 'variants', '[]'::jsonb)) v where (v ->> 'id') = (it.item ->> 'variantId') limit 1) variant
  cross join lateral jsonb_array_elements(coalesce(prod.data -> 'recipe', '[]'::jsonb)) recipe(r)
  join docs ing on ing.org_id = p_org and ing.branch_id = p_branch and ing.col = 'ingredient' and ing.id = p_branch::text || '/' || (recipe.r ->> 'ingredientId')
  on conflict (org_id, col, id) do nothing
$$;

-- La RPC es el único camino de escritura de documentos. Evita que una persona
-- de cocina o delivery use el REST API para editar caja, stock o catálogo.
create or replace function public.upsert_docs(p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb; v_org uuid; v_branch uuid; v_col text;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    v_org := (r ->> 'org_id')::uuid; v_branch := nullif(r ->> 'branch_id', '')::uuid; v_col := r ->> 'col';
    if v_branch is null or not private.role_can_write(v_org, v_branch, v_col) then raise exception 'Sin permiso para escribir %', v_col using errcode = '42501'; end if;
    insert into docs (org_id, col, id, branch_id, data, updated_at)
    values (v_org, v_col, r ->> 'id', v_branch, r -> 'data', now())
    on conflict (org_id, col, id) do update set data = docs.data || excluded.data, updated_at = now();
  end loop;
end $$;

create or replace function public.upsert_orders(p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb; v_org uuid; v_branch uuid; v_role text; v_keys text[];
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    v_org := (r ->> 'org_id')::uuid; v_branch := (r ->> 'branch_id')::uuid; v_role := private.my_role(v_org);
    if not private.can_branch(v_org, v_branch) then raise exception 'Sin permiso para esta sucursal' using errcode = '42501'; end if;
    if v_role in ('cocina', 'delivery') then
      select array_agg(k) into v_keys from jsonb_object_keys(r -> 'data') k;
      if exists (select 1 from unnest(coalesce(v_keys, '{}'::text[])) k where k not in ('status', 'statusTimes')) then
        raise exception 'Ese rol solo puede cambiar el estado del pedido' using errcode = '42501';
      end if;
    elsif v_role not in ('owner', 'admin', 'cajero') then
      raise exception 'Sin permiso para modificar pedidos' using errcode = '42501';
    end if;
    insert into orders (org_id, id, branch_id, data, updated_at) values (v_org, r ->> 'id', v_branch, r -> 'data', now())
    on conflict (org_id, id) do update set data = orders.data || excluded.data, updated_at = now();
  end loop;
end $$;

create or replace function public.delete_doc(p_org uuid, p_col text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if private.my_role(p_org) not in ('owner', 'admin') then raise exception 'Sin permiso para borrar' using errcode = '42501'; end if;
  delete from docs where org_id = p_org and col = p_col and id = p_id;
end $$;

create or replace function private.one_open_cash_session()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.col = 'cash_session' and coalesce(new.data ->> 'closedAt', '') in ('', 'null') and exists (
    select 1 from docs d where d.org_id = new.org_id and d.branch_id = new.branch_id and d.col = 'cash_session'
      and d.id <> new.id and coalesce(d.data ->> 'closedAt', '') in ('', 'null')
  ) then raise exception 'Ya hay una caja abierta para esta sucursal' using errcode = '23505'; end if;
  return new;
end $$;
drop trigger if exists docs_one_open_cash_session on docs;
create trigger docs_one_open_cash_session before insert or update of data on docs
for each row execute function private.one_open_cash_session();

revoke insert, update, delete on table public.docs, public.orders from authenticated;
revoke all on function public.delete_doc(uuid, text, text) from public, anon;
grant execute on function public.delete_doc(uuid, text, text) to authenticated;

create or replace function private.online_orders_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not private.is_org_admin(old.org_id) then raise exception 'Solo un encargado puede atender pedidos web' using errcode = '42501'; end if;
  if old.status <> 'nuevo' and new.status is distinct from old.status then raise exception 'Este pedido web ya fue %', old.status; end if;
  if new.status = 'aceptado' and current_setting('app.accepting_web', true) is distinct from 'true' then raise exception 'La aceptación debe crear la comanda en el servidor' using errcode = '42501'; end if;
  if new.status is distinct from old.status then new.handled_by := auth.uid(); new.handled_at := now(); end if;
  return new;
end $$;

drop policy if exists member_update on public.members;
create policy member_update on public.members for update to authenticated
  using (role <> 'owner' and (private.my_role(org_id) = 'owner' or
    (private.my_role(org_id) = 'admin' and branch_ids <@ coalesce((select m.branch_ids from public.members m where m.org_id = members.org_id and m.user_id = auth.uid()), '{}'::uuid[]))))
  with check (role <> 'owner' and (private.my_role(org_id) = 'owner' or
    (private.my_role(org_id) = 'admin' and branch_ids <@ coalesce((select m.branch_ids from public.members m where m.org_id = members.org_id and m.user_id = auth.uid()), '{}'::uuid[]))));

-- Aceptar un pedido público y crear su comanda ocurre bajo un único bloqueo.
-- p_order_id es la clave idempotente generada por el dispositivo.
create or replace function public.accept_online_order(p_id uuid, p_order_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w online_orders%rowtype; v_number bigint; v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000); v_order jsonb;
begin
  perform set_config('app.accepting_web', 'true', true);
  select * into w from online_orders where id = p_id for update;
  if not found then raise exception 'Pedido web inexistente'; end if;
  if not private.role_can_write(w.org_id, w.branch_id, 'order') then raise exception 'Sin permiso para aceptar pedidos' using errcode = '42501'; end if;
  if w.status = 'aceptado' then
    if w.order_id is null then raise exception 'Pedido web aceptado inconsistente'; end if;
    return (select data || jsonb_build_object('id', id) from orders where org_id = w.org_id and id = w.order_id);
  end if;
  if w.status <> 'nuevo' then raise exception 'Este pedido web ya fue %', w.status; end if;
  if exists (select 1 from orders where org_id = w.org_id and id = p_order_id) then
    update online_orders set status = 'aceptado', order_id = p_order_id, handled_by = auth.uid(), handled_at = now() where id = w.id;
    return (select data || jsonb_build_object('id', id) from orders where org_id = w.org_id and id = p_order_id);
  end if;
  insert into counters(branch_id, kind, value) values (w.branch_id, 'order', 1)
  on conflict (branch_id, kind) do update set value = counters.value + 1 returning value into v_number;
  v_order := jsonb_build_object(
    'id', p_order_id, 'number', v_number, 'ticketNumber', null, 'createdAt', v_now, 'paidAt', null,
    'userId', auth.uid(), 'type', case w.data ->> 'type' when 'mesa' then 'mesa' when 'delivery' then 'delivery' else 'retiro' end,
    'table', coalesce(w.data ->> 'table', ''), 'customerId', null, 'customerName', w.data ->> 'name', 'phone', w.phone,
    'address', coalesce(w.data ->> 'address', ''), 'zoneId', w.data ->> 'zoneId', 'items', w.data -> 'items',
    'discount', null, 'subtotal', coalesce((w.data ->> 'subtotal')::numeric, w.total), 'discountAmount', 0,
    'total', w.total, 'surcharge', 0, 'cashDiscount', 0, 'deliveryFee', coalesce((w.data ->> 'deliveryFee')::numeric, 0),
    'payments', '[]'::jsonb, 'paid', false, 'status', 'pendiente', 'statusTimes', jsonb_build_object('pendiente', v_now),
    'driver', '', 'cashSessionId', null, 'notes', 'Pedido web W-' || w.number, 'voided', false,
    'web', jsonb_build_object('id', w.id, 'number', w.number));
  insert into orders(org_id, id, branch_id, data) values (w.org_id, p_order_id, w.branch_id, v_order);
  perform private.consume_order_stock(w.org_id, w.branch_id, p_order_id, w.data -> 'items');
  update online_orders set status = 'aceptado', order_id = p_order_id, handled_by = auth.uid(), handled_at = now() where id = w.id;
  return v_order;
end $$;

revoke all on function public.accept_online_order(uuid, text) from public, anon;
grant execute on function public.accept_online_order(uuid, text) to authenticated;
