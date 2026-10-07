# CADS Security Boundary

Status: **STAGING / TRUST REVIEW REQUIRED**

## Assets protected

- GitHub App private key.
- Marketplace webhook secret.
- GitHub OAuth client secret.
- OAuth state signing secret.
- Marketplace plan IDs as configuration authority.
- Supabase service-role secret.
- GitHub account/installation ↔ CAPITAL-AI user binding.
- CADS evidence and customer entitlement metadata.

No secret value belongs in Git, logs, benchmark reports, Marketplace screenshots or support tickets.

## Trust boundaries

### GitHub Marketplace webhook

- HTTPS endpoint.
- bounded JSON body;
- HMAC-SHA256 verification before event processing;
- accepted event: `marketplace_purchase`;
- accepted actions: `purchased`, `changed`, `cancelled`;
- delivery ID is the idempotency key;
- purchase/plan-change activation requires authoritative GitHub API readback.

### Buyer OAuth link

- installation ID is bounded and validated;
- user must already be authenticated in CAPITAL-AI;
- state is signed, expires after ten minutes and is tied to user + installation;
- callback state must match the HttpOnly/Secure/SameSite cookie;
- GitHub installation ownership is verified;
- temporary OAuth token is revoked before permanent account linkage;
- OAuth token is not stored.

### Supabase

- Marketplace tables use RLS;
- anon/authenticated access is explicitly denied;
- service role accesses narrowly scoped security-definer RPCs;
- raw webhook bodies, app private keys, OAuth tokens and secrets are not persisted;
- cancelled customer data has a <30-day purge path.

## Least privilege GitHub App

Current requested permissions:

- metadata: read
- contents: read
- pull_requests: read
- checks: write

Any new permission is a new TRUST review and Marketplace disclosure change.

## Abuse controls still required for dedicated deployment

Before standalone production:

- endpoint rate limits / bounded concurrency for externally reachable CADS APIs;
- tenant-isolation tests across two organizations;
- replay tests for duplicate and reordered Marketplace events;
- webhook redelivery handling;
- GitHub API timeout/rate-limit/backoff evidence;
- Supabase outage and recovery tests;
- structured log redaction test;
- dedicated CADS container non-root/read-only/cap-drop;
- SBOM, vulnerability scan and reachability review;
- dependency and base-image pinning;
- secret rotation/runbook;
- incident response and customer support process.

## Authority boundary

A successful unit test, benchmark, HMAC check or vulnerability scan does not automatically grant
security approval. TRUST approval is separate and must bind the exact release SHA/artifact digest.
