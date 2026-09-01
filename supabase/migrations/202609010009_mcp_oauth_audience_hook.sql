create or replace function public.cortex_mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
begin
  claims := event -> 'claims';

  -- Supabase invokes this hook for every token issuance. Only OAuth client
  -- tokens contain client_id; regular Cortex browser sessions keep their
  -- normal `authenticated` audience.
  if claims ? 'client_id' then
    claims := jsonb_set(
      claims,
      '{aud}',
      to_jsonb('https://cortex.ohmptl.com/api/mcp'::text)
    );
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.cortex_mcp_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.cortex_mcp_access_token_hook(jsonb) from authenticated, anon, public;
