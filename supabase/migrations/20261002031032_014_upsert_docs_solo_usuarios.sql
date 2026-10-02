-- upsert_docs ya rechazaba a quien no inició sesión (no tiene rol en ningún
-- negocio), pero no hay motivo para exponerla sin sesión: se cierra.
revoke all on function public.upsert_docs(jsonb) from public, anon;
grant execute on function public.upsert_docs(jsonb) to authenticated;
