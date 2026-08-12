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
| 4 | Build + register the plug-in (Custom APIs `bvr_ReviewFlow` + `bvr_RunFlowTests`) | [`plugin/`](../plugin) |
| 5 | *(legacy)* Azure Function + custom connector — superseded by step 4 | [`connector/`](../connector) |
| 6 | Build the crawl + unit-test flows | [`flows/`](../flows) |
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

1. **Import the solution zip** — `Ember` carries the publisher and the **web
   resource**. Pack and import:

   ```bash
   cd solution/package && zip -r -X ../Ember_1_0_1_0.zip . -x '.*'
   # make.powerapps.com → Solutions → Import, or:
   pac solution import --path solution/Ember_1_0_1_0.zip
   ```

2. **Provision the choices + six tables** from
   [`solution/schema/tables.json`](../solution/schema/tables.json) via the
   Web API (auto-generates default forms/views), landing them in the imported
   solution. The script creates the **9 global choices** first, with values in
   the publisher's option-value-prefix range (`100000000…`) that match the web
   resource's `CHOICES` map — so there's no per-environment choice hunting.

   > The choices are created by the script, **not** hand-authored in the solution
   > XML: option values below the publisher prefix range make the solution
   > importer throw `0x80048030` ("Object reference not set…"), which is exactly
   > what an earlier build hit. The Web API path assigns valid values.

   ```bash
   cd solution/provision
   export DATAVERSE_URL="https://yourorg.crm.dynamics.com"
   export DATAVERSE_TOKEN="$(az account get-access-token \
      --resource https://yourorg.crm.dynamics.com --query accessToken -o tsv)"
   node provision.mjs --seed
   ```

`bvr_reviewrun` includes `bvr_triggersource` (`schedule`/`ondemand`) and
`bvr_targetflowid`, which power the on-demand **Run review now** button. Use your
own publisher prefix if not `bvr_` (and mirror it into the web resource's
`CONFIG.entities`).

## 3. Seed the standard + rules

`node provision.mjs --seed` (step 2) already imports the default **Review
Standard** (marked `Active`) and its eight **Review Rule** rows from
[`solution/seed/default-ruleset.json`](../solution/seed/default-ruleset.json).
Regenerate that seed from code any time with `cd engine && npm run emit-seed`.
Then **edit the rows** for your tenant — prefix, approved senders, logger names —
via the app's Standard & Rules tab or directly. That data-driven edit *is* the
point of the design: no redeploy to change a threshold.

## 4. Build + register the plug-in (two Custom APIs)

The review engine **and** the flow unit-test runner run **inside Dataverse** as
plug-ins in **one signed assembly**, exposed as two **Custom APIs** — so they
ship in the one solution, no Azure, no custom connector. Full steps are in
[`plugin/README.md`](../plugin/README.md):

```bash
sn -k plugin/Ember.Plugins/Ember.Plugins.snk                       # signing key (once)
dotnet build plugin/Ember.Plugins/Ember.Plugins.csproj -c Release  # → Ember.Plugins.dll
```

Then, with the Plugin Registration Tool / `pac`: register the (sandboxed,
database) assembly, then create **both** Custom APIs and **add the assembly +
both Custom APIs to the Ember solution** so they import with it:

- **`bvr_ReviewFlow`** → plugin type `BetaRover.Ember.Plugins.ReviewFlowPlugin`,
  request params `DisplayName`, `ClientData`, `Ruleset`, `Inventory` (String),
  response `Result` (String). Reviews one flow against the ruleset.
- **`bvr_RunFlowTests`** → plugin type `BetaRover.Ember.Plugins.RunFlowTestsPlugin`,
  request params `DisplayName`, `ClientData`, `TestCases` (String), response
  `Result` (String). Mock-executes a flow's unit tests server-side (the same
  engine as the web resource's **Run tests** button).

The C# is a faithful port of [`engine/`](../engine) — the review engine and the
`engine/src/testing` mock runner (the TypeScript stays the spec + vitest suite).
The AI pass is optional and, if used, is an HTTP call to *the client's* Azure
OpenAI from the flow — no engine-hosted secrets.

## 5. *(legacy)* Azure Function + custom connector

Superseded by step 4. Only relevant if you deliberately host the engine outside
Dataverse — see [`connector/README.md`](../connector/README.md). Skip otherwise.

## 6. Build the crawl + unit-test flows

They share connections, the Custom APIs, and — recommended — a child flow
`BR - Flow Review - Review One Flow` that does one flow's review (see the
on-demand README).

- **`BR - Flow Review - Crawl Orchestrator`** (nightly) —
  [`flows/crawl-orchestrator`](../flows/crawl-orchestrator/README.md). Recurrence
  trigger; enumerates all cloud flows and reviews each via **`bvr_ReviewFlow`**.
  Run once on demand before enabling the schedule.
- **`BR - Flow Review - On-Demand`** (single flow) —
  [`flows/on-demand-review`](../flows/on-demand-review/README.md). **Dataverse
  "When a row is added"** on `bvr_reviewruns`, filtered to
  `bvr_triggersource eq <ondemand value>`. Fires when the web resource's **Run
  review now** button creates a queued run.
- **`BR - Flow Review - Scheduled Unit Tests`** (nightly) —
  [`flows/scheduled-tests`](../flows/scheduled-tests/README.md). Recurrence
  trigger; runs every flow's enabled test cases through **`bvr_RunFlowTests`**
  and writes `bvr_flowtestrun` rows + stamps `bvr_lasttestpassedon`. The
  server-side twin of the web resource's **Run tests** button, feeding the
  dashboard's unit-test health KPIs.

All follow Try/Catch/Finally, logging, and bounded queries — the very standard
they enforce.

## 7. Build the model-driven app + site map

The Ember UI is a single web resource; the app's **site map** drives every
section of it. Each menu item opens the web resource with a `?data=` value that
the resource reads on load and routes to (dashboard, the four grids, standards,
rules, schedule). Full walkthrough + the exact site map:
[`solution/app/README.md`](../solution/app/README.md).

1. Add web resource **`bvr_flowreview_app`** (type *Webpage (HTML)*) from
   [`webresource/bvr_flowreview_app.html`](../webresource/bvr_flowreview_app.html).
   Its `CHOICES` block already matches the values the provisioning script assigns
   (step 2); you only touch `CONFIG` for a different publisher prefix or lookup
   navigation names — see [`webresource/README.md`](../webresource/README.md).
2. Create a model-driven app **Ember**; add the web resource **and** the six
   tables as components (the tables must be in the app for the web resource's Web
   API calls to resolve).
3. Build the **site map** from [`solution/app/sitemap.xml`](../solution/app/sitemap.xml):
   two groups (Review, Configuration) with eight Web Resource subareas, each
   **URL = `/WebResources/bvr_flowreview_app.html?data=<section>`**.
4. **Save & Publish.**

Clicking a flow in any grid opens its Flow Review; clicking a run opens that
run's Flow Reviews — all inside the web resource.

## 8. Security

Two distinct roles:

**Crawl application user** (the flows run as this) — least privilege, mirroring
the standard's own security rule:
- Read on `workflows`, `bvr_reviewstandard`, `bvr_reviewrule`.
- Create/Write on `bvr_flowinventory`, `bvr_reviewrun`, `bvr_flowreview`,
  `bvr_reviewfinding`.
- **No** System Administrator.

**Flow Review User** (people using the app) — Read on all six `bvr_*` tables;
plus Create on `bvr_reviewrule` (to use **New rule**), Create on `bvr_reviewrun`
(to use **Run review now**), and Write on `bvr_reviewstandard` (to use the
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
- Add a rule via **New rule**; confirm a `bvr_reviewrule` row appears and the next
  crawl evaluates it. (A choice error here means the `CHOICES` map is wrong —
  step 7.2.)

## Operations

- **Schedule:** the Crawl Orchestrator recurrence (default daily 06:00) is the
  nightly review. Adjust in the trigger.
- **Retention:** add `bvr_reviewrun` (and its cascade) to a nightly purge after a
  window (e.g. 6 months); keep the latest run for trend baselines. See
  [`data-model.md`](data-model.md#retention).
- **Cost control:** the crawl skips flows whose `bvr_definitionhash` is unchanged,
  so unchanged flows don't re-hit the engine or Azure OpenAI.
