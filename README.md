# Ember

A solution that **crawls a Dynamics 365 / Power Platform tenant for Power Automate
cloud flows and runs an automated code review** against a delivery standard you
configure inside Dataverse.

The review is **hybrid**: a deterministic rule engine catches the mechanical,
unambiguous violations (naming, Try/Catch/Finally wiring, bounded queries,
approved email sender, run-as principal, …) and an optional **Azure OpenAI** pass
adds holistic judgement the rules can't express. The rules themselves are
**data-driven** — every threshold and value (the `"CMA - "` prefix, the approved
sender, the scope names) is a configuration record, so the same engine enforces
any organisation's standard.

## Architecture

```
                    ┌──────────────────────────── Dynamics 365 / Dataverse ───────────────────────────┐
                    │                                                                                   │
  Scheduled  ─────► │  Power Automate: "BR - Flow Review - Crawl Orchestrator"                          │
  (daily)           │    1. Enumerate flows  ──► Dataverse `workflows` table (category = 5)             │
                    │                        └─► Power Automate Management API (owner, env, state)      │
                    │    2. Upsert Flow Inventory                                                       │
                    │    3. For each flow ► call Review Engine (custom connector)                       │
                    │    4. Write Flow Review + Findings                                                │
                    │                                                                                   │
                    │  Model-driven app: "Ember"                                                        │
                    │    • Review Standards / Review Rules  (you configure the criteria here)           │
                    │    • Flow Inventory · Review Runs · Flow Reviews · Findings  (results)            │
                    └───────────────────────────────────────────────┬───────────────────────────────────┘
                                                                     │  HTTPS (custom connector)
                                                                     ▼
                                          ┌──────────────────────────────────────────────┐
                                          │  Review Engine  (Azure Function, Node/TS)      │
                                          │   • parse clientdata → normalised model        │
                                          │   • deterministic evaluators (this repo)       │
                                          │   • Azure OpenAI holistic pass (optional)      │
                                          └──────────────────────────────────────────────┘
```

See [`docs/architecture.md`](docs/architecture.md) for the full picture and the
reasoning behind the low-code-orchestration / pro-code-engine split.

## Repository layout

| Path | What it is |
|------|------------|
| `engine/` | The review engine — TypeScript, fully unit-tested. The deterministic rules + AI adapter. Deployable as an Azure Function. |
| `webresource/` | The model-driven app UI — a single self-contained HTML web resource (dashboard, per-flow review, add-rule). Wired to the Dataverse Web API, with a sample-data preview mode. |
| `solution/package/` | Importable unmanaged solution — publisher, the 9 global choices, and the web resource. Pack with `zip` (or `pac solution pack`) and import. |
| `solution/provision/` | Node script that creates the six tables (from `tables.json`) via the Dataverse Web API and seeds the default standard/rules. |
| `solution/schema/tables.json` | Deployable specification of the six Dataverse tables. |
| `solution/seed/default-ruleset.json` | Seed rule records encoding the sample standard (generated from the engine). |
| `flows/crawl-orchestrator/` | The nightly orchestration cloud flow: crawl → inventory → review → persist. |
| `flows/on-demand-review/` | The single-flow review flow behind the web resource's **Run review now** button. |
| `connector/` | Custom connector (OpenAPI) the flows use to call the engine. |
| `docs/` | Architecture, data model, the formalised standard, the rule catalog, setup & deployment. |

## The engine at a glance

```ts
import { reviewFlowWithDefaults } from '@betarover/flow-review-engine';

const result = await reviewFlowWithDefaults({
  displayName: 'CMA - Membership - Add new Roles on Contact Creation',
  clientData: workflowRow.clientdata,          // straight from Dataverse
  inventory: { ownerType: 'application' },      // enriched from the Management API
});

result.score.score;   // 0–100 compliance score
result.findings;       // per-rule pass / warning / fail / N-A, with remediation
```

### Working on the engine

```bash
cd engine
npm install
npm test          # deterministic + AI-adapter tests (no network needed)
npm run typecheck
npm run emit-seed  # regenerate solution/seed/default-ruleset.json from code
```

## Status

This repository carries the solution end to end: a tested **engine**, the
**data model**, the formalised **standard** as configurable rules, the
orchestration/connector contracts, the **nightly** and **on-demand** flow specs,
and the **web resource UI** (real, self-contained HTML/JS — dashboard, per-flow
review, and add-a-rule authoring, wired to the Dataverse Web API with a
sample-data preview mode).

The Dataverse tables and cloud flows are specified as deployable artifacts (the
sandbox that produced this has no `pac`/`dotnet`); the engine and web resource
are ready-to-deploy code. Stand it all up with
[`docs/deployment.md`](docs/deployment.md).
