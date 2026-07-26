# Upgrade process

Read release notes and connector compatibility first. Back up PostgreSQL and evidence metadata. Test the new image against a restored staging copy with mocks disabled only for dedicated non-production connector instances.

Run migration verification, tenant-boundary tests, workflow parsing, MSEP compatibility, and connector health. Apply additive database migrations before rolling web/worker/gateway processes. Keep the previous image available until queue age, SSE, search, audit chain, and the required demonstration workflow are healthy.

Downgrade only when release notes declare it safe. Database migrations and published workflow/agent versions may require forward repair rather than binary rollback.
