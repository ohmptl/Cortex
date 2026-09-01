# Cortex remote MCP

## Endpoint and transport

The production endpoint is:

```text
https://cortex.ohmptl.com/api/mcp
```

It uses stateless MCP Streamable HTTP. `POST` handles JSON-RPC requests; standalone `GET` streams and legacy HTTP+SSE are not enabled. The server validates protocol messages through the official TypeScript SDK and rejects unapproved browser origins.

## Authentication

Cortex uses the Supabase OAuth 2.1 server with Authorization Code + PKCE, dynamic client registration, explicit user consent, and RLS-bound access tokens.

In the Supabase dashboard:

1. Enable Authentication → OAuth Server.
2. Enable dynamic client registration and require consent.
3. Set Authorization Path to `/oauth/consent`.
4. Use an asymmetric JWT signing key.
5. Configure the application Site URL to the Cortex deployment.
6. Add a Custom Access Token Hook that assigns the Cortex endpoint as the audience for OAuth-issued tokens.

Production hook:

```sql
create or replace function public.cortex_mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare claims jsonb;
begin
  claims := event->'claims';
  if claims ? 'client_id' then
    claims := jsonb_set(claims, '{aud}', to_jsonb('https://cortex.ohmptl.com/api/mcp'::text));
  end if;
  return jsonb_build_object('claims', claims);
end;
$$;

grant execute on function public.cortex_mcp_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.cortex_mcp_access_token_hook(jsonb) from authenticated, anon, public;
```

Select this function as the Custom Access Token Hook. Cortex requires the verified token to contain both `client_id` and the exact `MCP_RESOURCE_URL` audience. Ordinary browser session tokens are rejected at the MCP boundary.

Supabase currently supports the standard `openid`, `email`, `profile`, and `phone` identity scopes; it does not yet support custom `mcp:tools` scopes. Cortex therefore uses consent, audience validation, `client_id`, domain validation, and RLS for authorization.

Protected-resource metadata is available at:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/api/mcp
```

Supabase authorization-server discovery is available at:

```text
https://PROJECT_REF.supabase.co/.well-known/oauth-authorization-server/auth/v1
```

## Tools

Read tools:

- `get_today`, `get_upcoming`
- `list_courses`, `get_course`
- `list_academic_items`, `get_academic_item`, `get_calendar_range`
- `get_course_gradebook`, `get_grade_item`
- `search_academic_context`

Safe write tools:

- `create_manual_item`
- `update_item_override`, `clear_item_override`
- `mark_item_complete`
- `add_note`, `add_tag`, `schedule_review`
- `trigger_moodle_sync`

No tool can modify or delete `raw_source_records` or their version history. Updating a provider-derived field creates an override.

## Connect a client

Give an MCP-compatible client the HTTPS endpoint above and choose OAuth authentication. The client discovers Cortex protected-resource metadata, discovers Supabase OAuth, dynamically registers when supported, opens the Cortex consent screen, and stores the resulting access/refresh tokens.

For an OpenAI Responses API integration, configure a remote MCP tool with a stable `server_label`, the Cortex `server_url`, and the OAuth access token in `authorization`. Keep approvals enabled for write tools. See the current [OpenAI MCP guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp).

## Deployment checks

- `MCP_RESOURCE_URL` exactly matches the public endpoint and token-hook audience.
- `MCP_ALLOWED_ORIGINS` contains only intended browser clients.
- OAuth Server, DCR, consent path, and asymmetric signing are enabled.
- The protected-resource and Supabase discovery documents are publicly reachable.
- An OAuth token can initialize MCP and an ordinary Supabase browser token cannot.
- Read results match the Cortex UI; deadline writes create `field_overrides` rows.
