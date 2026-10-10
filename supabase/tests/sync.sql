-- ============================================================================
-- Pruebas de la sincronización confiable (020): una sola caja abierta, cobros
-- tardíos y parche de configuración. Se ejecutan contra la base real, pero TODO
-- se deshace al final: el bloque termina con un error a propósito que revierte
-- la transacción y muestra el resultado como mensaje "RESULTADO: ...".
--
-- Uso: ejecutar el archivo completo (editor SQL de Supabase o execute_sql).
-- ============================================================================
do $$
declare
  v_org    uuid;
  v_br     uuid;
  v_user   uuid;
  v_tag    text := substr(md5(random()::text), 1, 6);
  v_now    bigint := (extract(epoch from now()) * 1000)::bigint;
  v_open   text;       -- id local de la caja abierta de la sucursal (si hay)
  v_closed text := 'cs-test-' || v_tag;
  v_ord    jsonb;
  v_res    jsonb;
  v_row    record;
  v_before jsonb;
  v_n      int;
  ok       int := 0;
  bad      int := 0;
  res      text := '';
  base     jsonb;
begin
  select m.org_id, m.user_id into v_org, v_user from members m where m.role = 'owner' and m.active limit 1;
  select b.id into v_br from branches b where b.org_id = v_org and b.active order by b.created_at limit 1;
  select substring(d.id from position('/' in d.id) + 1) into v_open from docs d
   where d.org_id = v_org and d.branch_id = v_br and d.col = 'cash_session' and (d.data ->> 'closedAt') is null;

  -- 0. Índices -----------------------------------------------------------------------
  if to_regclass('public.orders_branch_updated_idx') is not null and to_regclass('public.docs_org_updated_idx') is not null
     and to_regclass('public.docs_one_open_cash_idx') is not null then
    ok := ok + 1; res := res || E'\n✅ 0. Existen los índices de la puesta al día y de la caja única';
  else bad := bad + 1; res := res || E'\n❌ 0. Faltan índices'; end if;

  -- sin dos cajas abiertas hoy
  select count(*) into v_n from (select 1 from docs where col = 'cash_session' and (data ->> 'closedAt') is null group by org_id, branch_id having count(*) > 1) x;
  if v_n = 0 then ok := ok + 1; res := res || E'\n✅ 0b. Ninguna sucursal tiene dos cajas abiertas';
  else bad := bad + 1; res := res || E'\n❌ 0b. Hay sucursales con dos cajas abiertas'; end if;

  -- 1. El índice frena una segunda caja abierta, aunque el disparador no la vea -----------
  alter table docs disable trigger docs_one_open_cash_session;
  if v_open is null then
    insert into docs (org_id, col, id, branch_id, data) values (v_org, 'cash_session', v_br::text || '/cs-a-' || v_tag, v_br, jsonb_build_object('openedAt', v_now, 'closedAt', null));
  end if;
  begin
    insert into docs (org_id, col, id, branch_id, data) values (v_org, 'cash_session', v_br::text || '/cs-b-' || v_tag, v_br, jsonb_build_object('openedAt', v_now, 'closedAt', null));
    bad := bad + 1; res := res || E'\n❌ 1. Se pudo abrir una segunda caja';
  exception when unique_violation then ok := ok + 1; res := res || E'\n✅ 1. Una segunda caja abierta se rechaza (índice único)'; end;
  alter table docs enable trigger docs_one_open_cash_session;
  select substring(d.id from position('/' in d.id) + 1) into v_open from docs d
   where d.org_id = v_org and d.branch_id = v_br and d.col = 'cash_session' and (d.data ->> 'closedAt') is null;

  -- una caja cerrada vieja, para probar los cobros tardíos
  insert into docs (org_id, col, id, branch_id, data) values
    (v_org, 'cash_session', v_br::text || '/' || v_closed, v_br, jsonb_build_object('openedAt', v_now - 3600000, 'closedAt', v_now - 60000));

  base := jsonb_build_object('type', 'mostrador', 'status', 'entregado', 'voided', false,
    'items', jsonb_build_array(jsonb_build_object('name', 'Muzza', 'qty', 1, 'unitPrice', 1000, 'total', 1000)),
    'subtotal', 1000, 'discountAmount', 0, 'cashDiscount', 0, 'surcharge', 0, 'deliveryFee', 0, 'total', 1000,
    'paid', true, 'payments', jsonb_build_array(jsonb_build_object('method', 'efectivo', 'amount', 1000, 'tendered', 1000)),
    'createdAt', v_now - 120000, 'cashSessionId', v_closed);

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- 2. Cobro después del cierre → pasa a la caja abierta -----------------------------------
  v_ord := base || jsonb_build_object('id', 'o-late-' || v_tag, 'number', 9101, 'paidAt', v_now);
  perform public.upsert_orders(jsonb_build_array(jsonb_build_object('org_id', v_org, 'branch_id', v_br, 'id', 'o-late-' || v_tag, 'data', v_ord)));
  select data into v_row from orders where org_id = v_org and id = 'o-late-' || v_tag;
  if (v_row.data ->> 'cashSessionId') = v_open and not (v_row.data ? 'lateCash') then
    ok := ok + 1; res := res || E'\n✅ 2. Un cobro tardío pasa a la caja abierta (' || v_open || ')';
  else bad := bad + 1; res := res || E'\n❌ 2. El cobro tardío quedó en ' || coalesce(v_row.data ->> 'cashSessionId', '?'); end if;

  -- 3. Cobro ANTES del cierre → se queda donde estaba ---------------------------------------
  v_ord := base || jsonb_build_object('id', 'o-ok-' || v_tag, 'number', 9102, 'paidAt', v_now - 90000);
  perform public.upsert_orders(jsonb_build_array(jsonb_build_object('org_id', v_org, 'branch_id', v_br, 'id', 'o-ok-' || v_tag, 'data', v_ord)));
  select data into v_row from orders where org_id = v_org and id = 'o-ok-' || v_tag;
  if (v_row.data ->> 'cashSessionId') = v_closed then
    ok := ok + 1; res := res || E'\n✅ 3. Un cobro hecho antes del cierre se queda en su caja';
  else bad := bad + 1; res := res || E'\n❌ 3. Se movió un cobro que era anterior al cierre'; end if;

  -- 4. Sin ninguna caja abierta → queda marcado lateCash -------------------------------------
  perform set_config('request.jwt.claims', '', true);
  update docs set data = data || jsonb_build_object('closedAt', v_now - 30000)
   where org_id = v_org and branch_id = v_br and col = 'cash_session' and (data ->> 'closedAt') is null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_ord := base || jsonb_build_object('id', 'o-nocaja-' || v_tag, 'number', 9103, 'paidAt', v_now);
  perform public.upsert_orders(jsonb_build_array(jsonb_build_object('org_id', v_org, 'branch_id', v_br, 'id', 'o-nocaja-' || v_tag, 'data', v_ord)));
  select data into v_row from orders where org_id = v_org and id = 'o-nocaja-' || v_tag;
  if (v_row.data ->> 'lateCash') = 'true' and (v_row.data ->> 'cashSessionId') = v_closed then
    ok := ok + 1; res := res || E'\n✅ 4. Sin caja abierta el cobro tardío queda marcado lateCash';
  else bad := bad + 1; res := res || E'\n❌ 4. No se marcó lateCash: ' || v_row.data::text; end if;

  -- 5. Una venta ya cobrada sigue sin poder modificarse (el guardián sigue vigente) ----------
  begin
    perform public.upsert_orders(jsonb_build_array(jsonb_build_object('org_id', v_org, 'branch_id', v_br, 'id', 'o-ok-' || v_tag, 'data', jsonb_build_object('total', 5))));
    bad := bad + 1; res := res || E'\n❌ 5. Se pudo modificar una venta cobrada';
  exception when others then ok := ok + 1; res := res || E'\n✅ 5. Una venta cobrada no se puede modificar'; end;

  -- 6. Parche de configuración ---------------------------------------------------------------
  select settings into v_before from branches where id = v_br;
  v_res := public.save_settings_patch(v_br, jsonb_build_object('business', jsonb_build_object('phone', '000-' || v_tag),
                                                               'ticket', jsonb_build_object('layout', jsonb_build_object('pago', jsonb_build_object('logo', false)))));
  if (v_res #>> '{business,phone}') = '000-' || v_tag
     and (v_res #>> '{business,name}') is not distinct from (v_before #>> '{business,name}')
     and (v_res #>> '{ticket,layout,pago,logo}') = 'false'
     and (v_res #>> '{ticket,width}') is not distinct from (v_before #>> '{ticket,width}')
     and (v_res -> 'zones') is not distinct from (v_before -> 'zones') then
    ok := ok + 1; res := res || E'\n✅ 6a. El parche cambia solo lo que trae y conserva el resto de la configuración';
  else bad := bad + 1; res := res || E'\n❌ 6a. El parche pisó otros datos'; end if;

  v_res := public.save_settings_patch(v_br, jsonb_build_object('ticket', jsonb_build_object('layout', jsonb_build_object('cobrar', jsonb_build_object('qr', false)))));
  if (v_res #>> '{ticket,layout,pago,logo}') = 'false' and (v_res #>> '{ticket,layout,cobrar,qr}') = 'false' then
    ok := ok + 1; res := res || E'\n✅ 6b. Dos parches seguidos sobre partes distintas del diseño se acumulan, no se pisan';
  else bad := bad + 1; res := res || E'\n❌ 6b. El segundo parche borró el primero: ' || coalesce((v_res #> '{ticket,layout}')::text, '-'); end if;

  v_res := public.save_settings_patch(v_br, jsonb_build_object('halfPricing', 'avg', 'zones', jsonb_build_array()));
  if (v_res ->> 'halfPricing') = 'avg' and jsonb_array_length(v_res -> 'zones') = 0 then
    ok := ok + 1; res := res || E'\n✅ 6c. Las listas (zonas) se reemplazan completas';
  else bad := bad + 1; res := res || E'\n❌ 6c. Una lista no se reemplazó bien'; end if;

  begin
    perform public.save_settings_patch(v_br, '[1]'::jsonb);
    bad := bad + 1; res := res || E'\n❌ 6d. Aceptó un parche que no es un objeto';
  exception when others then ok := ok + 1; res := res || E'\n✅ 6d. Rechaza un parche inválido'; end;

  -- 7. Permisos del parche -----------------------------------------------------------------
  update members set role = 'cajero' where org_id = v_org and user_id = v_user;
  begin
    perform public.save_settings_patch(v_br, jsonb_build_object('halfPricing', 'max'));
    bad := bad + 1; res := res || E'\n❌ 7a. Un cajero pudo cambiar la configuración';
  exception when others then ok := ok + 1; res := res || E'\n✅ 7a. Un cajero no puede cambiar la configuración'; end;

  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin
    perform public.save_settings_patch(v_br, jsonb_build_object('halfPricing', 'max'));
    bad := bad + 1; res := res || E'\n❌ 7b. anon pudo cambiar la configuración';
  exception when others then ok := ok + 1; res := res || E'\n✅ 7b. Sin sesión no se puede cambiar la configuración'; end;
  execute 'reset role';

  raise exception E'RESULTADO: % ok, % mal%', ok, bad, res;
end $$;
