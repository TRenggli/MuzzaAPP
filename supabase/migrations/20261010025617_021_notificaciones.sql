-- ============================================================================
-- Panel de avisos en tiempo real, por usuario y por rol
--
-- El SERVIDOR decide quién recibe cada aviso (no la pantalla): cada fila lleva a
-- qué roles va (audience) o a qué persona (to_user), y la política de lectura
-- (RLS) la evalúa con el rol y las sucursales actuales de quien consulta. Así un
-- cajero nunca recibe, por ejemplo, el resumen de facturación del dueño ni las
-- diferencias de caja: ni por la consulta ni por el tiempo real.
--
-- Matriz fija:
--   owner    todo, de todas las sucursales (y los resúmenes del negocio)
--   admin    su(s) sucursal(es): operación, caja con diferencias, alertas, resumen de la sucursal
--   cajero   su sucursal: pedidos, cobros, caja abierta/cerrada (sin diferencias), stock, cuentas
--   cocina   pedidos nuevos y cancelados de su sucursal, SIN importes
--   delivery solo lo suyo (asignado, listo para salir) y los deliveries sin asignar
--   mozo     solo lo suyo (sus mesas listas)
-- El historial se guarda 30 días.
-- ============================================================================

-- ---------------------------------------------------------------- tablas
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete cascade,   -- null = del negocio entero
  kind        text not null,
  title       text not null,
  body        text not null default '',
  data        jsonb not null default '{}'::jsonb,
  audience    text[] not null default '{}',                             -- roles que lo reciben
  to_user     uuid,                                                      -- o una persona puntual
  dedupe_key  text,
  created_at  timestamptz not null default now()
);
create unique index if not exists notifications_dedupe_idx on public.notifications (dedupe_key) where dedupe_key is not null;
create index if not exists notifications_org_created_idx on public.notifications (org_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (
  private.my_role(org_id) is not null
  and (
    (to_user is not null and to_user = auth.uid())
    or (
      to_user is null
      and private.my_role(org_id) = any (audience)
      and (branch_id is null or private.can_branch(org_id, branch_id))
    )
  )
);
-- nadie escribe desde la app: solo las funciones del servidor
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

-- hasta cuándo leyó cada persona (por negocio)
create table if not exists public.notification_state (
  user_id    uuid not null,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  read_until timestamptz not null default 'epoch',
  primary key (user_id, org_id)
);
alter table public.notification_state enable row level security;
drop policy if exists nstate_select on public.notification_state;
drop policy if exists nstate_insert on public.notification_state;
drop policy if exists nstate_update on public.notification_state;
create policy nstate_select on public.notification_state for select to authenticated using (user_id = auth.uid());
create policy nstate_insert on public.notification_state for insert to authenticated
  with check (user_id = auth.uid() and private.my_role(org_id) is not null);
create policy nstate_update on public.notification_state for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and private.my_role(org_id) is not null);
revoke all on public.notification_state from anon, authenticated;
grant select, insert, update on public.notification_state to authenticated;

-- tiempo real
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------- ayudantes
create or replace function private.money(p_n numeric)
returns text language sql immutable set search_path = public as $$
  select '$ ' || replace(to_char(round(coalesce(p_n, 0)), 'FM999,999,999,990'), ',', '.')
$$;

create or replace function private.member_name(p_org uuid, p_uid text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select m.name from members m where m.org_id = p_org and m.user_id::text = p_uid limit 1), 'alguien')
$$;

create or replace function private.as_uuid(p_text text)
returns uuid language sql immutable set search_path = public as $$
  select case when p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_text::uuid end
$$;

-- Crea un aviso. Limpia lo de más de 30 días de vez en cuando.
create or replace function private.notify(
  p_org uuid, p_branch uuid, p_kind text, p_title text, p_body text, p_data jsonb,
  p_audience text[], p_to uuid default null, p_dedupe text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (org_id, branch_id, kind, title, body, data, audience, to_user, dedupe_key)
  values (p_org, p_branch, p_kind, p_title, coalesce(p_body, ''), coalesce(p_data, '{}'::jsonb), coalesce(p_audience, '{}'), p_to, p_dedupe)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  if random() < 0.02 then
    delete from notifications where created_at < now() - interval '30 days';
  end if;
end $$;

-- ---------------------------------------------------------------- pedidos
create or replace function private.orders_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n          jsonb := new.data;
  o          jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end;
  rops       constant text[] := array['owner', 'admin', 'cajero'];
  v_num      text := coalesce(n ->> 'number', '?');
  v_type     text := coalesce(n ->> 'type', '');
  v_total    numeric := coalesce((n ->> 'total')::numeric, 0);
  v_status   text := coalesce(n ->> 'status', '');
  v_ostatus  text := coalesce(o ->> 'status', '');
  v_paid     boolean := coalesce((n ->> 'paid')::boolean, false);
  v_opaid    boolean := coalesce((o ->> 'paid')::boolean, false);
  v_void     boolean := coalesce((n ->> 'voided')::boolean, false);
  v_ovoid    boolean := coalesce((o ->> 'voided')::boolean, false);
  v_label    text;
  v_units    int;
  v_data     jsonb;
  v_driver   uuid := private.as_uuid(n ->> 'driverId');
  v_odriver  uuid := private.as_uuid(o ->> 'driverId');
  v_creator  uuid := private.as_uuid(n ->> 'userId');
  v_methods  text;
  v_pct      numeric;
begin
  if coalesce((n ->> 'demo')::boolean, false) then return new; end if;

  v_label := case v_type
    when 'mesa' then 'Mesa ' || coalesce(n ->> 'table', '') || case when n ? 'batchNumber' then ' · tanda ' || (n ->> 'batchNumber') else '' end
    when 'delivery' then 'Delivery'
    when 'retiro' then 'Para retirar'
    else 'Mostrador' end;
  if n ? 'web' then v_label := 'Online · ' || v_label; end if;
  v_data := jsonb_build_object('orderId', new.id, 'number', n -> 'number', 'type', v_type, 'view', 'pedidos');
  select coalesce(sum((i ->> 'qty')::numeric), 0)::int into v_units from jsonb_array_elements(coalesce(n -> 'items', '[]'::jsonb)) i;
  select string_agg(distinct p ->> 'method', ', ') into v_methods from jsonb_array_elements(coalesce(n -> 'payments', '[]'::jsonb)) p;

  if tg_op = 'INSERT' then
    -- la cocina se entera de todo pedido nuevo, sin importes
    perform private.notify(new.org_id, new.branch_id, 'order_new', '🔔 Pedido nuevo #' || v_num,
      v_label || ' · ' || v_units || ' producto' || case when v_units = 1 then '' else 's' end, v_data, array['cocina']);
    if v_paid then
      perform private.notify(new.org_id, new.branch_id, 'order_paid', '💸 Venta cobrada #' || v_num,
        v_label || ' · ' || private.money(v_total) || coalesce(' · ' || v_methods, ''), v_data, rops);
    else
      perform private.notify(new.org_id, new.branch_id, 'order_new', '🔔 Pedido nuevo #' || v_num,
        v_label || ' · ' || v_units || ' producto' || case when v_units = 1 then '' else 's' end || ' · ' || private.money(v_total), v_data, rops);
    end if;
    -- descuento grande (20 % o más): lo ve el encargado y el dueño
    v_pct := case when coalesce((n ->> 'subtotal')::numeric, 0) > 0 then coalesce((n ->> 'discountAmount')::numeric, 0) * 100 / (n ->> 'subtotal')::numeric else 0 end;
    if v_pct >= 20 then
      perform private.notify(new.org_id, new.branch_id, 'discount_big', '🏷️ Descuento grande en #' || v_num,
        round(v_pct) || '% (−' || private.money((n ->> 'discountAmount')::numeric) || ') · lo cargó ' || private.member_name(new.org_id, n ->> 'userId'),
        v_data || jsonb_build_object('pct', round(v_pct)), array['owner', 'admin']);
    end if;
    if v_driver is not null and v_type = 'delivery' then
      perform private.notify(new.org_id, new.branch_id, 'order_assigned', '🛵 Te asignaron el pedido #' || v_num,
        coalesce(n ->> 'address', ''), v_data, '{}', v_driver);
    end if;
    return new;
  end if;

  -- ------------------------------------------------ cambios de un pedido existente
  if v_status is distinct from v_ostatus then
    if v_status = 'listo' then
      perform private.notify(new.org_id, new.branch_id, 'order_ready', '✅ Pedido #' || v_num || ' listo', v_label, v_data, rops);
      if v_type = 'mesa' and v_creator is not null then
        perform private.notify(new.org_id, new.branch_id, 'order_ready', '🍽️ ' || v_label || ' lista para servir', 'Pedido #' || v_num, v_data, '{}', v_creator);
      elsif v_type = 'delivery' then
        if v_driver is not null then
          perform private.notify(new.org_id, new.branch_id, 'order_ready', '🛵 Tu pedido #' || v_num || ' está listo para salir', coalesce(n ->> 'address', ''), v_data, '{}', v_driver);
        else
          perform private.notify(new.org_id, new.branch_id, 'order_ready', '🛵 Delivery #' || v_num || ' listo, sin repartidor', coalesce(n ->> 'address', ''), v_data, array['delivery']);
        end if;
      end if;
    elsif v_status = 'en_camino' then
      perform private.notify(new.org_id, new.branch_id, 'order_route', '🛵 Pedido #' || v_num || ' salió',
        v_label || coalesce(' · ' || nullif(n ->> 'driver', ''), ''), v_data, rops);
    elsif v_status = 'entregado' and v_type <> 'mesa' then
      perform private.notify(new.org_id, new.branch_id, 'order_delivered', '🏁 Pedido #' || v_num || ' entregado',
        v_label || case when v_paid then '' else ' · falta cobrar ' || private.money(coalesce((n -> 'collect' ->> 'amount')::numeric, v_total)) end, v_data, rops);
    end if;
  end if;

  if v_paid and not v_opaid then
    if v_type = 'mesa' then
      perform private.notify(new.org_id, new.branch_id, 'order_paid', '💸 ' || v_label || ' cobrada',
        coalesce('Comprobante ' || (n ->> 'ticketNumber'), 'Cuenta de la mesa') || coalesce(' · ' || v_methods, ''), v_data, rops,
        null, 'paid:' || new.branch_id || ':' || coalesce(n ->> 'ticketNumber', new.id));
    else
      perform private.notify(new.org_id, new.branch_id, 'order_paid', '💸 Cobrado #' || v_num,
        v_label || ' · ' || private.money(v_total) || coalesce(' · ' || v_methods, ''), v_data, rops);
    end if;
  end if;

  if v_void and not v_ovoid then
    perform private.notify(new.org_id, new.branch_id, 'order_void', '🚫 Pedido #' || v_num || ' anulado',
      v_label || ' · ' || private.money(v_total) || coalesce(' · motivo: ' || nullif(n ->> 'voidReason', ''), '') || ' · por ' || private.member_name(new.org_id, n ->> 'voidedBy'),
      v_data, array['owner', 'admin']);
    perform private.notify(new.org_id, new.branch_id, 'order_void', '🚫 Pedido #' || v_num || ' cancelado', v_label, v_data, array['cocina']);
    if v_driver is not null then
      perform private.notify(new.org_id, new.branch_id, 'order_void', '🚫 Pedido #' || v_num || ' cancelado', 'Ya no tenés que entregarlo', v_data, '{}', v_driver);
    end if;
  end if;

  if v_driver is not null and v_driver is distinct from v_odriver and v_type = 'delivery' and not v_void then
    perform private.notify(new.org_id, new.branch_id, 'order_assigned', '🛵 Te asignaron el pedido #' || v_num, coalesce(n ->> 'address', ''), v_data, '{}', v_driver);
  end if;

  if coalesce((n ->> 'lateCash')::boolean, false) and not coalesce((o ->> 'lateCash')::boolean, false) then
    perform private.notify(new.org_id, new.branch_id, 'cash_late', '⏰ Cobro después del cierre #' || v_num,
      private.money(v_total) || ' · la caja de ese turno ya estaba cerrada', v_data || jsonb_build_object('view', 'caja'), rops);
  end if;
  return new;
end $$;

drop trigger if exists orders_notify on public.orders;
create trigger orders_notify after insert or update on public.orders
  for each row execute function private.orders_notify();

-- pedidos de la carta online por confirmar
create or replace function private.online_orders_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'nuevo' then
    perform private.notify(new.org_id, new.branch_id, 'web_order', '📲 Pedido online W-' || new.number || ' por confirmar',
      coalesce(new.data ->> 'name', 'Cliente') || ' · ' || private.money(new.total),
      jsonb_build_object('webId', new.id, 'view', 'pedidos'), array['owner', 'admin', 'cajero']);
  end if;
  return new;
end $$;
drop trigger if exists online_orders_notify on public.online_orders;
create trigger online_orders_notify after insert on public.online_orders
  for each row execute function private.online_orders_notify();

-- ---------------------------------------------------------------- caja, stock y cuentas de mesa
create or replace function private.docs_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n      jsonb := new.data;
  o      jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end;
  rops   constant text[] := array['owner', 'admin', 'cajero'];
  v_diff numeric;
  v_tbl  text;
begin
  if coalesce((n ->> 'demo')::boolean, false) then return new; end if;

  if new.col = 'cash_session' then
    if tg_op = 'INSERT' and (n ->> 'closedAt') is null then
      perform private.notify(new.org_id, new.branch_id, 'cash_open', '💰 Caja abierta',
        'Fondo ' || private.money((n ->> 'openingAmount')::numeric) || ' · abrió ' || private.member_name(new.org_id, n ->> 'openedBy'),
        jsonb_build_object('view', 'caja'), rops);
    elsif tg_op = 'UPDATE' and (o ->> 'closedAt') is null and (n ->> 'closedAt') is not null then
      v_diff := coalesce((n ->> 'diff')::numeric, 0);
      -- las diferencias de caja las ven solo el dueño y el encargado
      perform private.notify(new.org_id, new.branch_id, 'cash_close',
        case when v_diff <> 0 then '⚠️ Caja cerrada con diferencia' else '🔒 Caja cerrada' end,
        case when v_diff = 0 then 'Sin diferencia' when v_diff < 0 then 'Faltan ' || private.money(-v_diff) else 'Sobran ' || private.money(v_diff) end
          || ' · esperado ' || private.money((n ->> 'expectedCash')::numeric) || ', contado ' || private.money((n ->> 'countedCash')::numeric)
          || ' · cerró ' || private.member_name(new.org_id, n ->> 'closedBy'),
        jsonb_build_object('view', 'caja', 'diff', v_diff), array['owner', 'admin']);
      perform private.notify(new.org_id, new.branch_id, 'cash_close', '🔒 Caja cerrada', 'Cerró ' || private.member_name(new.org_id, n ->> 'closedBy'),
        jsonb_build_object('view', 'caja'), array['cajero']);
    end if;

  elsif new.col = 'ingredient' then
    if tg_op = 'UPDATE' and (n ->> 'stock') is not null and (n ->> 'min') is not null
       and (n ->> 'stock')::numeric <= (n ->> 'min')::numeric
       and coalesce((o ->> 'stock')::numeric, 0) > (n ->> 'min')::numeric then
      perform private.notify(new.org_id, new.branch_id, 'stock_low', '📦 Stock bajo: ' || coalesce(n ->> 'name', 'insumo'),
        'Quedan ' || (n ->> 'stock') || ' ' || coalesce(n ->> 'unit', '') || ' (mínimo ' || (n ->> 'min') || ')',
        jsonb_build_object('view', 'stock'), rops);
    end if;

  elsif new.col = 'table_session' then
    if coalesce(n ->> 'state', '') = 'cuenta_solicitada' and coalesce(o ->> 'state', '') <> 'cuenta_solicitada' then
      select d.data ->> 'number' into v_tbl from docs d
       where d.org_id = new.org_id and d.col = 'dining_table' and d.id = new.branch_id::text || '/' || (n -> 'tableIds' ->> 0);
      perform private.notify(new.org_id, new.branch_id, 'bill_requested', '🧾 Mesa ' || coalesce(v_tbl, '?') || ' pidió la cuenta',
        coalesce('Mozo: ' || nullif(n ->> 'waiterName', ''), ''), jsonb_build_object('view', 'salon'), rops);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists docs_notify on public.docs;
create trigger docs_notify after insert or update on public.docs
  for each row when (new.col in ('cash_session', 'ingredient', 'table_session'))
  execute function private.docs_notify();

-- ---------------------------------------------------------------- resúmenes del dueño
-- Todas las mañanas (03:00 de Buenos Aires): ventas de ayer y del mes en curso. El día 1, el cierre del mes
-- anterior con la variación contra el mes de antes. Al dueño le llega el del negocio entero (todas las
-- sucursales); a cada encargado, solo el de su sucursal. Nadie más.
create or replace function private.notifications_run_summaries(p_now timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare
  tz       constant text := 'America/Argentina/Buenos_Aires';
  meses    constant text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  v_today  date := (p_now at time zone tz)::date;
  v_yday   date := v_today - 1;
  v_mfirst date := date_trunc('month', v_yday::timestamp)::date;
  v_pfirst date := (v_mfirst - interval '1 month')::date;
  d_from   timestamptz := v_yday::timestamp at time zone tz;
  d_to     timestamptz := v_today::timestamp at time zone tz;
  m_from   timestamptz := v_mfirst::timestamp at time zone tz;
  p_from   timestamptz := v_pfirst::timestamp at time zone tz;
  v_org    record;
  r        record;
  v_lines_d text; v_lines_m text;
  t_dn numeric; t_dt numeric; t_mn numeric; t_mt numeric; t_pt numeric;
  v_made   int := 0;
  v_var    text;
  v_mes    text;
begin
  for v_org in select id from organizations where status = 'active' loop
    t_dn := 0; t_dt := 0; t_mn := 0; t_mt := 0; t_pt := 0; v_lines_d := ''; v_lines_m := '';
    for r in
      select b.id, b.name,
        count(distinct coalesce(x.data ->> 'ticketNumber', x.id)) filter (where x.paid_at >= d_from and x.paid_at < d_to) as dn,
        coalesce(sum(x.total) filter (where x.paid_at >= d_from and x.paid_at < d_to), 0) as dt,
        count(distinct coalesce(x.data ->> 'ticketNumber', x.id)) filter (where x.paid_at >= m_from and x.paid_at < d_to) as mn,
        coalesce(sum(x.total) filter (where x.paid_at >= m_from and x.paid_at < d_to), 0) as mt,
        coalesce(sum(x.total) filter (where x.paid_at >= p_from and x.paid_at < m_from), 0) as pt
      from branches b
      left join orders x on x.branch_id = b.id and x.paid and not x.voided and not x.demo and x.paid_at >= p_from and x.paid_at < d_to
      where b.org_id = v_org.id and b.active
      group by b.id, b.name
      order by b.name
    loop
      t_dn := t_dn + r.dn; t_dt := t_dt + r.dt; t_mn := t_mn + r.mn; t_mt := t_mt + r.mt; t_pt := t_pt + r.pt;
      v_lines_d := v_lines_d || E'\n• ' || r.name || ': ' || private.money(r.dt) || ' (' || r.dn || ' ventas)';
      v_lines_m := v_lines_m || E'\n• ' || r.name || ': ' || private.money(r.mt) || ' (' || r.mn || ' ventas)';
      -- resumen de la sucursal para su encargado
      if r.dn > 0 then
        perform private.notify(v_org.id, r.id, 'summary_day', '📊 Resumen de ayer (' || to_char(v_yday, 'DD/MM') || ')',
          'Ventas: ' || private.money(r.dt) || ' en ' || r.dn || ' (ticket promedio ' || private.money(r.dt / nullif(r.dn, 0)) || ')' || E'\nMes en curso: ' || private.money(r.mt) || ' en ' || r.mn || ' ventas',
          jsonb_build_object('view', 'reportes', 'day', v_yday), array['admin'], null, 'sum_day:' || r.id || ':' || v_yday);
        v_made := v_made + 1;
      end if;
      if v_today = date_trunc('month', v_today::timestamp)::date and r.mn > 0 then
        v_var := case when r.pt > 0 then ' (' || case when r.mt >= r.pt then '+' else '' end || round((r.mt - r.pt) * 100 / r.pt) || '% vs el mes anterior)' else '' end;
        v_mes := meses[extract(month from v_mfirst)::int] || ' ' || extract(year from v_mfirst)::int;
        perform private.notify(v_org.id, r.id, 'summary_month', '📅 Cierre de ' || v_mes,
          'Ventas: ' || private.money(r.mt) || ' en ' || r.mn || v_var, jsonb_build_object('view', 'reportes', 'month', to_char(v_mfirst, 'YYYY-MM')), array['admin'], null,
          'sum_month:' || r.id || ':' || to_char(v_mfirst, 'YYYY-MM'));
        v_made := v_made + 1;
      end if;
    end loop;

    -- el del negocio entero: solo el dueño
    if t_dn > 0 then
      perform private.notify(v_org.id, null, 'summary_day', '📊 Resumen de ayer (' || to_char(v_yday, 'DD/MM') || ')',
        'Ventas: ' || private.money(t_dt) || ' en ' || t_dn || ' (ticket promedio ' || private.money(t_dt / nullif(t_dn, 0)) || ')' || E'\nMes en curso: ' || private.money(t_mt) || ' en ' || t_mn || ' ventas' || E'\n' || trim(leading E'\n' from v_lines_d),
        jsonb_build_object('view', 'n-finanzas', 'day', v_yday), array['owner'], null, 'sum_day:org:' || v_org.id || ':' || v_yday);
      v_made := v_made + 1;
    end if;
    if v_today = date_trunc('month', v_today::timestamp)::date and t_mn > 0 then
      v_var := case when t_pt > 0 then ' (' || case when t_mt >= t_pt then '+' else '' end || round((t_mt - t_pt) * 100 / t_pt) || '% vs el mes anterior)' else '' end;
      v_mes := meses[extract(month from v_mfirst)::int] || ' ' || extract(year from v_mfirst)::int;
      perform private.notify(v_org.id, null, 'summary_month', '📅 Cierre de ' || v_mes,
        'Ventas del negocio: ' || private.money(t_mt) || ' en ' || t_mn || v_var || E'\n' || trim(leading E'\n' from v_lines_m),
        jsonb_build_object('view', 'n-finanzas', 'month', to_char(v_mfirst, 'YYYY-MM')), array['owner'], null, 'sum_month:org:' || v_org.id || ':' || to_char(v_mfirst, 'YYYY-MM'));
      v_made := v_made + 1;
    end if;
  end loop;
  return v_made;
end $$;

revoke all on function private.notifications_run_summaries(timestamptz) from public, anon, authenticated;

-- programado: todos los días a las 06:00 UTC (03:00 en Buenos Aires)
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'notificaciones-resumenes';
select cron.schedule('notificaciones-resumenes', '0 6 * * *', 'select private.notifications_run_summaries()');
