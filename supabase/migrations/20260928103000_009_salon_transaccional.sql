-- v9 · Salón: entidades explícitas y comandos idempotentes.
-- Los documentos JSON siguen siendo la caché/offline de la app; estas tablas
-- son la fuente de verdad cuando una terminal está conectada.

create table public.dining_areas (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade, name text not null check (length(btrim(name)) between 1 and 60), position int not null default 0,
  unique (branch_id, name)
);
create table public.dining_tables (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade, area_id uuid not null references public.dining_areas(id) on delete restrict,
  number text not null check (length(btrim(number)) between 1 and 20), capacity smallint not null default 4 check (capacity between 1 and 100),
  shape text not null default 'round' check (shape in ('round','square','rect')), x numeric not null default 50, y numeric not null default 50,
  active boolean not null default true, unique(branch_id, number)
);
create table public.table_sessions (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade, state text not null default 'ocupada' check (state in ('ocupada','cuenta_solicitada','limpieza','cerrada')),
  guests smallint not null default 0 check (guests >= 0), opened_by uuid references auth.users(id), opened_at timestamptz not null default now(),
  requested_bill_at timestamptz, closed_at timestamptz, version bigint not null default 1
);
create table public.table_session_tables (
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  table_id uuid not null references public.dining_tables(id) on delete restrict, attached_at timestamptz not null default now(), detached_at timestamptz,
  primary key(session_id, table_id, attached_at)
);
create unique index table_one_active_session on public.table_session_tables(table_id) where detached_at is null;
create table public.order_batches (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade, session_id uuid not null references public.table_sessions(id) on delete cascade,
  operation_key text not null, number int not null, sent_by uuid references auth.users(id), sent_at timestamptz not null default now(),
  unique(session_id, number), unique(branch_id, operation_key)
);
create table public.order_batch_orders (
  batch_id uuid not null references public.order_batches(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade, order_id text not null,
  primary key(batch_id, order_id), foreign key(org_id, order_id) references public.orders(org_id, id) on delete restrict
);
create table public.dining_operations (
  branch_id uuid not null references public.branches(id) on delete cascade, operation_key text not null,
  result jsonb not null, created_at timestamptz not null default now(), primary key(branch_id, operation_key)
);

create trigger dining_areas_branch_org_guard before insert or update of org_id, branch_id on public.dining_areas for each row execute function private.assert_branch_org();
create trigger dining_tables_branch_org_guard before insert or update of org_id, branch_id on public.dining_tables for each row execute function private.assert_branch_org();
create trigger table_sessions_branch_org_guard before insert or update of org_id, branch_id on public.table_sessions for each row execute function private.assert_branch_org();
create trigger order_batches_branch_org_guard before insert or update of org_id, branch_id on public.order_batches for each row execute function private.assert_branch_org();

alter table public.dining_areas enable row level security; alter table public.dining_tables enable row level security;
alter table public.table_sessions enable row level security; alter table public.table_session_tables enable row level security;
alter table public.order_batches enable row level security; alter table public.order_batch_orders enable row level security; alter table public.dining_operations enable row level security;
create policy dining_areas_read on public.dining_areas for select to authenticated using (private.can_branch(org_id, branch_id));
create policy dining_tables_read on public.dining_tables for select to authenticated using (private.can_branch(org_id, branch_id));
create policy table_sessions_read on public.table_sessions for select to authenticated using (private.can_branch(org_id, branch_id));
create policy table_session_tables_read on public.table_session_tables for select to authenticated using (exists(select 1 from table_sessions s where s.id=session_id and private.can_branch(s.org_id,s.branch_id)));
create policy order_batches_read on public.order_batches for select to authenticated using (private.can_branch(org_id, branch_id));
create policy order_batch_orders_read on public.order_batch_orders for select to authenticated using (exists(select 1 from order_batches b where b.id=batch_id and private.can_branch(b.org_id,b.branch_id)));
revoke insert,update,delete on public.dining_areas,public.dining_tables,public.table_sessions,public.table_session_tables,public.order_batches,public.order_batch_orders,public.dining_operations from authenticated;

create or replace function private.dining_allowed(p_org uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select private.my_role(p_org) in ('owner','admin','cajero') and private.can_branch(p_org,p_branch)
$$;

create or replace function public.dining_open_session(p_branch uuid, p_table uuid, p_guests int, p_operation text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t dining_tables%rowtype; s table_sessions%rowtype; prior jsonb;
begin
  select result into prior from dining_operations where branch_id=p_branch and operation_key=p_operation; if found then return prior; end if;
  select * into t from dining_tables where id=p_table and branch_id=p_branch and active for update;
  if not found or not private.dining_allowed(t.org_id,p_branch) then raise exception 'Sin permiso o mesa inexistente' using errcode='42501'; end if;
  if exists(select 1 from table_session_tables st join table_sessions x on x.id=st.session_id where st.table_id=p_table and st.detached_at is null and x.closed_at is null) then raise exception 'La mesa ya tiene una cuenta abierta' using errcode='23505'; end if;
  insert into table_sessions(org_id,branch_id,guests,opened_by) values(t.org_id,p_branch,greatest(0,p_guests),auth.uid()) returning * into s;
  insert into table_session_tables(session_id,table_id) values(s.id,p_table);
  prior:=jsonb_build_object('id',s.id,'tableId',p_table,'state',s.state,'guests',s.guests,'openedAt',s.opened_at,'version',s.version);
  insert into dining_operations(branch_id,operation_key,result) values(p_branch,p_operation,prior); return prior;
end $$;

create or replace function public.dining_move_session(p_session uuid, p_to_table uuid, p_expected_version bigint, p_operation text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s table_sessions%rowtype; t dining_tables%rowtype; prior jsonb;
begin
  select * into s from table_sessions where id=p_session for update; if not found or s.closed_at is not null or not private.dining_allowed(s.org_id,s.branch_id) then raise exception 'Cuenta no disponible' using errcode='42501'; end if;
  select result into prior from dining_operations where branch_id=s.branch_id and operation_key=p_operation; if found then return prior; end if;
  if s.version<>p_expected_version then raise exception 'La cuenta cambió en otro equipo; actualizá la pantalla' using errcode='40001'; end if;
  select * into t from dining_tables where id=p_to_table and branch_id=s.branch_id and active for update; if not found then raise exception 'Mesa destino inexistente'; end if;
  if exists(select 1 from table_session_tables st join table_sessions x on x.id=st.session_id where st.table_id=p_to_table and st.detached_at is null and x.closed_at is null) then raise exception 'La mesa destino está ocupada' using errcode='23505'; end if;
  update table_session_tables set detached_at=now() where session_id=s.id and detached_at is null;
  insert into table_session_tables(session_id,table_id) values(s.id,p_to_table);
  update table_sessions set version=version+1 where id=s.id returning * into s;
  prior:=jsonb_build_object('id',s.id,'tableId',p_to_table,'version',s.version); insert into dining_operations(branch_id,operation_key,result) values(s.branch_id,p_operation,prior); return prior;
end $$;

create or replace function public.dining_close_session(p_session uuid, p_expected_version bigint, p_operation text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s table_sessions%rowtype; prior jsonb;
begin
  select * into s from table_sessions where id=p_session for update; if not found or not private.dining_allowed(s.org_id,s.branch_id) then raise exception 'Cuenta no disponible' using errcode='42501'; end if;
  select result into prior from dining_operations where branch_id=s.branch_id and operation_key=p_operation; if found then return prior; end if;
  if s.version<>p_expected_version then raise exception 'La cuenta cambió en otro equipo; actualizá la pantalla' using errcode='40001'; end if;
  if exists(select 1 from order_batch_orders bo join orders o on o.org_id=bo.org_id and o.id=bo.order_id join order_batches b on b.id=bo.batch_id where b.session_id=s.id and not o.paid and not o.voided) then raise exception 'No se puede cerrar con saldo pendiente'; end if;
  update table_sessions set state='limpieza',closed_at=now(),version=version+1 where id=s.id returning * into s;
  update table_session_tables set detached_at=now() where session_id=s.id and detached_at is null;
  prior:=jsonb_build_object('id',s.id,'state',s.state,'closedAt',s.closed_at,'version',s.version); insert into dining_operations(branch_id,operation_key,result) values(s.branch_id,p_operation,prior); return prior;
end $$;

-- Crea la tanda, el pedido y los movimientos de stock en una sola transacción.
-- Reintentar con la misma clave devuelve el mismo resultado.
create or replace function public.dining_add_batch(p_session uuid, p_order jsonb, p_expected_version bigint, p_operation text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s table_sessions%rowtype; b order_batches%rowtype; prior jsonb; v_order_id text := p_order ->> 'id'; v_number int;
begin
  select * into s from table_sessions where id=p_session for update;
  if not found or s.closed_at is not null or not private.dining_allowed(s.org_id,s.branch_id) then raise exception 'Cuenta no disponible' using errcode='42501'; end if;
  select result into prior from dining_operations where branch_id=s.branch_id and operation_key=p_operation; if found then return prior; end if;
  if s.version<>p_expected_version then raise exception 'La cuenta cambió en otro equipo; actualizá la pantalla' using errcode='40001'; end if;
  if coalesce(v_order_id,'')='' or jsonb_typeof(p_order->'items')<>'array' or jsonb_array_length(p_order->'items')=0 then raise exception 'Tanda inválida'; end if;
  select coalesce(max(number),0)+1 into v_number from order_batches where session_id=s.id;
  insert into order_batches(org_id,branch_id,session_id,operation_key,number,sent_by) values(s.org_id,s.branch_id,s.id,p_operation,v_number,auth.uid()) returning * into b;
  insert into orders(org_id,id,branch_id,data) values(s.org_id,v_order_id,s.branch_id,
    p_order || jsonb_build_object('type','mesa','tableSessionId',s.id,'batchNumber',v_number,'table',coalesce(p_order->>'table',''), 'paid',false,'voided',false));
  perform private.consume_order_stock(s.org_id,s.branch_id,v_order_id,p_order->'items');
  insert into order_batch_orders(batch_id,org_id,order_id) values(b.id,s.org_id,v_order_id);
  update table_sessions set state='ocupada',version=version+1 where id=s.id returning * into s;
  prior:=jsonb_build_object('id',b.id,'number',b.number,'orderId',v_order_id,'sessionId',s.id,'version',s.version);
  insert into dining_operations(branch_id,operation_key,result) values(s.branch_id,p_operation,prior); return prior;
end $$;

revoke all on function public.dining_open_session(uuid,uuid,int,text), public.dining_move_session(uuid,uuid,bigint,text), public.dining_close_session(uuid,bigint,text), public.dining_add_batch(uuid,jsonb,bigint,text) from public,anon;
grant execute on function public.dining_open_session(uuid,uuid,int,text), public.dining_move_session(uuid,uuid,bigint,text), public.dining_close_session(uuid,bigint,text), public.dining_add_batch(uuid,jsonb,bigint,text) to authenticated;
alter publication supabase_realtime add table public.dining_areas, public.dining_tables, public.table_sessions, public.table_session_tables, public.order_batches;
