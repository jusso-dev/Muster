# ADR 0002: Sortable identifiers and tenant isolation

Status: Accepted  
Date: 2026-07-26

Muster uses UUIDv7 application-generated identifiers. Every tenant-owned table includes `organisation_id`. Repositories require organisation context and include it in every lookup and mutation predicate. Foreign keys preserve referential integrity; compound unique constraints prevent tenant-local duplicates.

API responses return `404` for cross-tenant object identifiers to avoid disclosing existence. Workers reload authoritative records by both organisation and object ID. Security tests attempt direct-object-reference and mismatched-job attacks.
