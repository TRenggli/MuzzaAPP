-- ============================================================================
-- Pruebas del salón, el rol mozo y la mitad y mitad por pizza (se ejecutan
-- contra la base real, pero TODO se deshace al final: el bloque termina con
-- un error a propósito que revierte la transacción y muestra el resultado).
--
-- Toma el dueño de cualquier negocio y, solo dentro de la transacción, lo
-- convierte en mozo y en cajero para probar lo que cada rol puede hacer.
--
-- Uso: ejecutar el archivo completo en el editor SQL de Supabase. El
-- resultado aparece como mensaje de error "RESULTADO: ..." (es esperado).
-- ============================================================================
do $$
declare
  v_org  uuid;
  v_br   uuid;
  v_user uuid;
  v_id   text := 'o-prueba-' || substr(md5(random()::text), 1, 8);
  ord    jsonb;
  cd     jsonb;
  ok     int := 0;
  bad    int := 0;
  res    text := '';
begin
  select m.org_id, m.user_id into v_org, v_user from members m where m.role = 'owner' and m.active limit 1;
  select id into v_br from branches where org_id = v_org and active limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- 1. El dueño puede invitar mozos
  begin
    perform public.create_invite(v_br, 'mozo', 7, 'prueba');
    ok := ok + 1; res := res || E'\n✅ 1. Invitar a un mozo';
  exception when others then bad := bad + 1; res := res || E'\n❌ 1. Invitar a un mozo: ' || sqlerrm; end;

  -- Como MOZO ------------------------------------------------------------------
  update members set role = 'mozo' where org_id = v_org and user_id = v_user;

  if private.role_can_write(v_org, v_br, 'table_session') and private.dining_allowed(v_org, v_br) then
    ok := ok + 1; res := res || E'\n✅ 2. El mozo escribe cuentas de mesa';
  else bad := bad + 1; res := res || E'\n❌ 2. El mozo no puede escribir cuentas de mesa'; end if;

  if not private.role_can_write(v_org, v_br, 'cash_session') and not private.role_can_write(v_org, v_br, 'product') then
    ok := ok + 1; res := res || E'\n✅ 3. El mozo no toca caja ni menú';
  else bad := bad + 1; res := res || E'\n❌ 3. El mozo puede tocar caja o menú'; end if;

  ord := jsonb_build_object('id', v_id, 'number', 1, 'type', 'mesa', 'table', '1', 'tableSessionId', 'ts-prueba', 'batchNumber', 1,
    'items', jsonb_build_array(jsonb_build_object('name', 'Muzza', 'qty', 1, 'unitPrice', 1000, 'total', 1000)),
    'subtotal', 1000, 'discountAmount', 0, 'cashDiscount', 0, 'surcharge', 0, 'deliveryFee', 0, 'total', 1000,
    'paid', false, 'payments', '[]'::jsonb, 'status', 'pendiente', 'createdAt', 1);

  begin
    perform public.upsert_orders(jsonb_build_array(jsonb_build_object('org_id', v_org, 'branch_id', v_br, 'id', v_id, 'data', ord)));
    ok := ok + 1; res := res || E'\n✅ 4. El mozo manda una tanda sin cobrar';
  exception when others then bad := bad + 1; res := res || E'\n❌ 4. El mozo no pudo mandar la tanda: ' || sqlerrm; end;

  begin
    perform public.upsert_orders(jsonb_build_array(jsonb_build_object('org_id', v_org, 'branch_id', v_br, 'id', v_id || 'p',
      'data', ord || jsonb_build_object('id', v_id || 'p', 'paid', true, 'payments', jsonb_build_array(jsonb_build_object('method', 'efectivo', 'amount', 1000))))));
    bad := bad + 1; res := res || E'\n❌ 5. El mozo cargó una venta cobrada';
  exception when others then ok := ok + 1; res := res || E'\n✅ 5. El mozo no puede cobrar';
  end;

  begin
    perform public.upsert_orders(jsonb_build_array(jsonb_build_object('org_id', v_org, 'branch_id', v_br, 'id', v_id || 'd',
      'data', ord || jsonb_build_object('id', v_id || 'd', 'type', 'delivery'))));
    bad := bad + 1; res := res || E'\n❌ 6. El mozo cargó un delivery';
  exception when others then ok := ok + 1; res := res || E'\n✅ 6. El mozo solo carga pedidos de mesa';
  end;

  begin
    perform public.upsert_orders(jsonb_build_array(jsonb_build_object('org_id', v_org, 'branch_id', v_br, 'id', v_id,
      'data', jsonb_build_object('status', 'entregado', 'statusTimes', jsonb_build_object('entregado', 2)))));
    ok := ok + 1; res := res || E'\n✅ 7. El mozo marca la tanda como servida';
  exception when others then bad := bad + 1; res := res || E'\n❌ 7. El mozo no pudo marcar servida: ' || sqlerrm; end;

  begin
    perform public.upsert_orders(jsonb_build_array(jsonb_build_object('org_id', v_org, 'branch_id', v_br, 'id', v_id,
      'data', jsonb_build_object('total', 1))));
    bad := bad + 1; res := res || E'\n❌ 8. El mozo cambió el total';
  exception when others then ok := ok + 1; res := res || E'\n✅ 8. El mozo no cambia montos';
  end;

  -- Como CAJERO ----------------------------------------------------------------
  update members set role = 'cajero' where org_id = v_org and user_id = v_user;

  if private.role_can_write(v_org, v_br, 'table_session') and private.role_can_write(v_org, v_br, 'order') then
    ok := ok + 1; res := res || E'\n✅ 9. La caja escribe cuentas de mesa y acepta pedidos web';
  else bad := bad + 1; res := res || E'\n❌ 9. La caja no puede escribir cuentas de mesa o aceptar pedidos web'; end if;

  -- cobro unificado de la mesa: la tanda recibe su parte del descuento y del pago
  begin
    perform public.upsert_orders(jsonb_build_array(jsonb_build_object('org_id', v_org, 'branch_id', v_br, 'id', v_id,
      'data', jsonb_build_object('paid', true, 'paidAt', 3, 'ticketNumber', 9, 'cashDiscount', 100, 'total', 900,
        'payments', jsonb_build_array(jsonb_build_object('method', 'efectivo', 'amount', 900, 'tendered', 900, 'change', 0)),
        'tableBill', jsonb_build_object('sessionId', 'ts-prueba', 'ticketNumber', 9)))));
    ok := ok + 1; res := res || E'\n✅ 10. La caja cobra la tanda dentro del cobro de la mesa';
  exception when others then bad := bad + 1; res := res || E'\n❌ 10. No se pudo cobrar la tanda: ' || sqlerrm; end;

  -- Mitad y mitad -------------------------------------------------------------
  if not private.half_pair_ok('{"halfWith": ["p-muz"]}', 'p-haw', '{}', 'p-jym')
     and private.half_pair_ok('{"halfWith": ["p-muz"]}', 'p-haw', '{}', 'p-muz')
     and not private.half_pair_ok('{}', 'p-muz', '{"allowHalf": false}', 'p-cal')
     and not private.half_pair_ok('{}', 'p-jym', '{"halfWith": ["p-muz"]}', 'p-haw') then
    ok := ok + 1; res := res || E'\n✅ 11. Mitad y mitad: solo entera, solo con algunas y en los dos sentidos';
  else bad := bad + 1; res := res || E'\n❌ 11. La regla de mitad y mitad no se respeta'; end if;

  cd := private.carta_data(v_br);
  if jsonb_array_length(cd -> 'products') = 0 or ((cd -> 'products' -> 0) ? 'allowHalf' and (cd -> 'products' -> 0) ? 'halfWith' and (cd -> 'products' -> 0) ? 'photoPos') then
    ok := ok + 1; res := res || E'\n✅ 12. La carta pública recibe la regla de mitades y el encuadre de la foto';
  else bad := bad + 1; res := res || E'\n❌ 12. La carta pública no recibe la regla de mitades o la foto'; end if;

  raise exception 'RESULTADO: % ok, % fallas%', ok, bad, res;
end $$;
