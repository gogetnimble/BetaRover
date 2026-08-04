# Deployment guide

The sandbox that produced this repo has no `pac` CLI or `dotnet`, so the Dataverse
solution and the cloud flow are provided as **deployable specifications** rather
than a prebuilt `.zip`. This guide is the order to stand it up in a real tenant.

## Prerequisites

- A Dataverse environment and permission to create tables, an app, and a flow.
- An **application user** (service principal) for the crawl to run as.
- Azure subscription for the Function app; optionally Azure OpenAI for the AI pass.
- Power Platform CLI (`pac`) for solution work.

## 1. Create the Dataverse tables

From [`solution/schema/tables.json`](../solution/schema/tables.json), create the
six tables (`br_reviewstandard`, `br_reviewrule`, `br_flowinventory`,
`br_reviewrun`, `br_flowreview`, `br_reviewfinding`) with the listed columns,
choices, relationships, and the `br_flowid` alternate key. Use your own publisher
prefix if not `br_`.

## 2. Seed the ruleset

Import [`solution/seed/default-ruleset.json`](../solution/seed/default-ruleset.json)
as one Review Standard + its Review Rule rows. Regenerate it from code any time
with `cd engine && npm run emit-seed`. Then **edit the rows** to fit your tenant
(prefix, approved senders, logger names) — that is the whole point of the
data-driven design.

## 3. Deploy the engine (Azure Function)

```bash
cd engine
npm ci
npm test          # gate: all tests green
npm run build
# deploy dist/ + host wrapper as a Node Azure Function (see engine/host/README.md)
```

Set `AZURE_OPENAI_*` app settings if you want the AI pass.

## 4. Import the custom connector

Import [`connector/flow-review-connector.swagger.json`](../connector/flow-review-connector.swagger.json),
set `host` to your Function app, and create a connection using the Function key.

## 5. Build the Crawl Orchestrator flow

Author **`BR - Flow Review - Crawl Orchestrator`** following
[`flows/crawl-orchestrator/README.md`](../flows/crawl-orchestrator/README.md) and
`steps.json`. Point its Dataverse and custom-connector actions at your
connections. Run it once on demand before enabling the schedule.

## 6. Build the model-driven app

Add the six tables to a model-driven app **Flow Code Review** with:

- **Configuration** area: Review Standards, Review Rules.
- **Results** area: Review Runs → Flow Reviews → Findings; a Flow Inventory list.
- Views/charts: findings by severity, average score per run, worst flows.

## 7. Security

Create a scoped application security role for the crawl user:

- Read on `workflows`, `br_reviewstandard`, `br_reviewrule`.
- Create/Write on `br_flowinventory`, `br_reviewrun`, `br_flowreview`,
  `br_reviewfinding`.
- **No** System Administrator. This mirrors the standard's own security rule.

## Verifying

- Run the flow; confirm a Review Run completes with Flow Reviews + Findings.
- Spot-check a known-bad flow: it should fail `NAMING_CONVENTION` /
  `ERROR_HANDLING_SCOPES` as expected.
- Compare a flow's engine result to the fixtures in `engine/test/fixtures/`.
