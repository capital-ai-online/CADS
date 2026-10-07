# CADS Marketplace Privacy Disclosure

Status: **LISTING DRAFT / OWNER-LEGAL REVIEW REQUIRED**

This document describes the data flow implemented by the current CADS Marketplace staging slice.
It is not a substitute for the public CAPITAL-AI privacy notice and must be reconciled with that
notice before Marketplace submission.

## Data processed for Marketplace entitlement

CADS may process and persist the minimum metadata required to bind a GitHub Marketplace purchase to
a CADS customer:

- GitHub Marketplace account ID;
- bounded account login and account type;
- Marketplace plan ID and mapped CADS tier;
- entitlement status and effective/cancellation timestamps;
- GitHub App installation ID;
- CAPITAL-AI/Supabase user ID for the verified buyer link;
- Marketplace delivery ID for idempotency;
- SHA-256 of the webhook payload for integrity evidence.

The entitlement tables do not require storage of raw repository source code, GitHub App private
keys, Marketplace webhook secrets, OAuth access tokens or raw Marketplace webhook bodies.

## OAuth token handling

A temporary GitHub OAuth token is used only to verify that the authenticated CAPITAL-AI user can
access the referenced GitHub App installation. The current implementation revokes that token before
persisting the permanent user↔installation link. The token must not be logged or stored.

## Repository access

The current GitHub App permission target is:

- metadata: read;
- contents: read;
- pull requests: read;
- checks: write.

Any broader permission requires a new privacy/security review and updated Marketplace disclosure.

## Retention and cancellation

Cancellation deactivates the entitlement. The current cleanup boundary is 29 days, intentionally
inside GitHub's 30-day maximum customer-data removal requirement after cancellation.

The production system must evidence that scheduled cleanup actually runs and removes the intended
customer data.

## Processors / external services

The deployment may use GitHub and Supabase as external service providers. Their independent terms
and privacy obligations continue to apply.

## Customer rights / contact

The final Marketplace listing must link to the canonical public privacy notice and a working
support/privacy contact. Current CAPITAL-AI support contact: `support@capital-ai.online`.

No production privacy approval is granted by this draft.
