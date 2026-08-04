# Setup & deployment guide

Everything needed to stand the solution up in a real Dynamics 365 / Power
Platform tenant, in order. The Dataverse tables, cloud flows, and app are
provided as **deployable specifications** (this repo's sandbox has no `pac` or
`dotnet` to emit a signed `.zip`); the **engine** and the **web resource** are
real, ready-to-deploy code.

At a glance:

| # | Step | Artifact |
|---|------|----------|
| 1 | Prerequisites | — |
| 2 | Create the Dataverse tables | [`solution/schema/tables.json`](../solution/schema/tables.json) |
| 3 | Seed the standard + rules | [`solution/seed/default-ruleset.json`](../solution/seed/default-ruleset.json) |
| 4 | Deploy the engine (Azure Function) | [`engine/`](../engine) |
| 5 | Import the custom connector | [`connector/`](../connector) |
| 6 | Build the two crawl flows | [`flows/`](../flows) |
| 7 | Build the model-driven app + web resource | [`webresource/`](../webresource) |
| 8 | Security roles | — |
| 9 | Verify | — |

---

## 1. Prerequisites

- A Dataverse environment; permission to create tables, an app, web resources,
  and flows.
- An **application user** (service principal) for the crawl to run as.
- Azure subscription for the Function app; optionally **Azure OpenAI** for the AI
  pass.
- **Power Platform CLI** (`pac`) and **Node 18+** for the engine.
- Power Automate **per-flow / process** plan or equivalent for the scheduled and
  Dataverse-triggered flows and the Management API HTTP action.

## 2. Create the Dataverse tables

From [`solution/schema/tables.json`](../solution/schema/tables.json) create the
six tables — `br_reviewstandard`, `br_reviewrule`, `br_flowinventory`,
`br_reviewrun`, `br_flowreview`, `br_reviewfinding` — with the listed columns,
choices, lookups, and the `br_flowid` alternate key. Use your own publisher
prefix if not `br_` (and mirror it into the web resource's `CONFIG.entities`).

> **New since the first cut:** `br_reviewrun` has two extra columns —
> `br_triggersource` (`schedule` / `ondemand`) and `br_targetflowid` — that power
> the on-demand **Run review now** button. They're already in `tables.json`.

**Write down your published choice values.** Local choice columns get
environment-specific integers. You'll need these for the web resource
(step 7) and the on-demand flow trigger (step 6):
`br_reviewrule.br_category`, `br_reviewrule.br_severity`,
`br_reviewrun.br_status`, `br_reviewrun.br_triggersource`.

## 3. Seed the standard + rules

Import [`solution/seed/default-ruleset.json`](../solution/seed/default-ruleset.json)
as one **Review Standard** (mark it `Active`) plus its eight **Review Rule** rows.
Regenerate it from code any time with `cd engine && npm run emit-seed`. Then
**edit the rows** for your tenant — prefix, approved senders, logger names — via
the app's Standard & Rules tab or directly. That data-driven edit *is* the point
of the design: no redeploy to change a threshold.

## 4. Deploy the engine (Azure Function)

```bash
cd engine
npm ci
npm test          # gate: all tests must be green
npm run build     # emits dist/
```

Host `dist/` behind a Node Azure Function (v4 model) using the thin wrapper in
[`engine/host/README.md`](../engine/host/README.md). Set these app settings if
you want the AI pass (omit to disable it):

| Setting | Purpose |
|---------|---------|
| `AZURE_OPENAI_ENDPOINT` | e.g. `https://my-aoai.openai.azure.com` |
| `AZURE_OPENAI_KEY` | Azure OpenAI key |
| `AZURE_OPENAI_DEPLOYMENT` | chat deployment, e.g. `gpt-4o` |

Keep secrets in Function app settings / Key Vault. The connector authenticates
with the Function key (`x-functions-key`).

## 5. Import the custom connector

Import [`connector/flow-review-connector.swagger.json`](../connector/flow-review-connector.swagger.json),
set `host` to your Function app, and create a connection using the Function key.
It exposes `POST /api/review` as the **Review Flow** action.

## 6. Build the two crawl flows

Both share connections, the custom connector, and — recommended — a child flow
`BR - Flow Review - Review One Flow` that does one flow's review (see the
on-demand README).

- **`BR - Flow Review - Crawl Orchestrator`** (nightly) —
  [`flows/crawl-orchestrator`](../flows/crawl-orchestrator/README.md). Recurrence
  trigger; enumerates all cloud flows and reviews each. Run once on demand before
  enabling the schedule.
- **`BR - Flow Review - On-Demand`** (single flow) —
  [`flows/on-demand-review`](../flows/on-demand-review/README.md). **Dataverse
  "When a row is added"** on `br_reviewruns`, filtered to
  `br_triggersource eq <ondemand value>`. Fires when the web resource's **Run
  review now** button creates a queued run.

Both follow Try/Catch/Finally, logging, and bounded queries — the very standard
they enforce.

## 7. Build the model-driven app + web resource

Create a model-driven app **Flow Code Review** and add the six tables:

- **Configuration** area: Review Standards, Review Rules.
- **Results** area: Review Runs → Flow Reviews → Findings; a Flow Inventory list.

Then add the UI web resource:

1. Add web resource **`br_flowreview_app`** (type *Webpage (HTML)*) from
   [`webresource/br_flowreview_app.html`](../webresource/br_flowreview_app.html).
2. **Configure it** — edit the `CONFIG` and `CHOICES` blocks at the top of the
   file with your compliance threshold, publisher prefix (if not `br_`),
   navigation property names, and the **published choice values** from step 2.
   Full instructions: [`webresource/README.md`](../webresource/README.md).
3. Surface it **full-page**: add a **Subarea** with **Type = Web resource**,
   **URL = `$webresource:br_flowreview_app`**, titled *Dashboard*.
4. **Publish all customizations.**

## 8. Security

Two distinct roles:

**Crawl application user** (the flows run as this) — least privilege, mirroring
the standard's own security rule:
- Read on `workflows`, `br_reviewstandard`, `br_reviewrule`.
- Create/Write on `br_flowinventory`, `br_reviewrun`, `br_flowreview`,
  `br_reviewfinding`.
- **No** System Administrator.

**Flow Review User** (people using the app) — Read on all six `br_*` tables;
plus Create on `br_reviewrule` (to use **New rule**) and `br_reviewrun` (to use
**Run review now**). The web resource acts as the signed-in user.

## 9. Verify

- Run the Crawl Orchestrator once; confirm a **Review Run** completes with Flow
  Reviews + Findings, and the **Dashboard** tab populates.
- Open a known-bad flow's review; it should **fail** `NAMING_CONVENTION` /
  `ERROR_HANDLING_SCOPES` as expected. Compare against the engine fixtures in
  [`engine/test/fixtures/`](../engine/test/fixtures).
- Click **Run review now**; a new on-demand run should complete within seconds
  and the review should refresh.
- Add a rule via **New rule**; confirm a `br_reviewrule` row appears and the next
  crawl evaluates it. (A choice error here means the `CHOICES` map is wrong —
  step 7.2.)

## Operations

- **Schedule:** the Crawl Orchestrator recurrence (default daily 06:00) is the
  nightly review. Adjust in the trigger.
- **Retention:** add `br_reviewrun` (and its cascade) to a nightly purge after a
  window (e.g. 6 months); keep the latest run for trend baselines. See
  [`data-model.md`](data-model.md#retention).
- **Cost control:** the crawl skips flows whose `br_definitionhash` is unchanged,
  so unchanged flows don't re-hit the engine or Azure OpenAI.
