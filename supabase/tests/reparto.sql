-- ============================================================================
-- Pruebas del reparto con sesión (se ejecutan contra la base real, pero TODO
-- se deshace al final: el bloque termina con un error a propósito que revierte
-- la transacción y muestra el resultado como mensaje "RESULTADO: ...").
--
-- Toma el dueño de cualquier negocio y, solo dentro de la transacción, lo
-- convierte en repartidor / cajero / cocina para probar qué ve y qué puede
-- tocar cada rol. Crea pedidos de prueba que también se deshacen.
--
-- Uso: ejecutar el archivo completo (editor SQL de Supabase o execute_sql).
-- ============================================================================
do $$
declare
  v_org   uuid;
  v_br    uuid;
  v_user  uuid;
  v_other uuid := gen_random_uuid();
  v_tag   text := substr(md5(random()::text), 1, 6);
  v_now   bigint := (extract(epoch from now()) * 1000)::bigint;
  v_list  jsonb;
  v_ids   text[];
  v_row   record;
  v_n     int;
  ok      int := 0;
  bad     int := 0;
  res     text := '';
  o_free  text := 'o-rep-' || v_tag || '-free';
  o_mine  text := 'o-rep-' || v_tag || '-mine';
  o_oth   text := 'o-rep-' || v_tag || '-oth';
  o_old   text := 'o-rep-' || v_tag || '-old';
  o_oldx  text := 'o-rep-' || v_tag || '-oldx';
  o_done  text := 'o-rep-' || v_tag || '-done';
  o_mos   text := 'o-rep-' || v_tag || '-mos';
  base    jsonb;
begin
  select m.org_id, m.user_id into v_org, v_user from members m where m.role = 'owner' and m.active limit 1;
  select id into v_br from branches where org_id = v_org and active limit 1;

  base := jsonb_build_object('type', 'delivery', 'status', 'listo', 'paid', false, 'voided', false,
    'items', jsonb_build_array(jsonb_build_object('name', 'Muzza', 'qty', 1, 'unitPrice', 1000, 'total', 1000)),
    'subtotal', 1000, 'discountAmount', 0, 'cashDiscount', 0, 'surcharge', 0, 'deliveryFee', 0, 'total', 1000,
    'payments', '[]'::jsonb, 'createdAt', v_now, 'address', 'Calle 123', 'phone', '1155550000', 'customerName', 'Cliente prueba');

  -- pedidos de prueba (sin sesión: el guardián de pedidos no interviene)
  insert into orders (org_id, id, branch_id, data) values
    (v_org, o_free, v_br, base || jsonb_build_object('id', o_free, 'number', 9001)),
    (v_org, o_mine, v_br, base || jsonb_build_object('id', o_mine, 'number', 9002, 'driverId', v_user::text, 'driver', 'Rep Prueba')),
    (v_org, o_oth,  v_br, base || jsonb_build_object('id', o_oth,  'number', 9003, 'driverId', v_other::text, 'driver', 'Otro Rep')),
    (v_org, o_old,  v_br, base || jsonb_build_object('id', o_old,  'number', 9004, 'driver', 'rep prueba')),
    (v_org, o_oldx, v_br, base || jsonb_build_object('id', o_oldx, 'number', 9005, 'driver', 'Alguien Más')),
    (v_org, o_done, v_br, base || jsonb_build_object('id', o_done, 'number', 9006, 'status', 'entregado')),
    (v_org, o_mos,  v_br, base || jsonb_build_object('id', o_mos,  'number', 9007, 'type', 'mostrador'));

  -- 1. Sin sesión (anon) no se puede llamar a ninguna de las funciones de reparto ---------
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin
    perform public.reparto_orders(v_br);
    bad := bad + 1; res := res || E'\n❌ 1a. anon pudo listar los deliveries';
  exception when others then ok := ok + 1; res := res || E'\n✅ 1a. anon no puede listar los deliveries'; end;
  begin
    perform public.reparto_status(v_br, o_free, 'entregado');
    bad := bad + 1; res := res || E'\n❌ 1b. anon pudo marcar un pedido';
  exception when others then ok := ok + 1; res := res || E'\n✅ 1b. anon no puede marcar pedidos'; end;
  begin
    perform public.report_delivery_location(v_br, o_free, -34.6, -58.4);
    bad := bad + 1; res := res || E'\n❌ 1c. anon pudo reportar ubicación';
  exception when others then ok := ok + 1; res := res || E'\n✅ 1c. anon no puede reportar ubicación'; end;
  execute 'reset role';

  -- Como REPARTIDOR ------------------------------------------------------------------------
  update members set role = 'delivery', name = 'Rep Prueba' where org_id = v_org and user_id = v_user;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  v_list := public.reparto_orders(v_br);
  select coalesce(array_agg(e ->> 'id'), '{}') into v_ids from jsonb_array_elements(v_list) e where (e ->> 'id') like 'o-rep-' || v_tag || '%';
  if o_free = any (v_ids) and o_mine = any (v_ids) and o_old = any (v_ids) then
    ok := ok + 1; res := res || E'\n✅ 2a. El repartidor ve los suyos, los sin asignar y los viejos con su nombre';
  else bad := bad + 1; res := res || E'\n❌ 2a. Faltan pedidos propios: ' || v_ids::text; end if;
  if not (o_oth = any (v_ids)) and not (o_oldx = any (v_ids)) and not (o_done = any (v_ids)) and not (o_mos = any (v_ids)) then
    ok := ok + 1; res := res || E'\n✅ 2b. No ve los de otro repartidor, ni entregados, ni los que no son delivery';
  else bad := bad + 1; res := res || E'\n❌ 2b. Ve pedidos que no le corresponden: ' || v_ids::text; end if;

  begin
    perform public.reparto_status(v_br, o_oth, 'en_camino');
    bad := bad + 1; res := res || E'\n❌ 3a. Tocó el pedido de otro repartidor';
  exception when others then ok := ok + 1; res := res || E'\n✅ 3a. No puede tocar el pedido de otro repartidor'; end;
  begin
    perform public.reparto_status(v_br, o_free, 'cancelado');
    bad := bad + 1; res := res || E'\n❌ 3b. Aceptó un estado inválido';
  exception when others then ok := ok + 1; res := res || E'\n✅ 3b. Solo acepta en_camino o entregado'; end;
  begin
    perform public.reparto_status(v_br, o_mos, 'en_camino');
    bad := bad + 1; res := res || E'\n❌ 3c. Tocó un pedido que no es delivery';
  exception when others then ok := ok + 1; res := res || E'\n✅ 3c. No puede tocar pedidos que no son delivery'; end;

  perform public.reparto_status(v_br, o_free, 'en_camino');
  select data, status into v_row from orders where org_id = v_org and id = o_free;
  if v_row.status = 'en_camino' and (v_row.data ->> 'driverId') = v_user::text and (v_row.data ->> 'driver') = 'Rep Prueba'
     and jsonb_typeof(v_row.data -> 'statusTimes' -> 'en_camino') = 'number' and (v_row.data -> 'statusTimes' -> 'en_camino')::bigint >= v_now then
    ok := ok + 1; res := res || E'\n✅ 4a. Salir a entregar: se asigna, cambia el estado y guarda la hora en milisegundos';
  else bad := bad + 1; res := res || E'\n❌ 4a. Salir a entregar dejó: ' || v_row.data::text; end if;

  perform public.reparto_status(v_br, o_free, 'en_camino'); -- doble toque
  ok := ok + 1; res := res || E'\n✅ 4b. Un doble toque no da error';

  perform public.reparto_status(v_br, o_free, 'entregado');
  select status, data into v_row from orders where org_id = v_org and id = o_free;
  if v_row.status = 'entregado' and (v_row.data -> 'statusTimes' ? 'en_camino') and (v_row.data -> 'statusTimes' ? 'entregado') then
    ok := ok + 1; res := res || E'\n✅ 4c. Entregado conserva la hora de en_camino y suma la de entregado';
  else bad := bad + 1; res := res || E'\n❌ 4c. Entregado dejó: ' || v_row.data::text; end if;

  begin
    perform public.report_delivery_location(v_br, o_oth, -34.6, -58.4);
    bad := bad + 1; res := res || E'\n❌ 5a. Reportó ubicación en un pedido ajeno';
  exception when others then ok := ok + 1; res := res || E'\n✅ 5a. No puede reportar ubicación de un pedido ajeno'; end;
  perform public.report_delivery_location(v_br, o_mine, -34.6, -58.4, 5, 90, 3);
  select count(*) into v_n from delivery_locations where branch_id = v_br and order_id = o_mine and driver = 'Rep Prueba';
  if v_n = 1 then ok := ok + 1; res := res || E'\n✅ 5b. Reporta la ubicación de su pedido con su nombre de la sesión';
  else bad := bad + 1; res := res || E'\n❌ 5b. No se guardó la ubicación'; end if;
  begin
    perform public.report_delivery_location(v_br, o_mine, 123, -58.4);
    bad := bad + 1; res := res || E'\n❌ 5c. Aceptó coordenadas inválidas';
  exception when others then ok := ok + 1; res := res || E'\n✅ 5c. Rechaza coordenadas inválidas'; end;

  execute 'set local role authenticated';
  begin
    insert into delivery_locations (branch_id, order_id, driver, lat, lng) values (v_br, o_oth, 'x', 0, 0);
    bad := bad + 1; res := res || E'\n❌ 5d. Escribió la tabla de ubicaciones directo';
  exception when others then ok := ok + 1; res := res || E'\n✅ 5d. No se puede escribir la tabla de ubicaciones directo'; end;
  execute 'reset role';

  -- Como CAJERO: ve todos --------------------------------------------------------------------
  update members set role = 'cajero' where org_id = v_org and user_id = v_user;
  v_list := public.reparto_orders(v_br);
  select count(*) into v_n from jsonb_array_elements(v_list) e where (e ->> 'id') like 'o-rep-' || v_tag || '%';
  -- activos de prueba: mine, oth, old, oldx (free ya está entregado)
  if v_n = 4 then ok := ok + 1; res := res || E'\n✅ 6. El cajero ve todos los deliveries activos (' || v_n || ')';
  else bad := bad + 1; res := res || E'\n❌ 6. El cajero ve ' || v_n || ' de 4'; end if;

  -- Como COCINA: no usa el reparto ---------------------------------------------------------
  update members set role = 'cocina' where org_id = v_org and user_id = v_user;
  begin
    perform public.reparto_orders(v_br);
    bad := bad + 1; res := res || E'\n❌ 7. Cocina pudo ver el reparto';
  exception when others then ok := ok + 1; res := res || E'\n✅ 7. Cocina no usa el reparto'; end;

  raise exception E'RESULTADO: % ok, % mal%', ok, bad, res;
end $$;
