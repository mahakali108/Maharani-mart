-- ============================================================================
-- ROLLBACK for 0084 — REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- Stops the AI-only 14-day cleanup. Because deletion is irreversible, the
-- rollback cannot restore deleted rows; it only stops future runs.
--
-- IMPORTANT: also remove the /api/cron/ai-cleanup entry from vercel.json, or
-- the scheduler will keep calling a function that no longer exists (the route
-- would then return a 500 on each tick). Removing the cron entry is a
-- deployment-config change and needs owner approval.
-- ============================================================================

begin;

revoke execute on function public.run_ai_data_cleanup(boolean, text, int, int) from service_role;
drop function if exists public.run_ai_data_cleanup(boolean, text, int, int);

-- Audit history of past runs is retained deliberately (operational evidence).
-- drop table if exists public.ai_cleanup_runs;
-- drop table if exists public.ai_retention_rules;

commit;
