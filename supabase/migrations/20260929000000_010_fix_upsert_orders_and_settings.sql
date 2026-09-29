-- ============================================================================
-- Migración 010: Fix upsert_orders y orders_guard, borrado de sucursales,
-- y soporte de ETA configurable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix: upsert_orders → UPDATE first, INSERT if not found
-- ---------------------------------------------------------------------------
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

    -- Intentar UPDATE primero: el trigger BEFORE UPDATE ve NEW.data con el
    -- merge completo (old.data || patch), así items/subtotal/total siguen ahí.
    update orders set data = orders.data || (r -> 'data'), updated_at = now()
      where org_id = v_org and id = (r ->> 'id');
    if found then continue; end if;

    -- Si no existe, INSERT: el trigger BEFORE INSERT ve la data completa
    insert into orders (org_id, id, branch_id, data, updated_at)
      values (v_org, r ->> 'id', v_branch, r -> 'data', now());
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Fix: orders_guard → no validar items/totales si en un UPDATE no cambiaron
-- ---------------------------------------------------------------------------
create or replace function private.orders_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  o         jsonb := case when tg_op = 'UPDATE' then old.data else null end;
  n         jsonb := new.data;
  locked    text[] := array['items', 'subtotal', 'total', 'payments', 'discount', 'discountAmount', 'cashDiscount',
                            'surcharge', 'deliveryFee', 'paidAt', 'ticketNumber', 'cashSessionId', 'createdAt',
                            'number', 'userId', 'paidBy', 'paid'];
  k         text;
  v_sub     numeric;
  v_total   numeric;
  v_pay     numeric;
  v_bad     int;
begin
  if auth.uid() is null then return new; end if;

  if tg_op = 'UPDATE' then
    if new.branch_id <> old.branch_id or new.org_id <> old.org_id then
      raise exception 'Una venta no se puede mover de sucursal';
    end if;
    if coalesce((o ->> 'paid')::boolean, false) then
      foreach k in array locked loop
        if (n -> k) is distinct from (o -> k) then
          raise exception 'La venta #% ya está cobrada: no se puede modificar "%"', o ->> 'number', k;
        end if;
      end loop;
    end if;
    if coalesce((o ->> 'voided')::boolean, false) and not coalesce((n ->> 'voided')::boolean, false) then
      raise exception 'Una venta anulada no se puede recuperar';
    end if;
    if coalesce((n ->> 'voided')::boolean, false) <> coalesce((o ->> 'voided')::boolean, false)
       and coalesce(current_setting('app.void_ok', true), '') <> 'on' then
      raise exception 'Las anulaciones se hacen con autorización de un encargado';
    end if;
  elsif coalesce((n ->> 'voided')::boolean, false) then
    raise exception 'No se puede crear una venta ya anulada';
  end if;

  -- Los números tienen que cerrar: solo validar si se inserta o si cambiaron items/subtotal/total/descuentos
  if tg_op = 'INSERT'
     or (n -> 'items') is distinct from (o -> 'items')
     or (n -> 'subtotal') is distinct from (o -> 'subtotal')
     or (n -> 'total') is distinct from (o -> 'total')
     or (n -> 'payments') is distinct from (o -> 'payments')
     or (n -> 'discountAmount') is distinct from (o -> 'discountAmount')
     or (n -> 'cashDiscount') is distinct from (o -> 'cashDiscount')
     or (n -> 'surcharge') is distinct from (o -> 'surcharge')
     or (n -> 'deliveryFee') is distinct from (o -> 'deliveryFee') then

    select count(*) filter (where coalesce((i ->> 'qty')::numeric, 0) <= 0 or coalesce((i ->> 'unitPrice')::numeric, -1) < 0),
           coalesce(sum((i ->> 'unitPrice')::numeric * (i ->> 'qty')::numeric), 0)
      into v_bad, v_sub
      from jsonb_array_elements(coalesce(n -> 'items', '[]'::jsonb)) i;
    if v_bad > 0 then raise exception 'Hay ítems con cantidad o precio inválido'; end if;
    if jsonb_array_length(coalesce(n -> 'items', '[]'::jsonb)) = 0 then raise exception 'La venta no tiene productos'; end if;
    if abs(v_sub - coalesce((n ->> 'subtotal')::numeric, 0)) > 1 then
      raise exception 'El subtotal no coincide con los productos';
    end if;
    if coalesce((n ->> 'discountAmount')::numeric, 0) < 0 or coalesce((n ->> 'discountAmount')::numeric, 0) > v_sub
       or coalesce((n ->> 'cashDiscount')::numeric, 0) < 0 or coalesce((n ->> 'surcharge')::numeric, 0) < 0
       or coalesce((n ->> 'deliveryFee')::numeric, 0) < 0 then
      raise exception 'Descuentos, recargos o envío inválidos';
    end if;
    v_total := v_sub - coalesce((n ->> 'discountAmount')::numeric, 0) - coalesce((n ->> 'cashDiscount')::numeric, 0)
             + coalesce((n ->> 'deliveryFee')::numeric, 0) + coalesce((n ->> 'surcharge')::numeric, 0);
    if abs(greatest(v_total, 0) - coalesce((n ->> 'total')::numeric, 0)) > 1 then
      raise exception 'El total no coincide con el detalle de la venta';
    end if;
    if coalesce((n ->> 'paid')::boolean, false) then
      select coalesce(sum((p ->> 'amount')::numeric), 0) into v_pay
        from jsonb_array_elements(coalesce(n -> 'payments', '[]'::jsonb)) p;
      if abs(v_pay - coalesce((n ->> 'total')::numeric, 0)) > 1 then
        raise exception 'Los pagos no suman el total de la venta';
      end if;
    end if;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Borrado seguro de sucursales (solo dueño/admin, no la última)
-- ---------------------------------------------------------------------------
create or replace function public.delete_branch(p_branch uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_count int;
begin
  select org_id into v_org from public.branches where id = p_branch;
  if v_org is null then raise exception 'La sucursal no existe'; end if;
  if not private.is_org_admin(v_org) then
    raise exception 'Solo el dueño o administrador puede borrar una sucursal' using errcode = '42501';
  end if;
  select count(*) into v_count from public.branches where org_id = v_org;
  if v_count <= 1 then
    raise exception 'No podés borrar la única sucursal del negocio';
  end if;

  -- Borrar pedidos, comandas, mesas y documentos de la sucursal
  delete from public.orders where branch_id = p_branch;
  delete from public.docs where branch_id = p_branch;
  delete from public.branches where id = p_branch;
end $$;

revoke all on function public.delete_branch(uuid) from public, anon;
grant execute on function public.delete_branch(uuid) to authenticated;
