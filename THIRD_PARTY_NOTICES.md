# CADS Third-Party Notices and Runtime Boundaries

Status: **SOURCE-SCOPE NOTICE — FINAL RUNTIME INVENTORY STILL REQUIRED**

The standalone CADS source slice is intentionally dependency-light. The following external systems
are referenced by protocol or runtime integration and are **not** relicensed by CAPITAL-AI.

| Component / service | Role | Distribution in CADS source | License / terms authority |
| --- | --- | --- | --- |
| Node.js | JavaScript runtime | Not vendored | Node.js project license for the exact runtime version |
| GitHub / GitHub Apps / GitHub Marketplace | App distribution, installation, billing events, API | Service/API only | GitHub terms, Marketplace Developer Agreement and GitHub API terms |
| Supabase | Optional entitlement/evidence persistence | Service/API only | Supabase service terms; self-hosted components retain their upstream licenses |
| PostgreSQL | Database behind the Supabase persistence model | Not vendored by the CADS source slice | PostgreSQL License for the actual runtime component |
| GitHub Actions | CI execution | Workflow service | GitHub Actions service terms; pinned actions retain their own licenses |

## Export rule

The dedicated CADS repository must not copy broad Capital-AI dependency inventories that are not
actually part of the CADS artifact. Instead, every release must generate an SBOM and runtime-license
inventory from the exact build/container shipped for that release.

## Trademark boundary

GitHub, Supabase, PostgreSQL and Node.js names remain marks/names of their respective owners. Their
mention documents interoperability and does not imply endorsement.

## Evidence rule

This notice is not a substitute for:

- exact package/container SBOM;
- vulnerability and reachability scan;
- license text/NOTICE obligations of actually distributed dependencies;
- Marketplace Developer Agreement acceptance;
- B2B customer terms and privacy disclosures.
