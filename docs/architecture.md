# Architecture

## Goal

Crawl a Dynamics 365 / Power Platform tenant for Power Automate **cloud flows**
and produce a **code review** of each one against a delivery standard that is
**configured alongside the solution** (as Dataverse records), not hard-coded.

## Design choices

Three decisions shaped the build:

1. **Delivery model — model-driven app + Power Automate backend.** The UI, the
   configurable criteria, and the results all live in Dataverse and are surfaced
   through a model-driven app. The crawl is a scheduled cloud flow. This keeps
   the solution native to the tenant and low-code where it can be.

2. **Review engine — hybrid (deterministic rules + AI).** Mechanical checks
   (naming, scope wiring, bounded queries, approved sender, run-as principal)
   are deterministic and fully explainable. Nuanced judgement (intent,
   readability, missed edge cases) is delegated to an Azure OpenAI pass. A pure
   cloud flow cannot parse a flow's `clientdata` JSON and reason about it well,
   so the engine is real code — a small **Node/TypeScript Azure Function** the
   flow calls through a **custom connector**. The flow stays thin (orchestration
   only).

3. **Flow source — both.** Flows are enumerated from the Dataverse `workflows`
   table (`category = 5`, i.e. Modern/Cloud Flow), which carries the
   `clientdata` definition we review, **and** enriched from the Power Automate
   Management API for owner principal type, environment, and run state — data
   the `workflows` table does not fully expose.

## Components

### 1. Dataverse tables (`solution/schema/tables.json`)

Six tables, publisher prefix `br_`:

- **Review Standard / Review Rule** — the criteria *you* configure. This is the
  "entity or table" the brief called for. The bundled seed encodes the sample
  standard, but you edit rows to change behaviour.
- **Flow Inventory** — one row per discovered flow.
- **Review Run → Flow Review → Review Finding** — the results hierarchy.

Full detail in [`data-model.md`](data-model.md).

### 2. Crawl orchestrator (`flows/crawl-orchestrator/`)

A scheduled cloud flow:

1. Create a **Review Run** (status `Running`).
2. Load the active **Review Standard** and its enabled **Review Rules**.
3. **Enumerate flows** — `List rows` on `workflows` (`$filter=category eq 5`,
   `$select=workflowid,name,clientdata,...`, bounded `$top`), then the
   **Management API** for owner/env/state.
4. **Upsert Flow Inventory** (keyed on `br_flowid`); skip unchanged definitions
   via `br_definitionhash`.
5. For each flow, **call the Review Engine** via the custom connector, passing
   the flow's `displayName`, `clientData`, `inventory`, and the ruleset.
6. Persist a **Flow Review** and its **Findings**.
7. Complete the **Review Run** (counts + average score).

The flow follows the very standard it enforces (Try/Catch/Finally, logging,
bounded queries) as a reference implementation.

### 3. Review engine (`engine/`)

Pure, deterministic, unit-tested TypeScript. Hosting it as an Azure Function is a
thin HTTP wrapper around `reviewFlow()`.

```
clientdata ─► parseFlow() ─► FlowModel ─┬─► deterministic evaluators ─┐
                                        │                             ├─► Finding[] ─► score
inventory ──────────────────────────────┘   Azure OpenAI pass (opt) ──┘
ruleset ─────────────────────────────────────────────────────────────┘
```

- `flowModel.ts` — normalises the many shapes of `clientdata` into a tree +
  flat list of actions (recursing into Scopes, Conditions, Foreach, Switch).
- `rules/evaluators.ts` — one evaluator per rule, all parameter-driven.
- `reviewer.ts` — runs enabled rules, optionally the AI pass, and scores.
- `ai.ts` — `AzureOpenAiReviewer` (real) and `NullAiReviewer` (offline/tests).

### 4. Custom connector (`connector/`)

OpenAPI definition exposing the engine's `POST /review` operation to Power
Automate, so the flow calls the engine as a first-class action.

## Data flow, end to end

```
workflows (Dataverse) ┐
                       ├─► Crawl Orchestrator ─► Custom Connector ─► Azure Function (engine)
Management API ────────┘            │                                        │
                                    │◄──────────────── Finding[] + score ─────┘
                                    ▼
              Flow Inventory / Review Run / Flow Review / Review Finding
                                    ▼
                       Model-driven app dashboards
```

## Why the engine is separate code (and not "just a flow")

The most valuable, most error-prone logic is parsing `clientdata` and reasoning
about scope `runAfter` wiring, connector operations, and query parameters.
Expressing that in cloud-flow expressions would be brittle and untestable. As a
small library it is:

- **Testable** — see `engine/test/` (10 tests, deterministic + AI adapter).
- **Portable** — reusable in CI, a PR gate, or a CLI, not only the crawl.
- **Configurable** — behaviour comes from rule records, not code changes.

## Security notes

- The Azure Function key / Azure OpenAI key live in Function app settings and the
  connector's connection — never in flow definitions or this repo.
- The crawl runs as an **application user** with a scoped security role: read on
  `workflows`, read on Review Standard/Rule, write on the result tables. This
  mirrors the standard's own "run as service principal, least privilege" rule.
