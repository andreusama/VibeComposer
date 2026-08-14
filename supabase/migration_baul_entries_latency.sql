-- Adds baul_entries.latency_ms — real per-call telemetry for the Muse Eye
-- panel's baúl tab, same spirit as askMuse's _debug.latencyMs. Run this
-- once against the live database (after migration_baul_entries.sql, if you
-- haven't already run that one); safe to re-run.

alter table baul_entries add column if not exists latency_ms integer;
