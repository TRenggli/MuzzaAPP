-- ============================================================================
-- La carta pública tardaba mucho en abrir en los celulares: el logo del
-- ticket estaba guardado como un PNG de ~500 KB dentro de la configuración y
-- viajaba entero en cada apertura (era el 98% de la respuesta).
--
--   · La carta usa la versión chica del logo (ticket.logoSmall) si existe.
--   · Nunca manda una imagen incrustada pesada (más de 80 KB): en ese caso la
--     carta abre sin logo hasta que el encargado entre al sistema, que lo
--     aliviana solo.
-- ============================================================================

-- Una imagen incrustada (data:) pesada no se manda; los links (https) sí
create or replace function private.light_image(p_src text)
returns text language sql immutable set search_path = public as $$
  select case when p_src is null or p_src = '' then null
              when p_src like 'data:%' and length(p_src) > 80000 then null
              else p_src end
$$;

create or replace function private.carta_data(p_branch uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with b as (
    select br.id, br.org_id, br.name, br.slug, br.settings, o.name as org_name, o.features
    from branches br join organizations o on o.id = br.org_id
    where br.id = p_branch
  ),
  d as (
    select x.col, substring(x.id from position('/' in x.id) + 1) as lid, x.data
    from docs x join b on x.org_id = b.org_id and x.branch_id = b.id
    where x.col in ('category', 'product', 'extra')
  ),
  prods as (
    select * from d
    where col = 'product'
      and coalesce((data ->> 'active')::boolean, true)
      and coalesce((data ->> 'online')::boolean, true)
  )
  select jsonb_build_object(
    'branch', (select jsonb_build_object('id', id, 'name', name, 'slug', slug, 'org', org_name) from b),
    'settings', (select jsonb_build_object(
        'business', jsonb_build_object(
            'name', settings #>> '{business,name}', 'slogan', settings #>> '{business,slogan}',
            'address', settings #>> '{business,address}', 'city', settings #>> '{business,city}',
            'phone', settings #>> '{business,phone}', 'instagram', settings #>> '{business,instagram}'),
        'online', coalesce(settings -> 'online', '{}'::jsonb),
        'halfPricing', coalesce(settings ->> 'halfPricing', 'max'),
        'zones', case when features ->> 'delivery' = 'false' then '[]'::jsonb
                      else coalesce((select jsonb_agg(jsonb_build_object('id', z ->> 'id', 'name', z ->> 'name', 'fee', coalesce((z ->> 'fee')::numeric, 0)))
                                     from jsonb_array_elements(coalesce(settings -> 'zones', '[]'::jsonb)) z), '[]'::jsonb) end,
        'transfer', case when coalesce((settings #>> '{online,payments,transferencia}')::boolean, false)
                         then jsonb_build_object('alias', settings #>> '{payments,alias}', 'cbu', settings #>> '{payments,cbu}',
                                                 'holder', settings #>> '{payments,holder}', 'bank', settings #>> '{payments,bank}')
                         else null end,
        'logo', coalesce(private.light_image(settings #>> '{online,logo}'),
                         case when coalesce((settings #>> '{ticket,showLogo}')::boolean, true)
                              then coalesce(private.light_image(settings #>> '{ticket,logoSmall}'),
                                            private.light_image(settings #>> '{ticket,logo}')) end)
      ) from b),
    'open', (select private.carta_open(coalesce(settings -> 'online', '{}'::jsonb)) from b),
    'categories', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.lid, 'name', c.data ->> 'name', 'icon', coalesce(c.data ->> 'icon', '🍽️'),
                                            'allowHalf', coalesce((c.data ->> 'allowHalf')::boolean, false))
                         order by coalesce((c.data ->> '_i')::int, 100000))
        from d c where c.col = 'category' and exists (select 1 from prods p where p.data ->> 'categoryId' = c.lid)), '[]'::jsonb),
    'products', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', p.lid, 'categoryId', p.data ->> 'categoryId', 'name', p.data ->> 'name',
                 'desc', coalesce(p.data ->> 'desc', ''), 'color', p.data ->> 'color', 'photo', private.light_image(p.data ->> 'photo'),
                 'photoPos', p.data ->> 'photoPos', 'active', true,
                 'allowHalf', coalesce((p.data ->> 'allowHalf')::boolean, true),
                 'halfWith', case when jsonb_typeof(p.data -> 'halfWith') = 'array' then p.data -> 'halfWith' else null end,
                 'variants', (select coalesce(jsonb_agg(jsonb_build_object('id', v ->> 'id', 'name', v ->> 'name', 'price', coalesce((v ->> 'price')::numeric, 0))), '[]'::jsonb)
                              from jsonb_array_elements(coalesce(p.data -> 'variants', '[]'::jsonb)) v))
                 order by coalesce((p.data ->> '_i')::int, 100000))
        from prods p where jsonb_array_length(coalesce(p.data -> 'variants', '[]'::jsonb)) > 0), '[]'::jsonb),
    'extras', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.lid, 'name', x.data ->> 'name', 'price', coalesce((x.data ->> 'price')::numeric, 0))
                         order by coalesce((x.data ->> '_i')::int, 100000))
        from d x where x.col = 'extra'), '[]'::jsonb)
  )
$$;

revoke all on function private.light_image(text) from public, anon;
grant execute on function private.light_image(text) to authenticated;
