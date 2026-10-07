# CADS GitHub Marketplace — Installation, Anbindung und Konfiguration

Status: **PRE-PUBLICATION RUNBOOK**

Primary domain: PRODUCT  
Assurance: TRUST

## 1. Voraussetzungen für den Publisher

Zielgruppe der produktiven Pläne: **B2B / GitHub-Organisationen only**. Persönliche Accounts sind im CADS-Planvertrag nicht vorgesehen.

Für einen bezahlten GitHub-Marketplace-Plan müssen vor Veröffentlichung extern belegt sein:

1. CADS GitHub App gehört einer GitHub-Organisation.
2. Der veröffentlichende Benutzer besitzt Owner-Rechte in dieser Organisation.
3. Die Organisation ist Verified Publisher.
4. Die GitHub App hat die für Paid Listing erforderliche Installationsschwelle erreicht.
5. Financial Onboarding ist abgeschlossen.
6. Marketplace Listing Review ist genehmigt.
7. Starter, Pro und Enterprise haben monatliche **und** jährliche USD-Preise im Marketplace.
8. Die realen Marketplace Plan IDs sind als Runtime-Secrets/Environment-Konfiguration gebunden.

Diese Punkte werden nicht durch Repository-Tests ersetzt.

## 2. GitHub App Registrierung

Kanonische Vorlage:

`apps/cads-github-app/github-app-registration.production.example.json`

Minimalrechte:

- Metadata: read
- Contents: read
- Pull requests: read
- Checks: write

Keine Repository-Write-, Actions-, Administration-, Secrets-, Members- oder Workflow-Write-Rechte
dürfen ohne neue Capability- und TRUST-Prüfung ergänzt werden.

Produktive URLs:

- Homepage: `https://capital-ai.online`
- Marketplace webhook: `https://capital-ai.online/api/integrations/github/cads-marketplace`
- Setup URL: `https://capital-ai.online/api/cads/marketplace/setup`
- OAuth callback: `https://capital-ai.online/api/cads/marketplace/oauth/callback`

Der Marketplace-Plan-Webhook wird **auf der Marketplace-Listing-Seite separat** konfiguriert.

## 3. Erforderliche Runtime-Konfiguration

Folgende Werte müssen außerhalb von Git als Secret/Environment-Konfiguration vorhanden sein:

```text
CADS_GITHUB_APP_ID
CADS_GITHUB_APP_PRIVATE_KEY
CADS_GITHUB_CLIENT_ID
CADS_GITHUB_CLIENT_SECRET
CADS_GITHUB_MARKETPLACE_WEBHOOK_SECRET
CADS_GITHUB_OAUTH_STATE_SECRET
CADS_GITHUB_MARKETPLACE_OWNER_ORG
CADS_GITHUB_MARKETPLACE_LISTING_SLUG
CADS_GITHUB_MARKETPLACE_STARTER_PLAN_ID
CADS_GITHUB_MARKETPLACE_PRO_PLAN_ID
CADS_GITHUB_MARKETPLACE_ENTERPRISE_PLAN_ID
CADS_GITHUB_PUBLIC_URL

SUPABASE_URL
SUPABASE_SECRET_KEY
```

Die drei Plan IDs müssen positiv, vorhanden und untereinander verschieden sein.

## 4. Supabase

Migration:

`supabase/migrations/20261006210500_cads_marketplace_paid_entitlements.sql`

Sie erstellt:

- `cads_marketplace_entitlements`
- `cads_marketplace_event_inbox`
- `cads_marketplace_user_links`

Die Tabellen sind RLS-geschützt und für `anon` und `authenticated` explizit gesperrt.
Schreib-/Readback-Zugriff erfolgt über service-role-only RPCs.

Vor Production müssen Migration History und die tatsächlich materialisierten Tabellen/RPCs gegen
die Ziel-Supabase-Instanz zurückgelesen werden.

## 5. Kauf- und Entitlement-Lifecycle

GitHub liefert Planänderungen über das Event `marketplace_purchase`.

### purchased

1. HMAC-SHA256 des Marketplace-Webhooks prüfen.
2. Account und Plan aus dem Event validieren.
3. Subscription über GitHub Marketplace API autoritativ zurücklesen.
4. Plan ID auf Starter/Pro/Enterprise abbilden.
5. Delivery-ID idempotent persistieren.
6. Entitlement aktivieren.

### changed

Gleicher Readback wie bei `purchased`. Webhook-Plan und autoritativer GitHub-Readback müssen
übereinstimmen; bei Abweichung fail-closed.

### cancelled

Entitlement deaktivieren. Kundendaten werden vor Ablauf der GitHub-Maximalfrist entfernt; der
aktuelle CADS-Cleanup verwendet 29 Tage.

## 6. Käufer-Verknüpfung

Die Setup-URL verlangt einen authentifizierten CAPITAL-AI-Nutzer. Danach wird ein kurzlebiger,
signierter OAuth-State erzeugt. GitHub OAuth wird ausschließlich benutzt, um die Installation des
Käufers zu verifizieren. Das erhaltene OAuth-Token wird vor der dauerhaften User↔Installation-
Verknüpfung widerrufen und nicht persistiert.

## 7. Plan-Capabilities

Authority: `packages/benchmark-core/index.mjs`.

- Starter: Standardprofile + neutraler GitHub Check.
- Pro: Starter + History + Regression Detection + Evidence Export.
- Enterprise: Pro + Custom Profiles/Thresholds + enforced PR Gate + API + Self-hosted Runner.

Marketplace-Preiswerte werden nicht aus den EUR-Website-Preisen abgeleitet.

## 8. Installation durch einen B2B-Kunden

1. Kunde wählt Starter/Pro/Enterprise im GitHub Marketplace.
2. GitHub erzeugt den Kauf und installiert die GitHub App.
3. GitHub ruft die CADS Setup URL mit der Installation auf.
4. Nicht eingeloggte Nutzer werden sicher zum CAPITAL-AI-Login und anschließend zur Setup URL zurückgeführt.
5. Käufer autorisiert die GitHub-Identitätsprüfung.
6. CADS prüft Installation + Marketplace Subscription.
7. CADS widerruft das temporäre OAuth-Token.
8. CADS bindet CAPITAL-AI User ↔ GitHub Account ↔ Installation ↔ aktives Entitlement.
9. Erst danach dürfen planabhängige CADS-Funktionen aktiviert werden.

## 9. Abnahmetests vor Marketplace Submission

Pflicht:

- `npm run test:cads-acceptance`
- `npm run benchmark:cads-package`
- CADS Package Acceptance Workflow PASS
- Docker Security Gate PASS
- SBOM und Runtime License Inventory PASS
- Source-/Secret-Scan PASS
- Purchased/Changed/Cancelled E2E mit GitHub-Testkäufen
- OAuth Setup/Callback E2E
- Supabase Runtime-Readback
- Installation und Deinstallation
- Datenlöschung/Cleanup
- Listing Privacy/Support/Terms
- exakte Release-SHA/Digest-Korrelation

Ein PASS dieser technischen Checks allein ist keine Marketplace-, Security-, Lizenz- oder
Production-Freigabe.
