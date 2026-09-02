-- Cortex V2 canonical schema entrypoint for psql.
-- Supabase CLI deployments use the ordered files in supabase/migrations/.
\set ON_ERROR_STOP on
\ir migrations/202608310001_v2_connections.sql
\ir migrations/202608310002_v2_ingestion.sql
\ir migrations/202608310003_v2_domain.sql
\ir migrations/202608310004_v2_gradebook_provenance_search.sql
\ir migrations/202608310005_v2_security_runtime.sql
\ir migrations/202609010006_deadline_sync_priority.sql
\ir migrations/202609010007_merge_calendar_identity_duplicates.sql
\ir migrations/202609010008_completion_projection.sql
\ir migrations/202609010009_mcp_oauth_audience_hook.sql
\ir migrations/202609010010_three_domain_foundation.sql
