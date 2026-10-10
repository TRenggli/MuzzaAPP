-- ============================================================================
-- Sincronización confiable entre los equipos de una sucursal
--
--   1. Índices para "ponerse al día" tras un corte: el equipo pide solo lo que
--      cambió desde la última vez (orders por sucursal+updated_at, docs por
--      negocio+updated_at).
--   2. Una sola caja abierta por sucursal, también cuando dos equipos abren a la
--      vez (un disparador no ve lo que otra transacción todavía no confirmó; el
--      índice único sí lo frena).
--   3. Un cobro registrado cuando su caja ya estaba cerrada (otro equipo cerró
--      mientras tanto) se pasa a la caja abierta, o queda marcado lateCash.
--   4. Configuración sin pisarse: save_settings_patch combina el parche con lo
--      que hay, en vez de reemplazar todo (gana el último solo en el mismo dato).
-- ============================================================================

-- 1. Índices de la puesta al día
create index if not exists orders_branch_updated_idx on public.orders (branch_id, updated_at);
create index if not exists docs_org_updated_idx on public.docs (org_id, updated_at);

-- 2. Una sola caja abierta por sucursal
-- (si hubiera dos abiertas, este índice no se podría crear: se cierra una antes)
create unique index if not exists docs_one_open_cash_idx
  on public.docs (org_id, branch_id)
  where col = 'cash_session' and (data ->> 'closedAt') is null;

-- 3. Cobro tardío: se agrega a la protección de ventas (orders_guard)
create or replace function private.orders_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
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
  v_closed  numeric;
  v_open    text;
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

  -- Cobro tardío: se cobró cuando la caja del equipo ya estaba cerrada (otro equipo la cerró
  -- mientras tanto). Solo en el momento de cobrar. Pasa a la caja abierta de la sucursal; si
  -- no hay ninguna abierta, queda marcado para que Caja lo muestre como "cobrado después del cierre".
  if coalesce((n ->> 'paid')::boolean, false)
     and (tg_op = 'INSERT' or not coalesce((o ->> 'paid')::boolean, false))
     and coalesce(n ->> 'cashSessionId', '') <> '' then
    select (d.data ->> 'closedAt')::numeric into v_closed
      from docs d
     where d.org_id = new.org_id and d.col = 'cash_session'
       and d.id = new.branch_id::text || '/' || (n ->> 'cashSessionId');
    if v_closed is not null and coalesce((n ->> 'paidAt')::numeric, 0) > v_closed then
      select substring(d.id from position('/' in d.id) + 1) into v_open
        from docs d
       where d.org_id = new.org_id and d.branch_id = new.branch_id and d.col = 'cash_session'
         and (d.data ->> 'closedAt') is null
       limit 1;
      if v_open is not null then
        new.data := new.data || jsonb_build_object('cashSessionId', v_open);
      else
        new.data := new.data || jsonb_build_object('lateCash', true);
      end if;
    end if;
  end if;

  return new;
end $function$;

-- 4. Configuración sin pisarse
-- Combina el parche con la configuración actual hasta 4 niveles (ej: ticket → layout → pago →
-- bloque); lo que no cambió no se toca, así dos encargados editando cosas distintas no se pisan.
create or replace function private.jsonb_merge_depth(a jsonb, b jsonb, depth int)
returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text; v jsonb; r jsonb := coalesce(a, '{}'::jsonb);
begin
  if jsonb_typeof(b) is distinct from 'object' or jsonb_typeof(r) is distinct from 'object' then
    return b;
  end if;
  for k, v in select * from jsonb_each(b) loop
    if depth > 1 and jsonb_typeof(v) = 'object' and jsonb_typeof(r -> k) = 'object' then
      r := jsonb_set(r, array[k], private.jsonb_merge_depth(r -> k, v, depth - 1));
    else
      r := jsonb_set(r, array[k], v);
    end if;
  end loop;
  return r;
end $$;

create or replace function public.save_settings_patch(p_branch uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_cur jsonb; v_new jsonb;
begin
  select org_id, settings into v_org, v_cur from branches where id = p_branch for update;
  if v_org is null or not (private.is_org_admin(v_org) and private.can_branch(v_org, p_branch)) then
    raise exception 'Sin permiso para cambiar la configuración de esta sucursal' using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Parche de configuración inválido' using errcode = '22023';
  end if;
  v_new := private.jsonb_merge_depth(coalesce(v_cur, '{}'::jsonb), p_patch, 4);
  update branches set settings = v_new where id = p_branch;
  return v_new;
end $$;

revoke all on function public.save_settings_patch(uuid, jsonb) from public, anon;
grant execute on function public.save_settings_patch(uuid, jsonb) to authenticated;
