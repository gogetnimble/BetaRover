# BetaRover Flow Code Review

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
                    │  Model-driven app: "Flow Code Review"                                             │
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
| `solution/schema/tables.json` | Deployable specification of the six Dataverse tables. |
| `solution/seed/default-ruleset.json` | Seed rule records encoding the sample standard (generated from the engine). |
| `flows/crawl-orchestrator/` | The orchestration cloud flow: crawl → inventory → review → persist. |
| `connector/` | Custom connector (OpenAPI) the flow uses to call the engine. |
| `docs/` | Architecture, data model, the formalised standard, the rule catalog, deployment. |

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

This repository is the **foundation**: a tested engine, the data model, the
formalised standard as configurable rules, and the orchestration/connector
contracts. The Dataverse tables and cloud flow are specified as deployable
artifacts (the sandbox that produced this has no `pac`/`dotnet`), ready to be
imported and wired up. See [`docs/deployment.md`](docs/deployment.md).
