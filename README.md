# CAPITAL-AI CADS

Standalone-Staging-Repository für **CAPITAL-AI Decision Score (CADS)**.

Quelle: `SvenKulessa/Capital-AI@0276d389412f806d2727c6b7b65d8215c703dbb1`.

## Produktgrenze

Im Repository liegen CADS-Tier-/Entitlement-Logik, GitHub-Marketplace-Integration, Commerce-Grenzen, Supabase-Entitlement-Persistenz sowie Security-/Lizenz-/Privacy-Evidence.

**Nicht enthalten und nicht als Evidence behauptet:** Event-Backbone-Vergleichsbenchmarks, NATS/Go-, Kafka-, Rust-/Node-Vergleiche. Der nicht erfolgreiche NATS/Go-Pfad ist ausdrücklich kein CADS-Release-Signal.

## Prüfung

```bash
npm run test:cads-acceptance
npm run evidence:cads-export
```

Ein grüner Test ist keine automatische Security-, Lizenz-, Production- oder Marketplace-Freigabe.
