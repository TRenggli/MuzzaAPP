-- ============================================================================
-- Baja de las funciones públicas del panel de reparto viejo (018 ya publicó el
-- cliente nuevo, que usa reparto_orders / reparto_status con sesión).
--
-- Además se saca el acceso anónimo a funciones que no lo necesitan. Eran
-- "security invoker" y sin sesión no mostraban datos (RLS), pero no tienen por
-- qué ser llamables sin usuario.
--
-- carta_menu, carta_order, carta_order_status y carta_delivery_location (el
-- seguimiento del cliente por número de pedido) SIGUEN siendo públicas.
-- ============================================================================

drop function if exists public.reparto_active_orders(text, text);
drop function if exists public.reparto_update_status(text, text, text, text);
drop function if exists public.reparto_init(text);
drop function if exists public.report_delivery_location(uuid, text, text, double precision, double precision, double precision, double precision, double precision);

revoke all on function public.branches_live(uuid) from public, anon;
revoke all on function public.org_finance(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.org_report(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.clear_demo(uuid) from public, anon;
grant execute on function public.branches_live(uuid) to authenticated;
grant execute on function public.org_finance(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.org_report(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.clear_demo(uuid) to authenticated;
