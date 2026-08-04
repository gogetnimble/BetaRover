# Web resource — `br_flowreview_app.html`

The user interface of the Flow Code Review solution: a single, self-contained
HTML web resource embedded in the **Flow Code Review** model-driven app. No build
step, no external libraries, no CDN — it is CSP-safe and deployable as-is.

## What it does

Three tabs, all reading and writing the six `br_*` tables through the Dataverse
Web API:

| Tab | Reads | Writes |
|-----|-------|--------|
| **Tenant Dashboard** | latest `br_reviewrun` + its `br_flowreview` rows; findings aggregated by severity and by rule | — |
| **Flow Review** | one `br_flowreview` + its `br_reviewfinding` rows (AI findings shown separately) | creates an on-demand `br_reviewrun` (**Run review now**) |
| **Standard & Rules** | active `br_reviewstandard` + its `br_reviewrule` rows | creates rules (**New rule**); enable/disable toggles; **Active** and **Review all flows** toggles on the standard |

Clicking a flow on the dashboard opens its review. **Run review now** creates a
`br_reviewrun` (trigger source `ondemand`) — see
[`flows/on-demand-review`](../flows/on-demand-review/README.md) — then polls until
it completes and refreshes.

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
  `br_`.
- `navProps.reviewToInventory` / `navProps.ruleToStandard` — the **navigation
  property names** for the `br_flowreview → br_flowinventory` and
  `br_reviewrule → br_reviewstandard` lookups. These default to the lookup
  schema names; if the maker portal generated different relationship names,
  set them here (Web API → `$metadata` shows the exact `NavigationProperty`).
- `poll` — interval/timeout for the **Run review now** wait.

### `CHOICES` — used for writes
Reads use OData **formatted values** (no config); **writes** (creating a rule,
queuing an on-demand run) need the choice **integers**.

**If you imported the shipped solution** ([`solution/package`](../solution/package)),
the global choices have deterministic values — `severity` Info=1/Warning=2/…,
`runStatus` Queued=1/…, `triggerSrc` schedule=1/ondemand=2, `category`
Naming=1/… — and the default `CHOICES` block **already matches them**. Nothing
to change.

**If you authored the choices by hand instead**, they'll get
environment-specific integers (often `121570000`); set the four maps to match.
Find the values in the maker portal (each choice's option list) or via
`GET [org]/api/data/v9.2/GlobalOptionSetDefinitions`. A write that fails with a
choice error means these are off.

## Register and surface it

1. **Add the web resource** to the solution: type **Webpage (HTML)**, name
   `br_flowreview_app` (schema `br_flowreview_app.html`), upload this file.
2. **Full-page surface (recommended):** in the model-driven app designer, add a
   **Navigation → Subarea** whose **Type = Web resource** and **URL =
   `$webresource:br_flowreview_app`**. Title it *Dashboard*. This is the
   "full-page custom page" surface chosen in design.
3. **Deep link (optional):** the resource reads `?flowReviewId=<guid>` (or
   `?id=`) and opens that review on load — useful from a form ribbon button.
4. **Publish all customizations.**

## Security

The web resource runs **as the signed-in user** and calls the Web API with that
user's privileges — so viewers need **Read** on the six `br_*` tables, and
anyone who uses **New rule** / **Run review now** needs **Create** on
`br_reviewrule` / `br_reviewrun` respectively. Grant these through a
**Flow Review User** security role. (This is separate from the *crawl*
application user, which has its own scoped role — see
[`docs/deployment.md`](../docs/deployment.md) step 8.)

## Accessibility & theming

- Light/dark aware via `prefers-color-scheme` plus a manual **Theme** toggle.
- Keyboard-focusable controls with a visible focus ring; respects
  `prefers-reduced-motion`.
- Responsive down to phone widths (the model-driven app renders web resources on
  mobile).
