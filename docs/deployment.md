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

## 2. Import the solution + provision the tables

The solution ships in two pieces (full detail in
[`solution/README.md`](../solution/README.md)):

1. **Import the solution zip** — `BetaRoverFlowReview` carries the publisher, the
   **9 global choices**, and the **web resource**. Pack and import:

   ```bash
   cd solution/package && zip -r -X ../BetaRoverFlowReview_1_0_0_0.zip . -x '.*'
   # make.powerapps.com → Solutions → Import, or:
   pac solution import --path solution/BetaRoverFlowReview_1_0_0_0.zip
   ```

   Because the choices ship in the solution, their option values are
   **deterministic** (Info=1, Warning=2, Queued=1, ondemand=2, …) and already
   match the web resource's `CHOICES` map — no per-environment choice hunting.

2. **Provision the six tables** from
   [`solution/schema/tables.json`](../solution/schema/tables.json) via the
   Web API (auto-generates default forms/views), landing them in the imported
   solution:

   ```bash
   cd solution/provision
   export DATAVERSE_URL="https://yourorg.crm.dynamics.com"
   export DATAVERSE_TOKEN="$(az account get-access-token \
      --resource https://yourorg.crm.dynamics.com --query accessToken -o tsv)"
   node provision.mjs --seed
   ```

`br_reviewrun` includes `br_triggersource` (`schedule`/`ondemand`) and
`br_targetflowid`, which power the on-demand **Run review now** button. Use your
own publisher prefix if not `br_` (and mirror it into the web resource's
`CONFIG.entities`).

## 3. Seed the standard + rules

`node provision.mjs --seed` (step 2) already imports the default **Review
Standard** (marked `Active`) and its eight **Review Rule** rows from
[`solution/seed/default-ruleset.json`](../solution/seed/default-ruleset.json).
Regenerate that seed from code any time with `cd engine && npm run emit-seed`.
Then **edit the rows** for your tenant — prefix, approved senders, logger names —
via the app's Standard & Rules tab or directly. That data-driven edit *is* the
point of the design: no redeploy to change a threshold.

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

Create a model-driven app **Flare** and add the six tables:

- **Configuration** area: Review Standards, Review Rules.
- **Results** area: Review Runs → Flow Reviews → Findings; a Flow Inventory list.

On the **Review Run** form, add the related **Flow Reviews** as a subgrid so
clicking a run shows the flows it reviewed; on **Flow Review**, add the related
**Findings** subgrid. That gives the Run → its flows → a flow's findings
drill-down natively (the same navigation prototyped in the design mockup).

Then add the UI web resource:

1. Add web resource **`br_flowreview_app`** (type *Webpage (HTML)*) from
   [`webresource/br_flowreview_app.html`](../webresource/br_flowreview_app.html).
2. **Configure it** — the `CHOICES` block already matches the deterministic
   values shipped by the solution (step 2), so it works as-is. You only touch
   `CONFIG` if you changed the publisher prefix or the lookup navigation
   property names. Full instructions:
   [`webresource/README.md`](../webresource/README.md).
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
plus Create on `br_reviewrule` (to use **New rule**), Create on `br_reviewrun`
(to use **Run review now**), and Write on `br_reviewstandard` (to use the
**Active** and **Review all flows** toggles). The web resource acts as the
signed-in user.

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
