-- ============================================================================
-- Pruebas del panel de avisos por rol (migración 021). Se ejecutan contra la base real, pero TODO se
-- deshace al final: el bloque termina con un error a propósito que revierte la transacción y muestra el
-- resultado como mensaje "RESULTADO: ...".
--
-- Toma el dueño de un negocio con dos sucursales y, solo dentro de la transacción, lo "convierte" en cada
-- rol para comprobar qué avisos puede leer. Lo que importa: un cajero no recibe los resúmenes del dueño ni
-- las diferencias de caja; la cocina no ve importes; el repartidor solo ve lo suyo; un encargado solo ve su
-- sucursal; sin sesión no se lee nada y desde la app no se puede escribir.
--
-- Uso: ejecutar el archivo completo (editor SQL de Supabase o execute_sql).
-- ============================================================================

-- Lo que ve cada rol de los avisos de un conjunto de pedidos: "tipo:$" (con importes) o "tipo:-" (sin importes)
create or replace function pg_temp.vis(p_org uuid, p_user uuid, p_branch uuid, p_role text, p_where text)
returns text language plpgsql as $f$
declare v text;
begin
  update members set role = p_role, branch_ids = case when p_role = 'admin' then array[p_branch] else '{}'::uuid[] end
   where org_id = p_org and user_id = p_user;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute 'select coalesce(string_agg(kind || '':'' || case when body like ''%$%'' then ''$'' else ''-'' end, '','' order by kind, case when body like ''%$%'' then 0 else 1 end), '''') from notifications where ' || p_where into v;
  execute 'reset role';
  return v;
end $f$;

do $$
declare
  v_org uuid; v_b1 uuid; v_b2 uuid; v_user uuid;
  v_tag text := substr(md5(random()::text), 1, 6);
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  o1 text := 'o-nt-' || v_tag || '-1'; o2 text := 'o-nt-' || v_tag || '-2';
  o3 text := 'o-nt-' || v_tag || '-3'; o4 text := 'o-nt-' || v_tag || '-4'; o5 text := 'o-nt-' || v_tag || '-5';
  v_driver uuid := gen_random_uuid();
  v_yday bigint;
  base jsonb; v_where text; v_got text; v_n int; v_body text;
  r text;
  ok int := 0; bad int := 0; res text := '';
  roles text[] := array['owner', 'admin', 'cajero', 'cocina', 'delivery', 'mozo'];
  exp jsonb;
begin
  select b.org_id into v_org from branches b where b.active group by b.org_id having count(*) >= 2 limit 1;
  select b.id into v_b1 from branches b where b.org_id = v_org and b.active order by b.created_at limit 1;
  select b.id into v_b2 from branches b where b.org_id = v_org and b.active and b.id <> v_b1 order by b.created_at limit 1;
  select m.user_id into v_user from members m where m.org_id = v_org and m.role = 'owner' and m.active limit 1;

  base := jsonb_build_object('type', 'delivery', 'status', 'pendiente', 'paid', false, 'voided', false, 'createdAt', v_now,
    'items', jsonb_build_array(jsonb_build_object('name', 'Muzza', 'qty', 2, 'unitPrice', 5000, 'total', 10000)),
    'subtotal', 10000, 'discountAmount', 0, 'cashDiscount', 0, 'surcharge', 0, 'deliveryFee', 0, 'total', 10000, 'payments', '[]'::jsonb,
    'address', 'Calle 1', 'customerName', 'Cliente prueba');
  v_where := 'data ->> ''orderId'' in (''' || o1 || ''',''' || o2 || ''')';

  -- A. Pedido nuevo (delivery asignado a otra persona) -------------------------------------------------
  insert into orders (org_id, id, branch_id, data) values
    (v_org, o1, v_b1, base || jsonb_build_object('id', o1, 'number', 9501, 'driverId', v_driver::text, 'driver', 'Otro'));
  exp := '{"owner":"order_new:$","admin":"order_new:$","cajero":"order_new:$","cocina":"order_new:-","delivery":"","mozo":""}';
  foreach r in array roles loop
    v_got := pg_temp.vis(v_org, v_user, v_b1, r, v_where);
    if v_got = (exp ->> r) then ok := ok + 1; else bad := bad + 1; res := res || E'\n❌ A. ' || r || ' ve [' || v_got || '], esperado [' || (exp ->> r) || ']'; end if;
  end loop;
  res := res || E'\n(A. pedido nuevo: dueño/encargado/cajero con importe, cocina sin importe, repartidor y mozo nada; el aviso de asignación a otra persona no lo ve nadie más)';

  perform set_config('request.jwt.claims', '', true);
  -- B. Cobrado ------------------------------------------------------------------------------------------
  update orders set data = data || jsonb_build_object('paid', true, 'paidAt', v_now, 'ticketNumber', 77, 'payments', jsonb_build_array(jsonb_build_object('method', 'efectivo', 'amount', 10000)))
   where org_id = v_org and id = o1;
  -- C. Otro delivery sin repartidor que queda listo
  insert into orders (org_id, id, branch_id, data) values (v_org, o2, v_b1, base || jsonb_build_object('id', o2, 'number', 9502));
  update orders set data = data || '{"status":"listo"}'::jsonb where org_id = v_org and id = o2;
  exp := '{"owner":"order_new:$,order_new:$,order_paid:$,order_ready:-","admin":"order_new:$,order_new:$,order_paid:$,order_ready:-","cajero":"order_new:$,order_new:$,order_paid:$,order_ready:-","cocina":"order_new:-,order_new:-","delivery":"order_ready:-","mozo":""}';
  foreach r in array roles loop
    v_got := pg_temp.vis(v_org, v_user, v_b1, r, v_where);
    if v_got = (exp ->> r) then ok := ok + 1; else bad := bad + 1; res := res || E'\n❌ B/C. ' || r || ' ve [' || v_got || '], esperado [' || (exp ->> r) || ']'; end if;
  end loop;
  res := res || E'\n(B/C. cobrado lo ven dueño/encargado/cajero; "listo sin repartidor" lo ve también el repartidor, sin importes)';

  perform set_config('request.jwt.claims', '', true); -- (las escrituras de preparación van sin sesión, como las del servidor)
  -- D. Anulado: lo ven dueño y encargado con motivo e importe; la cocina solo "cancelado"; el cajero nada
  update orders set data = data || jsonb_build_object('voided', true, 'status', 'cancelado', 'voidReason', 'se cayó la moto', 'voidedBy', v_user::text) where org_id = v_org and id = o1;
  exp := '{"owner":"order_new:$,order_new:$,order_paid:$,order_ready:-,order_void:$","admin":"order_new:$,order_new:$,order_paid:$,order_ready:-,order_void:$","cajero":"order_new:$,order_new:$,order_paid:$,order_ready:-","cocina":"order_new:-,order_new:-,order_void:-","delivery":"order_ready:-","mozo":""}';
  foreach r in array roles loop
    v_got := pg_temp.vis(v_org, v_user, v_b1, r, v_where);
    if v_got = (exp ->> r) then ok := ok + 1; else bad := bad + 1; res := res || E'\n❌ D. ' || r || ' ve [' || v_got || '], esperado [' || (exp ->> r) || ']'; end if;
  end loop;
  res := res || E'\n(D. anulación: motivo e importe solo dueño/encargado)';

  -- E. La cocina nunca ve plata en ningún aviso suyo
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  update members set role = 'cocina', branch_ids = '{}' where org_id = v_org and user_id = v_user;
  execute 'set local role authenticated';
  select count(*) into v_n from notifications where body like '%$%' or title like '%$%';
  execute 'reset role';
  if v_n = 0 then ok := ok + 1; res := res || E'\n✅ E. La cocina no recibe ningún aviso con importes';
  else bad := bad + 1; res := res || E'\n❌ E. La cocina ve ' || v_n || ' avisos con importes'; end if;

  -- F. Un encargado de la sucursal 1 no ve lo de la sucursal 2; el dueño sí --------------------------------
  perform set_config('request.jwt.claims', '', true);
  insert into orders (org_id, id, branch_id, data) values (v_org, o5, v_b2, base || jsonb_build_object('id', o5, 'number', 9505));
  v_got := pg_temp.vis(v_org, v_user, v_b1, 'admin', 'data ->> ''orderId'' = ''' || o5 || '''');
  if v_got = '' then ok := ok + 1; res := res || E'\n✅ F1. El encargado de la sucursal 1 no ve avisos de la sucursal 2';
  else bad := bad + 1; res := res || E'\n❌ F1. El encargado ve avisos de otra sucursal: ' || v_got; end if;
  v_got := pg_temp.vis(v_org, v_user, v_b1, 'owner', 'data ->> ''orderId'' = ''' || o5 || '''');
  if v_got = 'order_new:$' then ok := ok + 1; res := res || E'\n✅ F2. El dueño ve las dos sucursales';
  else bad := bad + 1; res := res || E'\n❌ F2. El dueño ve [' || v_got || ']'; end if;

  -- G. Resúmenes: dueño = negocio entero; encargado = solo su sucursal; cajero y demás = nada ---------------
  perform set_config('request.jwt.claims', '', true);
  v_yday := (extract(epoch from (((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1)::timestamp + interval '12 hours') at time zone 'America/Argentina/Buenos_Aires') * 1000)::bigint;
  insert into orders (org_id, id, branch_id, data) values
    (v_org, o3, v_b1, base || jsonb_build_object('id', o3, 'number', 9503, 'type', 'mostrador', 'status', 'entregado', 'paid', true, 'paidAt', v_yday, 'createdAt', v_yday, 'ticketNumber', 9503, 'total', 1000, 'subtotal', 1000, 'items', jsonb_build_array(jsonb_build_object('name', 'a', 'qty', 1, 'unitPrice', 1000)), 'payments', jsonb_build_array(jsonb_build_object('method', 'efectivo', 'amount', 1000)))),
    (v_org, o4, v_b2, base || jsonb_build_object('id', o4, 'number', 9504, 'type', 'mostrador', 'status', 'entregado', 'paid', true, 'paidAt', v_yday, 'createdAt', v_yday, 'ticketNumber', 9504, 'total', 2000, 'subtotal', 2000, 'items', jsonb_build_array(jsonb_build_object('name', 'a', 'qty', 1, 'unitPrice', 2000)), 'payments', jsonb_build_array(jsonb_build_object('method', 'efectivo', 'amount', 2000))));
  select private.notifications_run_summaries(now()) into v_n;
  if v_n >= 3 then ok := ok + 1; res := res || E'\n✅ G0. Se generaron los resúmenes (' || v_n || ')'; else bad := bad + 1; res := res || E'\n❌ G0. Resúmenes generados: ' || v_n; end if;
  -- (el cron puede correr dos veces el mismo día sin duplicar)
  select private.notifications_run_summaries(now()) into v_n;
  select count(*) into v_n from notifications where dedupe_key like 'sum_day:%' and org_id = v_org and created_at >= now() - interval '1 minute';
  if v_n = (select count(distinct dedupe_key) from notifications where dedupe_key like 'sum_day:%' and org_id = v_org) then ok := ok + 1; res := res || E'\n✅ G1. Correr el resumen dos veces no duplica';
  else bad := bad + 1; res := res || E'\n❌ G1. Se duplicaron resúmenes'; end if;

  exp := jsonb_build_object('owner', 'summary_day:$', 'admin', 'summary_day:$', 'cajero', '', 'cocina', '', 'delivery', '', 'mozo', '');
  foreach r in array roles loop
    v_got := pg_temp.vis(v_org, v_user, v_b1, r, 'kind like ''summary_%'' and org_id = ''' || v_org || '''');
    if v_got = (exp ->> r) then ok := ok + 1; else bad := bad + 1; res := res || E'\n❌ G. ' || r || ' ve [' || v_got || '], esperado [' || (exp ->> r) || ']'; end if;
  end loop;
  -- el dueño: el del negocio (con las dos sucursales); el encargado de la sucursal 1: solo el suyo
  perform pg_temp.vis(v_org, v_user, v_b1, 'owner', 'true');
  execute 'set local role authenticated';
  select string_agg(body, ' | ') into v_body from notifications where kind = 'summary_day' and branch_id is null and org_id = v_org;
  execute 'reset role';
  if v_body like '%$ 3.000%' then ok := ok + 1; res := res || E'\n✅ G2. El dueño recibe el total del negocio ($ 3.000 = las dos sucursales)';
  else bad := bad + 1; res := res || E'\n❌ G2. Resumen del dueño: ' || coalesce(v_body, 'nada'); end if;
  perform pg_temp.vis(v_org, v_user, v_b1, 'admin', 'true');
  execute 'set local role authenticated';
  select string_agg(body, ' | ') into v_body from notifications where kind = 'summary_day' and org_id = v_org;
  execute 'reset role';
  if v_body like '%$ 1.000%' and v_body not like '%$ 2.000%' and v_body not like '%$ 3.000%' then ok := ok + 1; res := res || E'\n✅ G3. El encargado solo recibe las ventas de su sucursal ($ 1.000), no las de otra ni el total';
  else bad := bad + 1; res := res || E'\n❌ G3. Resumen del encargado: ' || coalesce(v_body, 'nada'); end if;

  -- H. Caja: apertura y cierre con diferencia (la diferencia solo la ven dueño y encargado) -----------------
  perform set_config('request.jwt.claims', '', true);
  alter table docs disable trigger docs_notify;
  update docs set data = data || jsonb_build_object('closedAt', v_now - 5000) where org_id = v_org and branch_id = v_b1 and col = 'cash_session' and (data ->> 'closedAt') is null;
  alter table docs enable trigger docs_notify;
  insert into docs (org_id, col, id, branch_id, data) values (v_org, 'cash_session', v_b1::text || '/cs-nt-' || v_tag, v_b1, jsonb_build_object('openedAt', v_now, 'openedBy', v_user::text, 'openingAmount', 1000, 'closedAt', null));
  update docs set data = data || jsonb_build_object('closedAt', v_now + 1, 'closedBy', v_user::text, 'expectedCash', 11000, 'countedCash', 10500, 'diff', -500)
   where org_id = v_org and id = v_b1::text || '/cs-nt-' || v_tag;
  exp := '{"owner":"cash_close:$,cash_open:$","admin":"cash_close:$,cash_open:$","cajero":"cash_close:-,cash_open:$","cocina":"","delivery":"","mozo":""}';
  foreach r in array roles loop
    v_got := pg_temp.vis(v_org, v_user, v_b1, r, 'kind in (''cash_open'',''cash_close'')');
    if v_got = (exp ->> r) then ok := ok + 1; else bad := bad + 1; res := res || E'\n❌ H. ' || r || ' ve [' || v_got || '], esperado [' || (exp ->> r) || ']'; end if;
  end loop;

  -- I. Sin sesión no se lee nada, y desde la app no se puede escribir ---------------------------------------
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin
    select count(*) into v_n from notifications;
    if v_n = 0 then ok := ok + 1; res := res || E'\n✅ I1. Sin sesión no se ve ningún aviso'; else bad := bad + 1; res := res || E'\n❌ I1. anon ve ' || v_n; end if;
  exception when others then ok := ok + 1; res := res || E'\n✅ I1. Sin sesión no se puede ni consultar la tabla'; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  update members set role = 'owner', branch_ids = '{}' where org_id = v_org and user_id = v_user;
  execute 'set local role authenticated';
  begin
    insert into notifications (org_id, kind, title, audience) values (v_org, 'x', 'falso', array['cajero']);
    bad := bad + 1; res := res || E'\n❌ I2. Un usuario pudo crear un aviso';
  exception when others then ok := ok + 1; res := res || E'\n✅ I2. Desde la app no se puede crear avisos (ni siquiera el dueño)'; end;
  begin
    delete from notifications;
    update notifications set title = 'x';
    get diagnostics v_n = row_count;
    if v_n = 0 then ok := ok + 1; res := res || E'\n✅ I3. Desde la app no se puede modificar ni borrar avisos'; else bad := bad + 1; res := res || E'\n❌ I3. Se modificaron ' || v_n; end if;
  exception when others then ok := ok + 1; res := res || E'\n✅ I3. Desde la app no se puede modificar ni borrar avisos'; end;
  -- leído: solo el propio
  insert into notification_state (user_id, org_id, read_until) values (v_user, v_org, now());
  begin
    insert into notification_state (user_id, org_id, read_until) values (gen_random_uuid(), v_org, now());
    bad := bad + 1; res := res || E'\n❌ I4. Marcó "leído" por otra persona';
  exception when others then ok := ok + 1; res := res || E'\n✅ I4. Cada persona marca solo lo suyo como leído'; end;
  execute 'reset role';

  raise exception E'RESULTADO: % ok, % mal%', ok, bad, res;
end $$;
