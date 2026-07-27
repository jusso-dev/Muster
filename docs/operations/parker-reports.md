# Parker report schedules

Administrators create organisation-scoped weekly or monthly Parker schedules at
`POST /api/v1/reports/schedules`. Each schedule records its IANA timezone,
audience, room, next-run time, and idempotency key in PostgreSQL.

The worker locks due schedules, advances the next run atomically, and creates
one Parker-assigned review task with a durable outbox/audit event. Duplicate
ticks cannot create a second task for the same scheduled occurrence. The task
is delegated through the normal governed Parker flow, which produces the
reproducible manifest, review/version, room post, and separately approved email
delivery. No SMTP transport is assumed or claimed without a configured connector.
