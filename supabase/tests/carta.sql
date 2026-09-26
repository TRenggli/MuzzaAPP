-- ============================================================================
-- Pruebas de la carta online (contra la base real; TODO se deshace al final:
-- el bloque termina con un error a propósito que revierte la transacción).
--
-- Simula a un cliente anónimo desde la carta y a empleados de dos sucursales,
-- y verifica que los precios los calcule el servidor y que nadie pueda hacer
-- trampa (precios truchos, productos ocultos, espiar pedidos de otra sucursal).
-- ============================================================================
do $$
declare
  v_org     uuid;
  v_centro  uuid;
  u_cajero  uuid;
  u_enc     uuid;
  u_pal     uuid;
  p_muz     text;
  p_nap     text;
  p_beb     text;
  v_menu    jsonb;
  v_res     jsonb;
  v_id      uuid;
  v_n       int;
  ok        int := 0;
  bad       int := 0;
  res       text := '';
begin
  select o.id into v_org from organizations o where o.name = 'Pizzería Diego';
  select id into v_centro from branches where org_id = v_org and name = 'Centro';
  select user_id into u_cajero from members where username = 'martin.centro';
  select user_id into u_enc from members where username = 'sofia.centro';
  select user_id into u_pal from members where username = 'ana.palermo';
  select substring(id from position('/' in id) + 1) into p_muz from docs where branch_id = v_centro and col = 'product' and data ->> 'name' = 'Muzzarella';
  select substring(id from position('/' in id) + 1) into p_nap from docs where branch_id = v_centro and col = 'product' and data ->> 'name' = 'Napolitana';
  select substring(d.id from position('/' in d.id) + 1) into p_beb from docs d
   where d.branch_id = v_centro and d.col = 'product' and d.data ->> 'categoryId' = 'c-beb' limit 1;

  -- ---------- 1. Sin publicar: no se ve ----------
  update branches set slug = 'prueba-centro' where id = v_centro;
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  if public.carta_menu('prueba-centro') is null then ok := ok + 1; res := res || E'\n✅ 1. Carta sin publicar: no se muestra';
  else bad := bad + 1; res := res || E'\n❌ 1. Se ve una carta sin publicar'; end if;
  execute 'reset role';

  -- Publicar (como lo hace el dueño desde el panel)
  update branches set settings = jsonb_set(settings, '{online}', jsonb_build_object(
      'enabled', true, 'whatsapp', '1155551234', 'paused', false,
      'hours', jsonb_build_object('mode', 'always', 'days', '[0,1,2,3,4,5,6]'::jsonb, 'from', '19:00', 'to', '23:30'),
      'types', jsonb_build_object('retiro', true, 'delivery', true, 'mesa', false),
      'payments', jsonb_build_object('efectivo', true, 'transferencia', true, 'tarjeta', false),
      'minOrder', 0))
   where id = v_centro;
  update docs set data = data || '{"online": false}' where branch_id = v_centro and col = 'product' and data ->> 'name' = 'Fugazzeta';

  -- ---------- como CLIENTE anónimo ----------
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  v_menu := public.carta_menu('PRUEBA-CENTRO');
  if v_menu is not null and jsonb_array_length(v_menu -> 'products') > 0 then ok := ok + 1; res := res || E'\n✅ 2. Carta publicada: se ve (sin importar mayúsculas)';
  else bad := bad + 1; res := res || E'\n❌ 2. No se ve la carta publicada'; end if;

  if (v_menu -> 'products')::text !~ '"(recipe|cost|factor)"' then ok := ok + 1; res := res || E'\n✅ 3. La carta no expone recetas ni costos';
  else bad := bad + 1; res := res || E'\n❌ 3. La carta expone recetas o costos'; end if;

  if not exists (select 1 from jsonb_array_elements(v_menu -> 'products') p where p ->> 'name' = 'Fugazzeta') then ok := ok + 1; res := res || E'\n✅ 4. Un producto oculto no aparece en la carta';
  else bad := bad + 1; res := res || E'\n❌ 4. Aparece un producto oculto'; end if;

  -- Pedido con precios truchos: el servidor los recalcula
  v_res := public.carta_order('prueba-centro', jsonb_build_object(
    'type', 'delivery', 'name', 'Cliente Prueba', 'phone', '11 4444-0000', 'address', 'Mitre 1234', 'zoneId', 'z1',
    'payment', 'efectivo', 'cashWith', '50000',
    'items', jsonb_build_array(
      jsonb_build_object('productId', p_muz, 'variantId', 'grande', 'qty', 2, 'unitPrice', 1, 'total', 2),
      jsonb_build_object('productId', p_muz, 'variantId', 'grande', 'halfId', p_nap, 'extras', jsonb_build_array('e1'), 'qty', 1))));
  v_id := (v_res ->> 'id')::uuid;
  -- 2 × 13.500 + (mitad más cara 15.000 + extra muzza 2.500) + envío 1.500
  if (v_res ->> 'subtotal')::numeric = 44500 and (v_res ->> 'total')::numeric = 46000 and (v_res ->> 'deliveryFee')::numeric = 1500 then
    ok := ok + 1; res := res || E'\n✅ 5. Precios calculados por el servidor (se ignora el precio que manda el teléfono)';
  else bad := bad + 1; res := res || E'\n❌ 5. Totales incorrectos: ' || (v_res ->> 'subtotal') || ' / ' || (v_res ->> 'total'); end if;

  if v_res #>> '{items,1,name}' like '½ Muzzarella + ½ Napolitana' then ok := ok + 1; res := res || E'\n✅ 6. Mitad y mitad armada por el servidor';
  else bad := bad + 1; res := res || E'\n❌ 6. Nombre de mitad y mitad: ' || coalesce(v_res #>> '{items,1,name}', '(nulo)'); end if;

  begin
    perform public.carta_order('prueba-centro', jsonb_build_object('type', 'retiro', 'name', 'Otro', 'phone', '1133330000',
      'items', jsonb_build_array(jsonb_build_object('productId', p_beb, 'variantId', 'u', 'extras', jsonb_build_array('e1'), 'qty', 1))));
    bad := bad + 1; res := res || E'\n❌ 7. Se aceptaron agregados en una bebida';
  exception when others then ok := ok + 1; res := res || E'\n✅ 7. Agregados en una bebida: rechazado';
  end;

  begin
    perform public.carta_order('prueba-centro', jsonb_build_object('type', 'retiro', 'name', 'Otro', 'phone', '1133330000',
      'items', jsonb_build_array(jsonb_build_object('productId', (select substring(id from position('/' in id) + 1) from docs where branch_id = v_centro and col = 'product' and data ->> 'name' = 'Fugazzeta'), 'variantId', 'grande', 'qty', 1))));
    bad := bad + 1; res := res || E'\n❌ 8. Se pudo pedir un producto oculto';
  exception when others then ok := ok + 1; res := res || E'\n✅ 8. Pedir un producto oculto: rechazado';
  end;

  begin
    perform public.carta_order('prueba-centro', jsonb_build_object('type', 'mesa', 'table', '4', 'name', 'Otro', 'phone', '1133330000',
      'items', jsonb_build_array(jsonb_build_object('productId', p_muz, 'variantId', 'grande', 'qty', 1))));
    bad := bad + 1; res := res || E'\n❌ 9. Se aceptó un tipo de pedido deshabilitado (mesa)';
  exception when others then ok := ok + 1; res := res || E'\n✅ 9. Tipo de pedido deshabilitado: rechazado';
  end;

  begin
    perform public.carta_order('prueba-centro', jsonb_build_object('type', 'retiro', 'payment', 'tarjeta', 'name', 'Otro', 'phone', '1133330000',
      'items', jsonb_build_array(jsonb_build_object('productId', p_muz, 'variantId', 'grande', 'qty', 1))));
    bad := bad + 1; res := res || E'\n❌ 10. Se aceptó un medio de pago deshabilitado';
  exception when others then ok := ok + 1; res := res || E'\n✅ 10. Medio de pago deshabilitado: rechazado';
  end;

  begin
    select count(*) into v_n from online_orders;
    bad := bad + 1; res := res || E'\n❌ 11. Un anónimo pudo leer los pedidos web';
  exception when others then ok := ok + 1; res := res || E'\n✅ 11. Un anónimo no puede leer los pedidos web';
  end;

  begin
    insert into online_orders (org_id, branch_id, number, data, total, phone) values (v_org, v_centro, 1, '{}', 1, '1');
    bad := bad + 1; res := res || E'\n❌ 12. Se pudo cargar un pedido web salteando las validaciones';
  exception when others then ok := ok + 1; res := res || E'\n✅ 12. Cargar pedidos web directo: bloqueado';
  end;

  -- Límite por teléfono: 3 pedidos cada 10 minutos
  perform public.carta_order('prueba-centro', jsonb_build_object('type', 'retiro', 'name', 'Cliente Prueba', 'phone', '1144440000', 'items', jsonb_build_array(jsonb_build_object('productId', p_muz, 'variantId', 'chica', 'qty', 1))));
  perform public.carta_order('prueba-centro', jsonb_build_object('type', 'retiro', 'name', 'Cliente Prueba', 'phone', '1144440000', 'items', jsonb_build_array(jsonb_build_object('productId', p_muz, 'variantId', 'chica', 'qty', 1))));
  begin
    perform public.carta_order('prueba-centro', jsonb_build_object('type', 'retiro', 'name', 'Cliente Prueba', 'phone', '1144440000', 'items', jsonb_build_array(jsonb_build_object('productId', p_muz, 'variantId', 'chica', 'qty', 1))));
    bad := bad + 1; res := res || E'\n❌ 13. Sin límite de pedidos repetidos';
  exception when others then ok := ok + 1; res := res || E'\n✅ 13. Cuarto pedido seguido del mismo teléfono: frenado';
  end;

  if (public.carta_order_status(v_id) ->> 'status') = 'nuevo' then ok := ok + 1; res := res || E'\n✅ 14. Seguimiento del pedido: "nuevo"';
  else bad := bad + 1; res := res || E'\n❌ 14. Seguimiento sin datos'; end if;
  execute 'reset role';

  -- Pausado y pedido mínimo
  update branches set settings = jsonb_set(settings, '{online,paused}', 'true') where id = v_centro;
  execute 'set local role anon';
  begin
    perform public.carta_order('prueba-centro', jsonb_build_object('type', 'retiro', 'name', 'Otro', 'phone', '1122220000', 'items', jsonb_build_array(jsonb_build_object('productId', p_muz, 'variantId', 'chica', 'qty', 1))));
    bad := bad + 1; res := res || E'\n❌ 15. Se pudo pedir con los pedidos pausados';
  exception when others then ok := ok + 1; res := res || E'\n✅ 15. Pedidos pausados: rechazado';
  end;
  execute 'reset role';
  update branches set settings = jsonb_set(jsonb_set(settings, '{online,paused}', 'false'), '{online,minOrder}', '20000') where id = v_centro;
  execute 'set local role anon';
  begin
    perform public.carta_order('prueba-centro', jsonb_build_object('type', 'retiro', 'name', 'Otro', 'phone', '1122220000', 'items', jsonb_build_array(jsonb_build_object('productId', p_muz, 'variantId', 'chica', 'qty', 1))));
    bad := bad + 1; res := res || E'\n❌ 16. Se aceptó un pedido menor al mínimo';
  exception when others then ok := ok + 1; res := res || E'\n✅ 16. Pedido menor al mínimo: rechazado (' || sqlerrm || ')';
  end;
  execute 'reset role';

  -- ---------- como CAJERA de otra sucursal (Palermo) ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_pal, 'role', 'authenticated')::text, true);
  select count(*) into v_n from online_orders where branch_id = v_centro;
  if v_n = 0 then ok := ok + 1; res := res || E'\n✅ 17. Otra sucursal no ve los pedidos web de Centro';
  else bad := bad + 1; res := res || E'\n❌ 17. Otra sucursal ve pedidos web de Centro'; end if;
  update online_orders set status = 'rechazado', reason = 'x' where id = v_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then ok := ok + 1; res := res || E'\n✅ 18. Otra sucursal no puede atender pedidos de Centro';
  else bad := bad + 1; res := res || E'\n❌ 18. Otra sucursal atendió un pedido de Centro'; end if;

  -- ---------- como CAJERO de Centro ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_cajero, 'role', 'authenticated')::text, true);
  begin
    update online_orders set data = data || '{"total": 1}' where id = v_id;
    bad := bad + 1; res := res || E'\n❌ 19. El cajero pudo cambiar el detalle de un pedido web';
  exception when others then ok := ok + 1; res := res || E'\n✅ 19. Cambiar el detalle de un pedido web: bloqueado';
  end;
  update online_orders set status = 'aceptado', order_id = 'o-prueba-web' where id = v_id and status = 'nuevo';
  get diagnostics v_n = row_count;
  if v_n = 1 then ok := ok + 1; res := res || E'\n✅ 20. El cajero acepta el pedido web';
  else bad := bad + 1; res := res || E'\n❌ 20. El cajero no pudo aceptar'; end if;
  begin
    update online_orders set status = 'rechazado' where id = v_id;
    bad := bad + 1; res := res || E'\n❌ 21. Se pudo rechazar un pedido ya aceptado';
  exception when others then ok := ok + 1; res := res || E'\n✅ 21. Un pedido aceptado no se puede rechazar después';
  end;
  update online_orders set status = 'aceptado', order_id = 'otro' where id = v_id and status = 'nuevo';
  get diagnostics v_n = row_count;
  if v_n = 0 then ok := ok + 1; res := res || E'\n✅ 22. Dos cajas no pueden aceptar el mismo pedido';
  else bad := bad + 1; res := res || E'\n❌ 22. Se aceptó dos veces'; end if;

  -- Fotos: solo encargados de la sucursal
  if not private.can_edit_menu_path(v_org || '/' || v_centro || '/p-x.jpg') then ok := ok + 1; res := res || E'\n✅ 23. El cajero no puede subir fotos del menú';
  else bad := bad + 1; res := res || E'\n❌ 23. El cajero puede subir fotos del menú'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_enc, 'role', 'authenticated')::text, true);
  if private.can_edit_menu_path(v_org || '/' || v_centro || '/p-x.jpg') and not private.can_edit_menu_path('../../avatars/x.jpg') then
    ok := ok + 1; res := res || E'\n✅ 24. La encargada sube fotos de su sucursal (y no a otras rutas)';
  else bad := bad + 1; res := res || E'\n❌ 24. Permisos de fotos incorrectos'; end if;
  execute 'reset role';

  raise exception 'RESULTADO: % bien, % mal%', ok, bad, res;
end $$;
