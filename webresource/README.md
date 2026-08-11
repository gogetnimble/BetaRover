# Web resource — `bvr_flowreview_app.html`

The user interface of the Ember solution: a single, self-contained
HTML web resource embedded in the **Ember** model-driven app. No build
step, no external libraries, no CDN — it is CSP-safe and deployable as-is.

## What it does

Three tabs, all reading and writing the six `bvr_*` tables through the Dataverse
Web API:

| Tab | Reads | Writes |
|-----|-------|--------|
| **Tenant Dashboard** | latest `bvr_reviewrun` + its `bvr_flowreview` rows; findings aggregated by severity and by rule | — |
| **Flow Review** | one `bvr_flowreview` + its `bvr_reviewfinding` rows (AI findings shown separately) | creates an on-demand `bvr_reviewrun` (**Run review now**) |
| **Standard & Rules** | active `bvr_reviewstandard` + its `bvr_reviewrule` rows | creates rules (**New rule**); enable/disable toggles; **Active** and **Review all flows** toggles on the standard |

Clicking a flow on the dashboard opens its review. **Run review now** creates a
`bvr_reviewrun` (trigger source `ondemand`) — see
[`flows/on-demand-review`](../flows/on-demand-review/README.md) — then polls until
it completes and refreshes.

### Signed-in user

The header avatar shows the signed-in user's initials. On load it resolves the
full profile server-side — a **WhoAmI** call for the user id, then a
`systemuser` retrieve for `fullname`, `internalemailaddress`, `title`,
`businessunitid`, and the assigned **security roles** (`systemuserroles_association`).
Clicking the avatar opens a small profile card (name, email, business unit, role
chips). Initials fall back to the client global context (`userSettings.userName`)
so the avatar shows instantly before the retrieve completes.

### Dashboard stats

The dashboard is the app's high-level stat board (a model-driven app can't chart
web-resource data natively, so the web resource renders its own):

- **Headline tiles** — Average score (Δ vs previous run), Compliant flows,
  Open findings (Δ), Error-severity gaps.
- **Inventory + test tiles** — Flows discovered (activated vs draft/suspended),
  Unit-test pass rate (`bvr_lasttestpassedon` / `bvr_testcasecount`), Last
  unit-test pass, and an average-score **trend sparkline** over recent runs.
- **By environment** — per-environment rollup of flows, average score, and
  findings, from `bvr_flowinventory.bvr_environment`.

### Global environment filter

A global **Environment** dropdown sits in the app toolbar (populated from
distinct `bvr_environment` values), always visible so it filters every section.
The in-page tab group beside it mirrors the site map and is hidden when embedded
(the model-driven app's native site map drives navigation), but the filter stays.
Selecting an environment scopes the dashboard tiles, the
per-environment highlight, the flow list, and the Flow Inventory / Flow Reviews /
Findings grids to that environment (server-side via `$filter` / a FetchXML
`bvr_flowinventory` link; the severity donut and rule bars are scoped too).
"All environments" clears it.

### License section

**Configuration → License** (`?data=license`) is a request form — email (prefilled
from WhoAmI) + comments — that POSTs `{ email, comments, org, user, source,
submittedOn }` as JSON to **`CONFIG.licenseEndpoint`** (a service *you* define: a
Power Automate "When an HTTP request is received" URL, an Azure Function, or a
Logic App). Leave `licenseEndpoint` empty until you have a URL; the page says so.
The org's Content Security Policy must allow `connect-src` to that host.

A separate **Getting Started** guide ships as its own web resource
(`bvr_gettingstarted.html`) — link it from the site map at
`/WebResources/bvr_gettingstarted.html`.

### Unit Testing sections

Three routable sections back the **Unit Testing** site-map group (all
environment-filter aware):

- **Test Coverage** (`?data=testcoverage`) — every flow by environment with its
  **last static review** and **last unit-test pass** dates, test-case count, and
  a Validated / Not passed / No tests badge (from `bvr_flowinventory`). Each flow
  with cases has a **Run tests** button that executes its enabled cases through
  the in-browser **mock runner** (a faithful port of `engine/src/testing`,
  guarded by `engine/test/testing/port-parity.test.ts`): it reads the flow's
  definition from the `workflow` table's `clientdata`, interprets it against each
  case's `{ trigger, mocks, variables, asserts }` — no live connectors called —
  writes a `bvr_flowtestrun` result row, and stamps `bvr_lasttestpassedon` /
  `bvr_testcasecount` on the flow so the dashboard tiles and Test Runs grid light
  up. (Requires **Read** on the Process / `workflow` table for the definition.)
- **Test Cases** (`?data=testcases`) — the mocked unit tests (`bvr_flowtestcase`),
  each with its flow, enabled state, and what it pins/asserts. A **New test case**
  button (on both Test Coverage and Test Cases) opens a quick-create that writes a
  `bvr_flowtestcase` row: name, flow (picked from `bvr_flowinventory`), enabled,
  description, and a **guided builder** for the `bvr_casejson` body — no raw JSON
  required:
  - **Trigger outputs** (JSON) — pins `triggerOutputs()` / `triggerBody()`.
  - **Mocked actions** — repeatable rows (action name · status · outputs JSON)
    that pin a connector's outcome so no live connector is called.
  - **Variables** — repeatable name/value seeds (values parsed as JSON when they
    parse, else kept as text).
  - **Assertions** — repeatable typed rows mapping 1:1 to the engine's
    `Assertion` union: No-failures, Action ran / skipped, Action status =,
    Condition branch =, Variable =, Output =, Expression =.
  - **Advanced · edit raw JSON** — a collapsible textarea that overrides the
    builder for power users. The builder emits exactly the engine's
    `{ trigger, mocks, variables, asserts }` `TestCase` shape.
- **Test Runs** (`?data=testruns`) — mock-execution results (`bvr_flowtestrun`):
  status, passed/failed counts, duration, and when it ran.

## Live vs Preview

`getXrm()` looks for `Xrm.WebApi` on the window or its parent.

- **Live** (inside the model-driven app): reads/writes real Dataverse data. The
  header shows a green **Live** pill.
- **Preview** (opened as a plain file / artifact): renders bundled **sample
  data** so the UI can be design-reviewed outside Dataverse. Header shows an
  orange **Preview** pill. Writes are no-ops that toast a note.

This is why you can open the file directly in a browser and still see a working
UI — handy for demos and review.

## Configure before deploy

Open the file and edit the `CONFIG` and `CHOICES` blocks at the top of the
`<script>`:

### `CONFIG`
- `complianceThreshold` — score at/above which a flow counts as "compliant"
  (default `70`).
- `entities` — logical table names, if you used a publisher prefix other than
  `bvr_`.
- `navProps.reviewToInventory` / `navProps.ruleToStandard` — the **navigation
  property names** for the `bvr_flowreview → bvr_flowinventory` and
  `bvr_reviewrule → bvr_reviewstandard` lookups. These default to the lookup
  schema names; if the maker portal generated different relationship names,
  set them here (Web API → `$metadata` shows the exact `NavigationProperty`).
- `poll` — interval/timeout for the **Run review now** wait.

### `CHOICES` — used for writes
Reads use OData **formatted values** (no config); **writes** (creating a rule,
queuing an on-demand run) need the choice **integers**.

**If you ran the provisioning script** ([`solution/provision`](../solution/provision)),
the global choices are created with deterministic values in the publisher's
option-value-prefix range — `severity` Info=100000000/…, `runStatus`
Queued=100000000/…, `triggerSrc` schedule=100000000/ondemand=100000001,
`category` Naming=100000000/… — and the default `CHOICES` block **already matches
them**. Nothing to change.

**If you created the choices some other way**, they'll get different integers;
set the four maps to match. Find the values in the maker portal (each choice's
option list) or via `GET [org]/api/data/v9.2/GlobalOptionSetDefinitions`. A write
that fails with a choice error means these are off.

## Register and surface it

1. **Add the web resource** to the solution: type **Webpage (HTML)**, name
   `bvr_flowreview_app` (schema `bvr_flowreview_app.html`), upload this file.
2. **Full-page surface (recommended):** in the model-driven app designer, add a
   **Navigation → Subarea** whose **Type = Web resource** and **URL =
   `$webresource:bvr_flowreview_app`**. Title it *Dashboard*. This is the
   "full-page custom page" surface chosen in design.
3. **Deep link (optional):** the resource reads `?flowReviewId=<guid>` (or
   `?id=`) and opens that review on load — useful from a form ribbon button.
4. **Publish all customizations.**

## Security

The web resource runs **as the signed-in user** and calls the Web API with that
user's privileges — so viewers need **Read** on the six `bvr_*` tables, and
anyone who uses **New rule** / **Run review now** needs **Create** on
`bvr_reviewrule` / `bvr_reviewrun` respectively. Grant these through a
**Flow Review User** security role. (This is separate from the *crawl*
application user, which has its own scoped role — see
[`docs/deployment.md`](../docs/deployment.md) step 8.)

## Accessibility & theming

- Light/dark aware via `prefers-color-scheme` plus a manual **Theme** toggle.
- Keyboard-focusable controls with a visible focus ring; respects
  `prefers-reduced-motion`.
- Responsive down to phone widths (the model-driven app renders web resources on
  mobile).
