# CADS Standalone Acceptance

## Zweck

Dieses Gate bewertet den eigenständigen CADS-Produkt-Snapshot. Vergleichsbenchmarks der Event-Backbone-Infrastruktur sind **nicht** Teil dieses Gates.

Insbesondere werden keine erfolgreichen NATS-, Kafka-, Go-, Rust- oder Node-Vergleichsergebnisse behauptet. Der frühere NATS/Go-Pfad ist keine gültige CADS-Release-Evidence.

## Verbindliche Prüfungen

1. CADS Tier- und Capability-Vertrag.
2. GitHub-Marketplace Plan-Mapping.
3. Marketplace Webhook-HMAC, OAuth-State und autoritativer Subscription-Readback.
4. Supabase RLS-/Service-Role-/Idempotenz-Grenzen.
5. Commerce-Entitlement fail-closed.
6. Source-/Transformation-Provenance.
7. Lizenz-, Privacy-, Support- und Security-Dokumentgrenzen.
8. Secret-like-material scan der erzeugten Evidence.

## Nicht durch dieses Gate freigegeben

- Security-Freigabe;
- Lizenz-/Legal-Freigabe;
- Production-Freigabe;
- GitHub-Marketplace-Listing-Freigabe;
- Performance-SLA;
- Event-Backbone-/NATS-/Go-Eignung.

Diese Freigaben bleiben separat.
