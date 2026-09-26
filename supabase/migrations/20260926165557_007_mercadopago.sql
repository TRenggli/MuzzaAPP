-- ============================================================================
-- v5 · Mercado Pago: cobro con QR dinámico (el monto va solo al QR y el
-- pago se acredita automáticamente en el sistema).
--
--   mp_accounts  cuenta de Mercado Pago de cada negocio. El Access Token
--                NUNCA sale del servidor: nadie de la app lo puede leer.
--   mp_pos       sucursal y caja creadas en Mercado Pago para cada sucursal.
--   mp_payments  cada QR generado y su estado (para conciliar).
--
-- Todo lo escribe la función "mp" con la clave de servicio.
-- ============================================================================

create table public.mp_accounts (
  org_id        uuid primary key references public.organizations(id) on delete cascade,
  access_token  text not null,
  mp_user_id    bigint not null,
  nickname      text not null default '',
  site_id       text not null default '',
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.mp_pos (
  branch_id          uuid primary key references public.branches(id) on delete cascade,
  org_id             uuid not null references public.organizations(id) on delete cascade,
  store_id           text not null,
  external_store_id  text not null,
  pos_id             text not null,
  external_pos_id    text not null,
  created_at         timestamptz not null default now()
);

create table public.mp_payments (
  id                  text primary key,               -- id de la order de Mercado Pago
  org_id              uuid not null references public.organizations(id) on delete cascade,
  branch_id           uuid not null references public.branches(id) on delete cascade,
  external_reference  text not null,
  amount              numeric not null,
  status              text not null,
  status_detail       text,
  payment_id          text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index mp_payments_branch_idx on public.mp_payments (branch_id, created_at desc);

alter table public.mp_accounts enable row level security;
alter table public.mp_pos enable row level security;
alter table public.mp_payments enable row level security;

-- Cuentas y cajas: sin políticas (solo el servidor). Pagos: los ve la sucursal.
revoke all on public.mp_accounts, public.mp_pos from anon, authenticated;
revoke all on public.mp_payments from anon, authenticated;
grant select on public.mp_payments to authenticated;
create policy mpp_select on public.mp_payments for select to authenticated
  using (private.can_branch(org_id, branch_id));
